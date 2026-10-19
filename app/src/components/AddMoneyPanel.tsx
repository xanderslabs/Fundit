import { useAppKit } from '@reown/appkit/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { type Address, type EIP1193Provider, formatUnits } from 'viem'
import { useConfig, useConnection, useDisconnect } from 'wagmi'
import {
  ARC_DOMAIN,
  CCTP_CHAINS,
  CHAIN_LABELS,
  type CctpChainKey,
  CROSSCHAIN_ENABLED,
  PASSKEY_GAS_BUFFER,
  REOWN_PROJECT_ID,
  TOKENS,
  type TokenSymbol,
} from '../config'
import { blockingEntry, chainByKey, donateCrossChain, estimateCrossChain, notifyPending, subscribePending } from '../lib/bridge'
import { arcClient } from '../lib/clients'
import { BALANCES_KEY, balancesKey, buildDepositCall, fetchAccountBalances } from '../lib/deposit'
import { explainAfterApproval } from '../lib/errors'
import { formatAmount, formatExact, parseAmount } from '../lib/format'
import { fetchForwardFee } from '../lib/iris'
import { shortAddress } from '../lib/names'
import { wagmiSender } from '../lib/sender'
import { AddressQr } from './AddressTools'
import { Tabs } from './Tabs'
import { TxStatus, useTx } from './TxStatus'
import { AddressChip, AmountInput, Button, Field, StatusBox } from './ui'
import './AddMoneyPanel.css'
import './Form.css'

const BALANCE_POLL_MS = 15_000
const QUOTE_DEBOUNCE_MS = 400

const BRIDGE_PENDING =
  'A transfer to your Fundit account is still on its way. Wait for it to arrive before you send another. Follow it in the Account tab.'
const NO_WALLETS = 'Connecting a wallet is not available on this site right now.'

// Opens the AppKit wallet modal. Without a Reown project id, or when the modal fails to open, the person sees
// NO_WALLETS instead of a raw error.
function useWalletModal() {
  const { open } = useAppKit()
  const [failed, setFailed] = useState(false)
  const available = REOWN_PROJECT_ID !== '' && !failed
  async function connect() {
    try {
      await open()
    } catch {
      setFailed(true)
    }
  }
  return { available, connect }
}

function useBalances(address: Address | null) {
  return useQuery({
    queryKey: balancesKey(address),
    queryFn: () => fetchAccountBalances(arcClient, address!),
    enabled: address !== null,
    refetchInterval: BALANCE_POLL_MS,
  })
}

// Bridge Kit from an external wallet on another chain. Circle's forwarder mints the USDC to the Fundit account on Arc.
// onBusyChange tells the panel while the wallet is signing, so the wallet tab keeps Disconnect locked meanwhile.
function BridgeToAccount({ recipient, onBusyChange }: { recipient: Address; onBusyChange: (busy: boolean) => void }) {
  const modal = useWalletModal()
  const { isConnected, address, connector } = useConnection()
  const wallet = isConnected && connector ? connector : null
  const [sourceKey, setSourceKey] = useState<CctpChainKey>('Base')
  const [fastChoice, setFastChoice] = useState(true)
  const [amountText, setAmountText] = useState('')
  const [phase, setPhase] = useState<{ kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; message: string }>({
    kind: 'idle',
  })
  const inFlight = useRef(false)
  // A transfer to this account that is still on its way, from the shared pending store. While there is one, a
  // new transfer waits, so a retry after a reload cannot send the money twice.
  const [blocked, setBlocked] = useState(() => blockingEntry(recipient) !== null)
  useEffect(() => {
    const reload = () => setBlocked(blockingEntry(recipient) !== null)
    reload()
    return subscribePending(reload)
  }, [recipient])

  const chain = chainByKey(sourceKey)
  const fast = fastChoice && chain.fast
  const parsed = amountText === '' ? null : parseAmount(amountText.trim())
  const amount = parsed?.ok ? parsed.value : null

  const [quoteAmount, setQuoteAmount] = useState<bigint | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => setQuoteAmount(amount), QUOTE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [amount])

  const fee = useQuery({
    queryKey: ['fund-fee', sourceKey, fast, quoteAmount?.toString(), wallet ? address : null],
    queryFn: async (): Promise<bigint> => {
      const circle = async () => (await fetchForwardFee(chain.domain, ARC_DOMAIN, quoteAmount!, fast)).maxFee
      if (!wallet) return circle()
      try {
        const provider = (await wallet.getProvider()) as EIP1193Provider
        return await estimateCrossChain({ provider, sourceKey, campaign: recipient, amount: formatUnits(quoteAmount!, 6), fast, account: address })
      } catch {
        return circle()
      }
    },
    enabled: quoteAmount !== null,
    staleTime: 30_000,
    retry: 1,
  })
  const quote = amount !== null && quoteAmount === amount ? fee.data : undefined
  const arrives = amount !== null && quote !== undefined ? amount - quote : null
  const tooSmall = arrives !== null && arrives <= 0n
  const busy = phase.kind === 'sending'
  useEffect(() => onBusyChange(busy), [busy, onBusyChange])
  const canSubmit = wallet !== null && amount !== null && arrives !== null && !tooSmall && !busy

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (inFlight.current || !canSubmit || !wallet || amount === null) return
    // Another tab may have started a transfer since this form loaded. The listener then shows the blocked state.
    if (blockingEntry(recipient)) {
      notifyPending()
      return
    }
    inFlight.current = true
    setPhase({ kind: 'sending' })
    try {
      const provider = (await wallet.getProvider()) as EIP1193Provider
      // donateCrossChain only bridges: the forwarder mints straight to the recipient, here the Fundit account.
      await donateCrossChain({ provider, sourceKey, campaign: recipient, amount: formatUnits(amount, 6), fast, account: address })
      setAmountText('')
      setPhase({ kind: 'sent' })
    } catch (err) {
      setPhase({ kind: 'error', message: explainAfterApproval(err) })
    } finally {
      inFlight.current = false
    }
  }

  if (blocked) return <p className="form-hint">{BRIDGE_PENDING}</p>

  return (
    <form className="form" onSubmit={(e) => void submit(e)} noValidate>
      <fieldset className="form-fields" disabled={busy}>
        <Field label="From" id="fund-source">
          <select className="select" value={sourceKey} onChange={(e) => setSourceKey(e.target.value as CctpChainKey)}>
            {CCTP_CHAINS.map((c) => (
              <option key={c.key} value={c.key}>
                {CHAIN_LABELS[c.key]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount" id="fund-amount" error={parsed && !parsed.ok ? parsed.error : undefined} alert>
          <AmountInput
            id="fund-amount"
            currency="USDC"
            placeholder="25"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            aria-invalid={parsed && !parsed.ok ? true : undefined}
          />
        </Field>
        <fieldset className="form-group">
          <legend className="form-legend">Speed</legend>
          {chain.fast && (
            <label className="form-choice">
              <input type="radio" name="fund-speed" checked={fast} onChange={() => setFastChoice(true)} />
              <span>Fast</span>
            </label>
          )}
          <label className="form-choice">
            <input type="radio" name="fund-speed" checked={!fast} onChange={() => setFastChoice(false)} />
            <span>Standard</span>
          </label>
        </fieldset>
      </fieldset>

      {amount !== null && (
        <dl className="form-breakdown" aria-label="Breakdown">
          <div>
            <dt>Transfer fees</dt>
            <dd>{quote !== undefined ? formatAmount(quote, 'USDC') : fee.isError ? 'Not available' : 'Checking...'}</dd>
          </div>
          <div className="form-total">
            <dt>Arrives in your Fundit account</dt>
            <dd>{arrives !== null && !tooSmall ? `At least ${formatAmount(arrives, 'USDC')}` : '-'}</dd>
          </div>
        </dl>
      )}
      {fee.isError && <p className="form-error">Could not get a fee quote. Try again in a moment.</p>}
      {tooSmall && <p className="form-error">This amount does not cover the transfer fees. Try a larger amount.</p>}
      <p className="form-hint">The transfer fees come out of the amount. You also pay network gas on {CHAIN_LABELS[sourceKey]}.</p>

      {/* status-error stays on the error box: the e2e suite finds a failed send by it. */}
      <div className="form-status" aria-live="polite">
        {busy && <p>Confirm in your wallet. It may ask you to switch network and approve USDC first.</p>}
        {phase.kind === 'sent' && (
          <StatusBox tone="success">
            <p>
              <strong>Your USDC is on its way.</strong> Follow it in the Account tab.
            </p>
          </StatusBox>
        )}
        {phase.kind === 'error' && (
          <StatusBox tone="error" className="status-error">
            <p>{phase.message}</p>
          </StatusBox>
        )}
      </div>

      {wallet ? (
        <Button type="submit" disabled={!canSubmit}>
          {busy ? 'Sending...' : 'Bridge USDC'}
        </Button>
      ) : modal.available ? (
        <Button onClick={() => void modal.connect()}>Connect the wallet that holds the USDC</Button>
      ) : (
        <p>{NO_WALLETS}</p>
      )}
    </form>
  )
}

// A regular wallet on Arc sends USDC or EURC straight to the Fundit account. It uses the connected wallet's own
// sender: the Fundit account is where the money goes. Add money is the only place a wallet connects.
function WalletDeposit({ account, bridging }: { account: Address; bridging: boolean }) {
  const modal = useWalletModal()
  const { mutate: disconnect } = useDisconnect()
  const config = useConfig()
  const { address, isConnected, connector } = useConnection()
  const external = isConnected && address ? address : null
  const queryClient = useQueryClient()
  const [symbol, setSymbol] = useState<TokenSymbol>('USDC')
  const [amountText, setAmountText] = useState('')
  const tx = useTx(() => {
    setAmountText('')
    void queryClient.invalidateQueries({ queryKey: [BALANCES_KEY] })
  })
  const funds = useBalances(external)

  const parsed = amountText === '' ? null : parseAmount(amountText.trim())
  const amount = parsed?.ok ? parsed.value : null
  const held = funds.data ? (symbol === 'USDC' ? funds.data.usdc : funds.data.eurc) : undefined
  const tooMuch = amount !== null && held !== undefined && amount > held
  // Arc gas is paid in USDC from this same wallet, so a USDC deposit leaves the usual gas buffer behind.
  const noGas = !tooMuch && symbol === 'USDC' && amount !== null && held !== undefined && amount > held - PASSKEY_GAS_BUFFER
  const canSubmit = external !== null && amount !== null && held !== undefined && !tooMuch && !noGas && !tx.locked

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit || external === null || amount === null) return
    // wagmiSender switches the wallet to Arc first and refuses to send anywhere else.
    void tx.run(wagmiSender(config, external), () => buildDepositCall(TOKENS[symbol].address, account, amount), 'Add money')
  }

  if (external === null) {
    if (!modal.available) return <p>{NO_WALLETS}</p>
    return (
      <Button className="wallet-connect" onClick={() => void modal.connect()}>
        Connect a wallet
      </Button>
    )
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="wallet-connected">
        <p>
          Connected: <strong>{connector?.name ?? 'Wallet'}</strong>{' '}
          <code className="wallet-address" title={external}>
            {shortAddress(external)}
          </code>
        </p>
        {/* To switch wallets, disconnect this one and connect another. */}
        <Button variant="secondary" disabled={tx.locked || bridging} onClick={() => disconnect()}>
          Disconnect
        </Button>
      </div>
      <fieldset className="form-fields" disabled={tx.locked}>
        <Field label="Currency" id="deposit-token">
          <select className="select" value={symbol} onChange={(e) => setSymbol(e.target.value as TokenSymbol)}>
            <option value="USDC">USDC</option>
            <option value="EURC">EURC</option>
          </select>
        </Field>
        <Field
          label="Amount"
          id="deposit-amount"
          alert
          error={
            parsed && !parsed.ok
              ? parsed.error
              : tooMuch
                ? 'That is more than this wallet holds on Arc.'
                : noGas
                  ? `Leave at least ${formatExact(PASSKEY_GAS_BUFFER, 'USDC')} in this wallet for the network fee.`
                  : undefined
          }
        >
          <AmountInput
            id="deposit-amount"
            currency={symbol}
            placeholder="25"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            aria-invalid={(parsed && !parsed.ok) || tooMuch || noGas ? true : undefined}
          />
        </Field>
      </fieldset>
      <p className="form-hint">
        {held !== undefined
          ? `Your wallet holds ${formatAmount(held, symbol)} on Arc.`
          : funds.isError
            ? 'Could not read your wallet balance.'
            : 'Reading your wallet balance...'}{' '}
        It also pays a small network fee in USDC.
      </p>
      <TxStatus
        tx={tx}
        noun="transfer"
        wallet
        successText="Money added to your Fundit account."
        startOverWarning="The earlier transfer may still go through. If it does and you send again, you will add the money twice. Start over anyway?"
      />
      <Button type="submit" disabled={!canSubmit}>
        {tx.busy ? 'Sending...' : 'Add to my Fundit account'}
      </Button>
    </form>
  )
}

// The Add money panel on My page: the account's own address, a connected wallet on Arc and, when switched on,
// a bridge from another chain. Each way is a tab. Visited tabs stay mounted, so a send in flight keeps its state.
export function AddMoneyPanel({ account }: { account: Address }) {
  // True while a transfer from another chain is being signed in the shared wallet connection.
  const [bridging, setBridging] = useState(false)
  const tabs = [
    {
      id: 'address',
      label: 'Your address',
      content: (
        <div className="deposit-tab">
          <p>Send USDC or EURC on Arc to this address from any wallet or exchange.</p>
          <div className="deposit-address">
            <AddressQr address={account} label="QR code of your Fundit account address" />
            <AddressChip address={account} full />
          </div>
          <p className="form-hint">This address is on Arc only. Money sent to it on another chain will not arrive.</p>
        </div>
      ),
    },
    {
      id: 'wallet',
      label: 'From a wallet',
      content: (
        <div className="deposit-tab">
          <p className="form-hint">Send USDC or EURC from a regular wallet on Arc.</p>
          <WalletDeposit account={account} bridging={bridging} />
        </div>
      ),
    },
    ...(CROSSCHAIN_ENABLED
      ? [
          {
            id: 'chain',
            label: 'From another chain',
            content: (
              <div className="deposit-tab">
                <p className="form-hint">Move USDC from a wallet on another chain. Circle delivers it to your Fundit account on Arc.</p>
                <BridgeToAccount recipient={account} onBusyChange={setBridging} />
              </div>
            ),
          },
        ]
      : []),
  ]
  return (
    <>
      <Tabs label="Ways to add money" tabs={tabs} keepMounted className="deposit-tabs" />
      <p className="form-hint">Card and bank coming soon.</p>
    </>
  )
}

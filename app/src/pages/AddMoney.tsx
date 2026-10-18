import { useAppKit } from '@reown/appkit/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { type Address, type EIP1193Provider, formatUnits } from 'viem'
import { useConfig, useConnection } from 'wagmi'
import { AddressQr, CopyAddress } from '../components/AddressTools'
import { PasskeyLogin } from '../components/PasskeyLogin'
import { PendingBridgeTracker } from '../components/PendingBridgeTracker'
import { TxStatus, useTx } from '../components/TxStatus'
import { ARC_DOMAIN, CCTP_CHAINS, CHAIN_LABELS, type CctpChainKey, CROSSCHAIN_ENABLED, PASSKEY_GAS_BUFFER, TOKENS, type TokenSymbol } from '../config'
import { blockingEntry, chainByKey, donateCrossChain, estimateCrossChain, notifyPending, subscribePending } from '../lib/bridge'
import { arcClient } from '../lib/clients'
import { BALANCES_KEY, balancesKey, buildDepositCall, fetchAccountBalances } from '../lib/deposit'
import { explainAfterApproval } from '../lib/errors'
import { formatAmount, formatExact, parseAmount } from '../lib/format'
import { fetchForwardFee } from '../lib/iris'
import { usePasskeySession } from '../lib/passkey'
import { wagmiSender } from '../lib/sender'

const BALANCE_POLL_MS = 15_000
const QUOTE_DEBOUNCE_MS = 400

const BRIDGE_PENDING = 'A transfer to your Fundit account is still on its way. Wait for it to arrive before you send another.'

function useBalances(address: Address | null) {
  return useQuery({
    queryKey: balancesKey(address),
    queryFn: () => fetchAccountBalances(arcClient, address!),
    enabled: address !== null,
    refetchInterval: BALANCE_POLL_MS,
  })
}

// Bridge Kit from an external wallet on another chain. Circle's forwarder mints the USDC to the Fundit account on Arc.
function BridgeToAccount({ recipient }: { recipient: Address }) {
  const { open } = useAppKit()
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

  if (blocked) return <p className="hint">{BRIDGE_PENDING}</p>

  return (
    <form className="donate-form" onSubmit={(e) => void submit(e)} noValidate>
      <fieldset className="donate-fields" disabled={busy}>
        <div className="form-field">
          <label htmlFor="fund-source">From</label>
          <select id="fund-source" className="select" value={sourceKey} onChange={(e) => setSourceKey(e.target.value as CctpChainKey)}>
            {CCTP_CHAINS.map((c) => (
              <option key={c.key} value={c.key}>
                {CHAIN_LABELS[c.key]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="fund-amount">Amount</label>
          <div className="donate-amount">
            <input
              id="fund-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="25"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              aria-invalid={parsed && !parsed.ok ? true : undefined}
            />
            <span className="donate-symbol">USDC</span>
          </div>
          {parsed && !parsed.ok && (
            <p className="field-error" role="alert">
              {parsed.error}
            </p>
          )}
        </div>
        <fieldset className="form-field">
          <legend>Speed</legend>
          <div className="donate-options">
            {chain.fast && (
              <label className="donate-option">
                <input type="radio" name="fund-speed" checked={fast} onChange={() => setFastChoice(true)} />
                <span>Fast</span>
              </label>
            )}
            <label className="donate-option">
              <input type="radio" name="fund-speed" checked={!fast} onChange={() => setFastChoice(false)} />
              <span>Standard</span>
            </label>
          </div>
        </fieldset>
      </fieldset>

      {amount !== null && (
        <dl className="donate-breakdown" aria-label="Breakdown">
          <div>
            <dt>Transfer fees</dt>
            <dd>{quote !== undefined ? formatAmount(quote, 'USDC') : fee.isError ? 'Not available' : 'Checking...'}</dd>
          </div>
          <div className="donate-total">
            <dt>Arrives in your Fundit account</dt>
            <dd>{arrives !== null && !tooSmall ? `At least ${formatAmount(arrives, 'USDC')}` : '-'}</dd>
          </div>
        </dl>
      )}
      {fee.isError && <p className="field-error">Could not get a fee quote. Try again in a moment.</p>}
      {tooSmall && <p className="field-error">This amount does not cover the transfer fees. Try a larger amount.</p>}
      <p className="hint">The transfer fees come out of the amount. You also pay network gas on {CHAIN_LABELS[sourceKey]}.</p>

      <div className="donate-status" aria-live="polite">
        {busy && <p>Confirm in your wallet. It may ask you to switch network and approve USDC first.</p>}
        {phase.kind === 'sent' && (
          <div className="status-box status-success">
            <p>
              <strong>Your USDC is on its way.</strong> Follow it below.
            </p>
          </div>
        )}
        {phase.kind === 'error' && (
          <div className="status-box status-error">
            <p>{phase.message}</p>
          </div>
        )}
      </div>

      {wallet ? (
        <button type="submit" className="btn" disabled={!canSubmit}>
          {busy ? 'Sending...' : 'Bridge USDC'}
        </button>
      ) : (
        <button type="button" className="btn" onClick={() => open()}>
          Connect the wallet that holds the USDC
        </button>
      )}
    </form>
  )
}

// A regular wallet on Arc sends USDC or EURC straight to the Fundit account. It uses the connected wallet's own
// sender: the Fundit account is where the money goes. Add money is the only place a wallet connects.
function WalletDeposit({ account }: { account: Address }) {
  const { open } = useAppKit()
  const config = useConfig()
  const { address, isConnected } = useConnection()
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
    return (
      <button type="button" className="btn" onClick={() => void open()}>
        Connect a wallet
      </button>
    )
  }

  return (
    <form className="donate-form" onSubmit={submit} noValidate>
      <fieldset className="donate-fields" disabled={tx.locked}>
        <div className="form-field">
          <label htmlFor="deposit-token">Currency</label>
          <select id="deposit-token" className="select" value={symbol} onChange={(e) => setSymbol(e.target.value as TokenSymbol)}>
            <option value="USDC">USDC</option>
            <option value="EURC">EURC</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="deposit-amount">Amount</label>
          <div className="donate-amount">
            <input
              id="deposit-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="25"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              aria-invalid={(parsed && !parsed.ok) || tooMuch || noGas ? true : undefined}
            />
            <span className="donate-symbol">{symbol}</span>
          </div>
          {parsed && !parsed.ok && (
            <p className="field-error" role="alert">
              {parsed.error}
            </p>
          )}
          {tooMuch && (
            <p className="field-error" role="alert">
              That is more than this wallet holds on Arc.
            </p>
          )}
          {noGas && (
            <p className="field-error" role="alert">
              Leave at least {formatExact(PASSKEY_GAS_BUFFER, 'USDC')} in this wallet for the network fee.
            </p>
          )}
        </div>
      </fieldset>
      <p className="hint">
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
        successText="Money added to your Fundit account."
        startOverWarning="The earlier transfer may still go through. If it does and you send again, you will add the money twice. Start over anyway?"
      />
      <button type="submit" className="btn" disabled={!canSubmit}>
        {tx.busy ? 'Sending...' : 'Add to my Fundit account'}
      </button>
    </form>
  )
}

export function AddMoney() {
  const session = usePasskeySession()
  const address = session?.address ?? null
  const balances = useBalances(address)

  if (!address) {
    return (
      <section className="notice">
        <h1>Your Fundit account</h1>
        <PasskeyLogin />
      </section>
    )
  }

  return (
    <section className="manage">
      <header className="page-head">
        <h1>Add money</h1>
        <p className="muted">Your Fundit account lives on Arc. Add USDC or EURC here, then give from it with your passkey.</p>
        <p>
          Balance:{' '}
          <strong>
            {balances.data !== undefined
              ? `${formatAmount(balances.data.usdc, 'USDC')} and ${formatAmount(balances.data.eurc, 'EURC')}`
              : balances.isError
                ? 'Could not read it'
                : 'Loading...'}
          </strong>
        </p>
        <p className="hint">Network fees on Arc are paid in USDC from this balance, so keep a little extra.</p>
      </header>

      <section className="panel manage-section" aria-labelledby="fund-address-heading">
        <h2 id="fund-address-heading">Send to your Fundit account</h2>
        <p>Send USDC or EURC on Arc to this address from any wallet or exchange.</p>
        <CopyAddress address={address} />
        <AddressQr address={address} label="QR code of your Fundit account address" />
        <p className="hint">This address is on Arc only. Money sent to it on another chain will not arrive.</p>
      </section>

      <section className="panel manage-section" aria-labelledby="fund-wallet-heading">
        <h2 id="fund-wallet-heading">Add from a connected wallet</h2>
        <p className="hint">Send USDC or EURC from a regular wallet on Arc.</p>
        <WalletDeposit account={address} />
      </section>

      {CROSSCHAIN_ENABLED ? (
        <section className="panel manage-section" aria-labelledby="fund-bridge-heading">
          <h2 id="fund-bridge-heading">Add from another chain</h2>
          <p className="hint">Move USDC from a wallet on another chain. Circle delivers it to your Fundit account on Arc.</p>
          <BridgeToAccount recipient={address} />
          <PendingBridgeTracker campaign={address} destination="your Fundit account" />
        </section>
      ) : (
        // A bridge started while the option was on may still arrive, so it stays tracked.
        <PendingBridgeTracker campaign={address} destination="your Fundit account" />
      )}

      <p className="hint">Card and bank coming soon.</p>
    </section>
  )
}

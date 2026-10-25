import { useQuery } from '@tanstack/react-query'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { type Address, type EIP1193Provider, formatUnits } from 'viem'
import { useConnection, WagmiContext } from 'wagmi'
import { ARC_DOMAIN, CCTP_CHAINS, CHAIN_LABELS, type CctpChainKey, REOWN_PROJECT_ID } from '../config'
import { blockingEntry, chainByKey, donateCrossChain, estimateCrossChain, notifyPending, subscribePending } from '../lib/bridge'
import { explainAfterApproval } from '../lib/errors'
import { formatAmount, parseAmount } from '../lib/format'
import { fetchForwardFee } from '../lib/iris'
import { wagmiConfig } from '../wagmi'
import { ConnectWallet } from './ConnectWallet'
import { AmountInput, Button, Field, StatusBox } from './ui'

// The From another chain tab of Add money (behind VITE_CROSSCHAIN). AddMoneyPanel loads this module only when that
// tab first opens, and importing it loads wagmi (../wagmi). The rest of the app loads wagmi only for a wallet account.

const QUOTE_DEBOUNCE_MS = 400

const BRIDGE_PENDING =
  'A transfer to your Fundit account is still on its way. Wait for it to arrive before you send another. Follow it in the Account tab.'
const NO_WALLETS = 'Connecting a wallet is not available on this site right now.'

// Shows Fundit's wallet list (ConnectWallet) in place of the Connect button. Without a Reown project id the
// person sees NO_WALLETS instead.
function useWalletModal() {
  const [open, setOpen] = useState(false)
  const available = REOWN_PROJECT_ID !== ''
  return { available, open, connect: () => setOpen(true), close: () => setOpen(false) }
}

// Bridge Kit from an external wallet on another chain. Circle's forwarder mints the USDC to the Fundit account on Arc.
function BridgeToAccountForm({ recipient }: { recipient: Address }) {
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
        <Button type="submit" block disabled={!canSubmit}>
          {busy ? 'Sending...' : 'Bridge USDC'}
        </Button>
      ) : modal.available ? (
        modal.open ? (
          <ConnectWallet config={wagmiConfig} onConnected={modal.close} />
        ) : (
          <Button block onClick={modal.connect}>
            Connect the wallet that holds the USDC
          </Button>
        )
      ) : (
        <p>{NO_WALLETS}</p>
      )}
    </form>
  )
}

// The bridge form gets the one shared wagmi config through the context only, not WagmiProvider: its Hydrate step
// runs on every render, and with reconnectOnMount={false} it cleared the connections each time My page re-rendered.
export function BridgeToAccount(props: { recipient: Address }) {
  return (
    <WagmiContext.Provider value={wagmiConfig}>
      <BridgeToAccountForm {...props} />
    </WagmiContext.Provider>
  )
}

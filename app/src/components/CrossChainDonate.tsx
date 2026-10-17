import { useAppKit } from '@reown/appkit/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { type Address, type EIP1193Provider, formatUnits, type Hex } from 'viem'
import { arc } from 'viem/chains'
import { useConnection } from 'wagmi'
import { ARC_DOMAIN, CCTP_CHAINS, CHAIN_LABELS, type CctpChainKey } from '../config'
import {
  chainByKey,
  clearBridge,
  ANOTHER_PENDING,
  blockingEntry,
  clearSubmitted,
  donateCrossChain,
  markBridgeMinted,
  estimateCrossChain,
  notifyPending,
  type PendingBridge,
  type PendingCrossChain,
  pendingCrossChain,
  type PendingPayout,
  pendingPayouts,
  type PendingSubmitted,
  subscribePending,
} from '../lib/bridge'
import type { CampaignView } from '../lib/campaigns'
import { explainAfterApproval } from '../lib/errors'
import { bpsToPercent, formatExact, parseAmount } from '../lib/format'
import { fetchForwardFee, fetchTransferStatus, type TransferStatus } from '../lib/iris'

const POLL_MS = 10_000
// Wait for typing to pause before asking for a fee quote.
const QUOTE_DEBOUNCE_MS = 400
// After this the transfer is overdue. Stop polling and point the donor to the explorer.
const MAX_TRACK_MS = 2 * 60 * 60 * 1000

function expectedTime(fast: boolean, chainFast: boolean): string {
  if (fast) return 'About a minute.'
  if (chainFast) return 'About 15 to 20 minutes.'
  // Polygon and Avalanche only offer Standard. Their wait is not one we have measured.
  return 'Standard is the only speed from this chain. The wait depends on the chain.'
}

type Phase = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent'; chain: CctpChainKey } | { kind: 'error'; message: string }

// blocked: another donation to this campaign is unconfirmed, so the form stays disabled and has no submit.
export function CrossChainDonate({
  view,
  onBusyChange,
  blocked = false,
}: {
  view: CampaignView
  onBusyChange?: (busy: boolean) => void
  blocked?: boolean
}) {
  const { address: campaign, summary } = view
  const { open } = useAppKit()
  const { isConnected, address, connector } = useConnection()
  const [sourceKey, setSourceKey] = useState<CctpChainKey>('Base')
  const [fastChoice, setFastChoice] = useState(true)
  const [amountText, setAmountText] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const inFlight = useRef(false)

  const chain = chainByKey(sourceKey)
  const fast = fastChoice && chain.fast
  const parsed = amountText === '' ? null : parseAmount(amountText.trim())
  const amount = parsed?.ok ? parsed.value : null
  // Canonical decimal text for the SDK, so ".5" is sent as "0.5".
  const amountArg = amount === null ? '' : formatUnits(amount, 6)
  const wallet = isConnected && connector ? connector : null

  const [quoteAmount, setQuoteAmount] = useState<bigint | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => setQuoteAmount(amount), QUOTE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [amount])

  // With a wallet, Bridge Kit's own estimate is the fee it will charge. Before that, or if the wallet's
  // network cannot be reached, Circle's public quote.
  const fee = useQuery({
    queryKey: ['xchain-fee', sourceKey, fast, quoteAmount?.toString(), wallet ? address : null],
    queryFn: async (): Promise<{ fee: bigint; source: 'wallet' | 'circle' | 'fallback' }> => {
      const circle = async () => (await fetchForwardFee(chain.domain, ARC_DOMAIN, quoteAmount!, fast)).maxFee
      if (!wallet) return { fee: await circle(), source: 'circle' }
      try {
        const provider = (await wallet.getProvider()) as EIP1193Provider
        const total = await estimateCrossChain({ provider, sourceKey, campaign, amount: formatUnits(quoteAmount!, 6), fast, account: address })
        return { fee: total, source: 'wallet' }
      } catch {
        return { fee: await circle(), source: 'fallback' }
      }
    },
    enabled: quoteAmount !== null && !summary.closed,
    staleTime: 30_000,
    retry: 1,
  })

  // Only a quote for the amount now in the field counts.
  const quote = amount !== null && quoteAmount === amount ? fee.data : undefined
  const reaches = amount !== null && quote !== undefined ? amount - quote.fee : null
  const tooSmall = reaches !== null && reaches <= 0n
  const busy = phase.kind === 'sending'
  const canSubmit = !summary.closed && !blocked && wallet !== null && amount !== null && reaches !== null && !tooSmall && !busy

  async function donate() {
    if (inFlight.current || !canSubmit || !wallet) return
    // Another tab may have started a donation to this campaign since this form loaded. Read the store again
    // before anything is sent, and let every listener in this tab catch up.
    if (blockingEntry(campaign)) {
      setPhase({ kind: 'error', message: ANOTHER_PENDING })
      notifyPending()
      return
    }
    inFlight.current = true
    setPhase({ kind: 'sending' })
    onBusyChange?.(true)
    try {
      const provider = (await wallet.getProvider()) as EIP1193Provider
      await donateCrossChain({ provider, sourceKey, campaign, amount: amountArg, fast, account: address })
      setAmountText('')
      setPhase({ kind: 'sent', chain: sourceKey })
    } catch (err) {
      setPhase({ kind: 'error', message: explainAfterApproval(err) })
    } finally {
      inFlight.current = false
      onBusyChange?.(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void donate()
  }

  return (
    <form className="donate-form" onSubmit={submit} noValidate>
      <fieldset className="donate-fields" disabled={summary.closed || busy || blocked}>
        <div className="form-field">
          <label htmlFor="xchain-source">From</label>
          <select id="xchain-source" value={sourceKey} onChange={(e) => setSourceKey(e.target.value as CctpChainKey)}>
            {CCTP_CHAINS.map((c) => (
              <option key={c.key} value={c.key}>
                {CHAIN_LABELS[c.key]}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label htmlFor="xchain-amount">Amount</label>
          <div className="donate-amount">
            <input
              id="xchain-amount"
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
                <input type="radio" name="xchain-speed" checked={fast} onChange={() => setFastChoice(true)} />
                <span>Fast</span>
              </label>
            )}
            <label className="donate-option">
              <input type="radio" name="xchain-speed" checked={!fast} onChange={() => setFastChoice(false)} />
              <span>Standard</span>
            </label>
          </div>
          <p className="hint">{expectedTime(fast, chain.fast)}</p>
        </fieldset>
      </fieldset>

      {amount !== null && (
        <dl className="donate-breakdown" aria-label="Breakdown">
          <div>
            <dt>{quote?.source === 'fallback' ? "Estimated fee (could not reach your wallet's network)" : 'Transfer fees'}</dt>
            <dd>{quote !== undefined ? formatExact(quote.fee, 'USDC') : fee.isError ? 'Not available' : 'Checking...'}</dd>
          </div>
          <div className="donate-total">
            <dt>Reaches the campaign</dt>
            {/* Bridge Kit's estimate is the most it will charge, so this is a floor. */}
            <dd>{reaches !== null && !tooSmall ? `At least ${formatExact(reaches, 'USDC')}` : '-'}</dd>
          </div>
        </dl>
      )}
      {fee.isError && <p className="field-error">Could not get a fee quote. Try again in a moment.</p>}
      {tooSmall && <p className="field-error">This amount does not cover the transfer fees. Try a larger amount.</p>}
      <p className="hint">
        The transfer fees come out of the amount. You also pay network gas on {CHAIN_LABELS[sourceKey]}. Fundit's
        platform fee ({bpsToPercent(summary.donationFeeBps)}) applies once the donation is counted.
      </p>
      <p className="hint">
        Tips and messages work only when you pay on Arc. The donation counts toward the total as soon as it arrives,
        and shows in the activity list once someone counts it there.
      </p>

      <div className="donate-status" aria-live="polite">
        {busy && <p>Confirm in your wallet. It may ask you to switch network and approve USDC first.</p>}
        {phase.kind === 'sent' && (
          <div className="status-box status-success">
            <p>
              <strong>Your USDC left {CHAIN_LABELS[phase.chain]}.</strong> Follow it on its way to the campaign below.
            </p>
          </div>
        )}
        {phase.kind === 'error' && (
          <div className="status-box status-error">
            <p>{phase.message}</p>
          </div>
        )}
      </div>

      {blocked && !busy ? null : !wallet && !summary.closed ? (
        <button type="button" className="btn btn-lg donate-submit" onClick={() => open()}>
          Connect wallet to donate
        </button>
      ) : (
        <button type="submit" className="btn btn-lg donate-submit" disabled={!canSubmit}>
          {busy ? 'Donating...' : 'Donate'}
        </button>
      )}
    </form>
  )
}

type TrackerKind = 'donation' | 'payout'

function forCampaign(campaign: Address, kind: TrackerKind): (PendingCrossChain | PendingPayout)[] {
  const all = kind === 'payout' ? pendingPayouts() : pendingCrossChain()
  return all.filter((b) => b.campaign.toLowerCase() === campaign.toLowerCase())
}

// Cross-chain transfers to this address that have not reached it yet, or with kind 'payout', this campaign's
// payouts on their way from Arc to another chain. Read from localStorage, so they survive a reload and keep
// showing until dismissed. destination names the address in the text.
export function PendingBridgeTracker({
  campaign,
  destination = 'the campaign',
  kind = 'donation',
}: {
  campaign: Address
  destination?: string
  kind?: TrackerKind
}) {
  const [entries, setEntries] = useState(() => forCampaign(campaign, kind))

  useEffect(() => {
    const reload = () => setEntries(forCampaign(campaign, kind))
    reload()
    return subscribePending(reload)
  }, [campaign, kind])

  if (entries.length === 0) return null
  return (
    <section className="bridge-tracker" aria-label={kind === 'payout' ? 'Payouts on the way' : 'Cross-chain transfers on the way'}>
      {entries.map((e) =>
        e.kind === 'submitted' ? <SubmittedRow key={e.id} entry={e} /> : <BridgeRow key={e.burnTx} entry={e} destination={destination} />,
      )}
    </section>
  )
}

type RowStatus = TransferStatus | 'expired'

// Dismissing a transfer that has not arrived forgets money that may still move (and unblocks donating), so it asks first.
const DISMISS_UNKNOWN = 'This transfer may still arrive. Dismiss it anyway?'

// Text for one tracked burn: a donation on its way to Arc, or a payout on its way from Arc.
function rowText(entry: PendingBridge | PendingPayout, destination: string) {
  if (entry.kind === 'payout') {
    const to = CHAIN_LABELS[CCTP_CHAINS.find((c) => c.domain === entry.destDomain)!.key]
    return {
      what: `${entry.amount} USDC to ${to}`,
      arrived: 'arrived.',
      attested: `Circle confirmed it. Arriving on ${to} now.`,
      waiting: 'Waiting for Arc to confirm it.',
      explorer: arc.blockExplorers.default.url,
      thanks: null,
    }
  }
  const from = CCTP_CHAINS.find((c) => c.domain === entry.srcDomain)!
  return {
    what: `${entry.amount} USDC from ${CHAIN_LABELS[from.key]}`,
    arrived: `reached ${destination}.`,
    attested: 'Circle confirmed it. Arriving on Arc now.',
    waiting: `Waiting for ${CHAIN_LABELS[from.key]} to confirm it.`,
    explorer: from.viemChain.blockExplorers?.default.url,
    thanks: destination === 'the campaign' ? ' Thank you.' : null,
  }
}

function BridgeRow({ entry, destination }: { entry: PendingBridge | PendingPayout; destination: string }) {
  const { campaign, burnTx, srcDomain, createdAt } = entry
  const queryClient = useQueryClient()
  const overdue = () => Date.now() - createdAt > MAX_TRACK_MS
  // An overdue entry still gets one last look at Iris before it shows as expired: it may have arrived while
  // the tab was closed.
  const [status, setStatus] = useState<RowStatus>(() => (entry.minted ? 'minted' : 'pending'))
  const done = status === 'minted' || status === 'expired'

  useEffect(() => {
    if (done) return
    let stopped = false
    let polling = false
    async function poll() {
      if (stopped || polling || document.visibilityState !== 'visible') return
      const last = overdue()
      polling = true
      const next = await fetchTransferStatus(srcDomain, burnTx)
      polling = false
      if (stopped) return
      setStatus(next !== 'minted' && last ? 'expired' : next)
      if (next === 'minted') {
        // Recorded, so this transfer stops blocking a new donation.
        markBridgeMinted(burnTx)
        // raised() already counts unaccounted funds, so the campaign total is right without settle().
        void queryClient.invalidateQueries({ queryKey: ['campaign', campaign.toLowerCase()] })
        void queryClient.invalidateQueries({ queryKey: ['activity', campaign.toLowerCase()] })
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), POLL_MS)
    const onVisible = () => void poll()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [done, campaign, burnTx, srcDomain, createdAt, queryClient])

  const text = rowText(entry, destination)
  const what = text.what
  return (
    <div className={status === 'minted' ? 'status-box status-success' : 'status-box'}>
      {status === 'minted' ? (
        <p>
          <strong>
            {what} {text.arrived}
          </strong>
          {text.thanks}
        </p>
      ) : status === 'expired' ? (
        <>
          <p>
            <strong>{what} is taking longer than expected.</strong>
          </p>
          <p>
            <ExplorerLink chainUrl={text.explorer} hash={burnTx} />
          </p>
        </>
      ) : (
        <p>
          <strong>{what} is on its way.</strong>{' '}
          {status === 'attested'
            ? text.attested
            : status === 'unknown'
              ? 'Could not reach Circle to check. Trying again.'
              : text.waiting}
        </p>
      )}
      {done && (
        <div className="donate-actions">
          <button type="button" className="btn btn-outline" onClick={() => (status === 'minted' || window.confirm(DISMISS_UNKNOWN)) && clearBridge(burnTx)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

// The wallet sent, but no burn hash was recorded (the tab closed first). Nothing to poll; it expires like the rest.
function SubmittedRow({ entry }: { entry: PendingSubmitted }) {
  const chain = CCTP_CHAINS.find((c) => c.domain === entry.srcDomain)!
  const what = `${entry.amount} USDC from ${CHAIN_LABELS[chain.key]}`
  const [overdue, setOverdue] = useState(() => Date.now() - entry.createdAt > MAX_TRACK_MS)
  useEffect(() => {
    if (overdue) return
    const timer = setTimeout(() => setOverdue(true), entry.createdAt + MAX_TRACK_MS - Date.now())
    return () => clearTimeout(timer)
  }, [overdue, entry.createdAt])
  return (
    <div className="status-box">
      {overdue ? (
        <p>
          <strong>{what} was not confirmed.</strong> Check your wallet's activity on {CHAIN_LABELS[chain.key]}.
        </p>
      ) : (
        <p>
          <strong>{what}: Submitted, waiting for confirmation.</strong>
        </p>
      )}
      {overdue && (
        <div className="donate-actions">
          <button type="button" className="btn btn-outline" onClick={() => window.confirm(DISMISS_UNKNOWN) && clearSubmitted(entry.id)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

function ExplorerLink({ chainUrl, hash }: { chainUrl: string | undefined; hash: Hex }) {
  if (!chainUrl?.startsWith('https://')) return null
  return (
    <a href={`${chainUrl}/tx/${hash}`} target="_blank" rel="noopener noreferrer">
      Check the explorer
    </a>
  )
}

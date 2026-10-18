import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { Address, Hex } from 'viem'
import { ARC_DOMAIN, CCTP_CHAINS, CHAIN_LABELS, EXPLORER_URL } from '../config'
import {
  clearBridge,
  clearSubmitted,
  markBridgeMinted,
  type PendingBridge,
  type PendingCrossChain,
  pendingCrossChain,
  type PendingPayout,
  pendingPayouts,
  type PendingSubmitted,
  subscribePending,
} from '../lib/bridge'
import { fetchTransferStatus, type TransferStatus } from '../lib/iris'

const POLL_MS = 10_000
// After this the transfer is overdue. Stop polling and point the person to the explorer.
const MAX_TRACK_MS = 2 * 60 * 60 * 1000

type TrackerKind = 'donation' | 'payout'

function forCampaign(campaign: Address, kind: TrackerKind): (PendingCrossChain | PendingPayout)[] {
  const all = kind === 'payout' ? pendingPayouts() : pendingCrossChain()
  return all.filter((b) => b.campaign.toLowerCase() === campaign.toLowerCase())
}

// Cross-chain transfers to this address that have not reached it yet, or with kind 'payout', this campaign's
// payouts on their way from Arc to another chain. Read from localStorage, so they survive a reload and keep
// showing until dismissed. destination names the address in the text. account is the Fundit account that sent a
// payout from Arc, for the explorer link once it is overdue; without it the entry's own address is linked (Send
// money out saves the account there).
export function PendingBridgeTracker({
  campaign,
  account,
  destination = 'the Fundit',
  kind = 'donation',
}: {
  campaign: Address
  account?: Address
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
        e.kind === 'submitted' ? <SubmittedRow key={e.id} entry={e} /> : <BridgeRow key={e.burnTx} entry={e} destination={destination} account={account ?? campaign} />,
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
      explorer: EXPLORER_URL,
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
    thanks: destination === 'the Fundit' ? ' Thank you.' : null,
  }
}

function BridgeRow({ entry, destination, account }: { entry: PendingBridge | PendingPayout; destination: string; account: Address }) {
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
      ) : status === 'expired' && srcDomain === ARC_DOMAIN ? (
        // Sent from the Fundit account on Arc: there is no other wallet to check, so link the account itself.
        <p>
          <strong>{what} has not been confirmed yet.</strong>{' '}
          <AccountActivityLink account={account} />
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

function AccountActivityLink({ account }: { account: Address }) {
  if (!EXPLORER_URL.startsWith('https://')) return null
  return (
    <a href={`${EXPLORER_URL}/address/${account}`} target="_blank" rel="noopener noreferrer">
      See your Fundit account's activity on the Arc explorer.
    </a>
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

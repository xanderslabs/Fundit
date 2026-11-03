import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { CCTP_CHAINS, CHAIN_LABELS, EXPLORER_URL } from '../config'
import { clearPayout, markPayoutMinted, type PendingPayout, pendingPayouts, subscribePending } from '../lib/bridge'
import { fetchTransferStatus, type TransferStatus } from '../lib/iris'
import { Button, StatusBox } from './ui'
import './Form.css'

const POLL_MS = 10_000
// After this the transfer is overdue. Stop polling and point the person to the explorer.
const MAX_TRACK_MS = 2 * 60 * 60 * 1000

function forCampaign(campaign: Address): PendingPayout[] {
  return pendingPayouts().filter((b) => b.campaign.toLowerCase() === campaign.toLowerCase())
}

// This campaign's payouts, or this Fundit account's sends, on their way from Arc to another chain. Read from
// localStorage, so they survive a reload and keep showing until dismissed. account is the Fundit account that sent a
// payout from Arc, for the explorer link once it is overdue; without it the entry's own address is linked (Send
// money out saves the account there).
export function PendingBridgeTracker({ campaign, account }: { campaign: Address; account?: Address }) {
  const [entries, setEntries] = useState(() => forCampaign(campaign))

  useEffect(() => {
    const reload = () => setEntries(forCampaign(campaign))
    reload()
    return subscribePending(reload)
  }, [campaign])

  if (entries.length === 0) return null
  return (
    <section className="bridge-tracker" aria-label="Payouts on the way">
      {entries.map((e) => (
        <BridgeRow key={e.burnTx} entry={e} account={account ?? campaign} />
      ))}
    </section>
  )
}

type RowStatus = TransferStatus | 'expired'

// Dismissing a transfer that has not arrived forgets money that may still move, so it asks first.
const DISMISS_UNKNOWN = 'This transfer may still arrive. Dismiss it anyway?'

// Text for one tracked burn: a payout on its way from Arc.
function rowText(entry: PendingPayout) {
  const to = CHAIN_LABELS[CCTP_CHAINS.find((c) => c.domain === entry.destDomain)!.key]
  return {
    what: `${entry.amount} USDC to ${to}`,
    arrived: 'arrived.',
    attested: `Circle confirmed it. Arriving on ${to} now.`,
    waiting: 'Waiting for Arc to confirm it.',
  }
}

function BridgeRow({ entry, account }: { entry: PendingPayout; account: Address }) {
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
        // Recorded, so the row stays as arrived after a reload.
        markPayoutMinted(burnTx)
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

  const text = rowText(entry)
  const what = text.what
  return (
    <StatusBox tone={status === 'minted' ? 'success' : 'info'}>
      {status === 'minted' ? (
        <p>
          <strong>
            {what} {text.arrived}
          </strong>
        </p>
      ) : status === 'expired' ? (
        // Sent from Arc: there is no other wallet to check, so link the account itself.
        <p>
          <strong>{what} has not been confirmed yet.</strong>{' '}
          <AccountActivityLink account={account} />
        </p>
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
        <div className="form-actions">
          <Button variant="secondary" onClick={() => (status === 'minted' || window.confirm(DISMISS_UNKNOWN)) && clearPayout(burnTx)}>
            Dismiss
          </Button>
        </div>
      )}
    </StatusBox>
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

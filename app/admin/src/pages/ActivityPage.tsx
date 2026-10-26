import { useState } from 'react'
import { EmptyState } from '../../../src/components/ui'
import { matchesWorker } from '../lib/api'
import type { ScanEvent } from '../lib/historyScan'
import { ADMIN_NETWORKS } from '../lib/networks'
import { STALE_AFTER_MS, useSnapshot } from '../lib/queries'
import { type SettingChange, settingChanges } from '../lib/settingsHistory'
import { blockClock } from '../lib/trends'
import { useScan } from '../scan/ScanProvider'
import { Address } from '../ui/Address'
import { ago, Card } from '../ui/Card'
import { ExternalLinkIcon } from '../ui/icons'
import { ScanNote } from '../ui/ScanNote'
import { usePanel } from '../ui/Shell'

type Kind = ScanEvent['kind']

const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'FeesUpdated', label: 'Fees' },
  { kind: 'TreasuryUpdated', label: 'Treasury' },
  { kind: 'FeaturedUpdated', label: 'Featured Fundit' },
  { kind: 'CreationPausedSet', label: 'New Fundits paused' },
  { kind: 'EurcPayoutDomainSet', label: 'EURC payout domain' },
  { kind: 'CampaignCreatorChanged', label: 'Creator of a Fundit' },
  { kind: 'OwnershipTransferStarted', label: 'Ownership transfer started' },
  { kind: 'OwnershipTransferred', label: 'Ownership moved' },
]
const LABEL = Object.fromEntries(KINDS.map((k) => [k.kind, k.label])) as Record<Kind, string>
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

export function ActivityPage() {
  const { session, network } = usePanel()
  const snapshot = useSnapshot(session, network)
  const scan = useScan()
  const [filter, setFilter] = useState<'all' | Kind>('all')
  const { explorerUrl } = ADMIN_NETWORKS[network]

  if (!matchesWorker(session, network)) return <p className="admin-error">This panel was built for another network.</p>

  const state = snapshot.isError && !snapshot.data ? 'error' : scan.state ? 'ready' : 'loading'
  const partial = scan.status.kind !== 'caughtUp'
  const nowMs = Date.now()
  const clock = snapshot.data ? blockClock(snapshot.data) : null
  const all = scan.state ? settingChanges(scan.state.events) : []
  const rows = filter === 'all' ? all : all.filter((c) => c.kind === filter)

  const show = (v: string) => (ADDRESS.test(v) ? <Address address={v as `0x${string}`} network={network} /> : v)
  const when = (c: SettingChange) => (clock ? `About ${ago(nowMs - Number(clock(c.blockNumber)) * 1000)}` : `Block ${c.blockNumber}`)

  return (
    <Card
      title="Settings changes"
      state={state}
      updatedAt={snapshot.dataUpdatedAt || undefined}
      staleAfterMs={STALE_AFTER_MS}
      onRetry={() => void snapshot.refetch()}
      error={snapshot.error}
      source={clock ? 'From the factory events in the history scan. Times are estimated from block numbers.' : 'From the factory events in the history scan.'}
    >
      <div className="admin-table-tools">
        <select className="select admin-filter" aria-label="Filter by kind" value={filter} onChange={(e) => setFilter(e.target.value as 'all' | Kind)}>
          <option value="all">All changes</option>
          {KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
        <p className="admin-note" aria-live="polite">
          {rows.length === all.length ? `${all.length} changes` : `${rows.length} of ${all.length} changes`}
        </p>
      </div>
      <ScanNote />
      {rows.length === 0 ? (
        <EmptyState>
          {all.length > 0
            ? 'No change of that kind.'
            : partial
              ? 'No settings changes found yet. The history is still being read.'
              : 'No settings have changed yet.'}
        </EmptyState>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Change</th>
                <th scope="col">Old</th>
                <th scope="col">New</th>
                <th scope="col">When</th>
                <th scope="col">Transaction</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <tr key={`${c.txHash}:${c.kind}:${i}`}>
                  <td>
                    <span className="admin-change-kind">{LABEL[c.kind]}</span>
                    {c.fundit && <Address address={c.fundit} network={network} label="Fundit address" />}
                  </td>
                  <td data-label="Old">{c.old === null ? <span className="admin-muted">First change</span> : show(c.old)}</td>
                  <td data-label="New">{show(c.next)}</td>
                  <td data-label="When" title={`Block ${c.blockNumber}`}>
                    {when(c)}
                  </td>
                  <td data-label="Transaction">
                    <a
                      className="admin-icon-button admin-icon-button-sm"
                      href={`${explorerUrl}/tx/${c.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="View transaction on explorer"
                    >
                      <ExternalLinkIcon />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

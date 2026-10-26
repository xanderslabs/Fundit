import { type ReactNode, useId, useState } from 'react'
import { Badge, Dialog, EmptyState } from '../../../src/components/ui'
import { formatExact } from '../../../src/lib/format'
import { matchesWorker } from '../lib/api'
import type { ScanState } from '../lib/historyScan'
import { type AdminNetwork, ADMIN_NETWORKS } from '../lib/networks'
import { STALE_AFTER_MS, useSnapshot } from '../lib/queries'
import type { FunditSnapshot } from '../lib/snapshot'
import { visible } from '../lib/stats'
import { useScan } from '../scan/ScanProvider'
import { Address } from '../ui/Address'
import { Amount } from '../ui/Amount'
import { Card } from '../ui/Card'
import { ChevronDownIcon, ExternalLinkIcon } from '../ui/icons'
import { usePanel } from '../ui/Shell'

type Column = 'title' | 'creator' | 'token' | 'raised' | 'goal' | 'gifts' | 'created' | 'status'
type Sort = { column: Column; desc: boolean }

const COLUMNS: { key: Column; label: string; numeric?: boolean }[] = [
  { key: 'title', label: 'Title' },
  { key: 'creator', label: 'Creator' },
  { key: 'token', label: 'Currency' },
  { key: 'raised', label: 'Raised', numeric: true },
  { key: 'goal', label: 'Goal', numeric: true },
  { key: 'gifts', label: 'Gifts', numeric: true },
  { key: 'created', label: 'Created', numeric: true },
  { key: 'status', label: 'Status' },
]

const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })

function createdDate(r: FunditSnapshot): string {
  return date.format(new Date(Number(r.createdAt) * 1000))
}

// Gifts per Fundit from the history scan, counted the same way as the Gifts page (test donors only with test data
// on). A Fundit the scan has not read yet has no count.
function giftCounts(scan: ScanState | null, showTest: boolean, network: AdminNetwork): (r: FunditSnapshot) => number | null {
  if (!scan) return () => null
  const { testCreators } = ADMIN_NETWORKS[network]
  const covered = new Set(scan.covered.map((a) => a.toLowerCase()))
  const counts = new Map<string, number>()
  for (const e of scan.events) {
    if (e.kind !== 'Donated') continue
    if (!showTest && testCreators.includes((e.args.donor as string).toLowerCase())) continue
    const key = e.address.toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return (r) => {
    const key = r.address.toLowerCase()
    return covered.has(key) ? (counts.get(key) ?? 0) : null
  }
}

function compare(a: FunditSnapshot, b: FunditSnapshot, column: Column, gifts: (r: FunditSnapshot) => number | null): number {
  const big = (x: bigint, y: bigint) => (x === y ? 0 : x < y ? -1 : 1)
  switch (column) {
    case 'title':
      return a.title.localeCompare(b.title)
    case 'creator':
      return a.creator.toLowerCase().localeCompare(b.creator.toLowerCase())
    case 'token':
      return a.token.localeCompare(b.token)
    // Amounts of one token sort together; USDC and EURC are compared by units only to order rows, never added.
    case 'raised':
      return a.token.localeCompare(b.token) || big(a.raised, b.raised)
    case 'goal':
      return a.token.localeCompare(b.token) || big(a.goal, b.goal)
    case 'gifts':
      return (gifts(a) ?? -1) - (gifts(b) ?? -1)
    case 'created':
      return big(a.createdAtBlock, b.createdAtBlock)
    case 'status':
      return Number(a.closed) - Number(b.closed)
  }
}

function matches(r: FunditSnapshot, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return r.title.toLowerCase().includes(q) || r.address.toLowerCase().includes(q) || r.creator.toLowerCase().includes(q)
}

function Title({ row }: { row: FunditSnapshot }) {
  return row.title.trim() ? <>{row.title}</> : <span className="admin-muted">Untitled</span>
}

function Status({ closed }: { closed: boolean }) {
  return closed ? <Badge>Closed</Badge> : <Badge tone="success">Open</Badge>
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="admin-row">
      <dt className="admin-row-label">{label}</dt>
      <dd className="admin-row-value">{children}</dd>
    </div>
  )
}

function Drawer({ row, gifts, network, onClose }: { row: FunditSnapshot; gifts: number | null; network: AdminNetwork; onClose(): void }) {
  const { explorerUrl } = ADMIN_NETWORKS[network]
  const headingId = useId()
  const t = row.token
  return (
    <Dialog open onClose={onClose} labelledBy={headingId} placement="right">
      <h2 id={headingId} className="ui-dialog-title admin-drawer-title" dir="auto">
        {row.title.trim() || 'Untitled Fundit'}
      </h2>
      <div className="admin-drawer">
        <div className="admin-drawer-tags">
          <Status closed={row.closed} />
          {row.isTest && <Badge tone="attention">Test</Badge>}
        </div>
        <dl className="admin-details">
          <Detail label="Fundit">
            <Address address={row.address} network={network} label="Fundit address" />
          </Detail>
          <Detail label="Creator">
            <Address address={row.creator} network={network} label="creator address" />
          </Detail>
          <Detail label="Currency">{t}</Detail>
          <Detail label="Goal">
            <Amount value={row.goal} token={t} />
          </Detail>
          <Detail label="Raised">
            <Amount value={row.raised} token={t} />
          </Detail>
          <Detail label="Available">
            <Amount value={row.available} token={t} />
          </Detail>
          <Detail label="Withdrawn">
            <Amount value={row.withdrawn} token={t} />
          </Detail>
          <Detail label="Fees booked">
            <Amount value={row.feesAccrued} token={t} />
          </Detail>
          <Detail label="Not yet counted">
            <span className="admin-amount">{formatExact(row.unaccounted, t)}</span>
          </Detail>
          <Detail label="Donation fee">{`${row.donationFeeBps} bps`}</Detail>
          <Detail label="Gifts">{gifts === null ? 'Scanning...' : gifts}</Detail>
          <Detail label="Created">
            <span className="admin-amount">{dateTime.format(new Date(Number(row.createdAt) * 1000))} UTC</span>
          </Detail>
          <Detail label="Created in block">
            <span className="admin-amount">{row.createdAtBlock.toString()}</span>
          </Detail>
        </dl>
        <div className="admin-drawer-links">
          {/* fundit.fun is the mainnet site; testnet Fundits have no public page. */}
          {network === 'mainnet' && (
            <a className="ui-btn ui-btn-secondary" href={`https://fundit.fun/c/${row.address}`} target="_blank" rel="noopener noreferrer">
              Open public page <ExternalLinkIcon />
            </a>
          )}
          <a className="ui-btn ui-btn-secondary" href={`${explorerUrl}/address/${row.address}`} target="_blank" rel="noopener noreferrer">
            View on explorer <ExternalLinkIcon />
          </a>
        </div>
      </div>
    </Dialog>
  )
}

// Every Fundit from the factory, searchable and sortable, with a side drawer per Fundit.
export function FunditsPage() {
  const { session, network, showTest } = usePanel()
  const snapshot = useSnapshot(session, network)
  const scan = useScan()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>({ column: 'created', desc: true })
  const [open, setOpen] = useState<FunditSnapshot['address'] | null>(null)

  if (!matchesWorker(session, network)) return <p className="admin-error">This panel was built for another network.</p>

  const gifts = giftCounts(scan.state, showTest, network)
  const all = snapshot.data ? visible(snapshot.data, showTest) : []
  const rows = all.filter((r) => matches(r, query))
  rows.sort((a, b) => (sort.desc ? -1 : 1) * compare(a, b, sort.column, gifts))
  const selected = open ? snapshot.data?.find((r) => r.address === open) : undefined

  function sortBy(column: Column, numeric?: boolean) {
    setSort((s) => (s.column === column ? { column, desc: !s.desc } : { column, desc: numeric === true }))
  }

  return (
    <div className="admin-page">
      <Card
        title="Fundits"
        state={snapshot.data ? 'ready' : snapshot.isError ? 'error' : 'loading'}
        updatedAt={snapshot.dataUpdatedAt || undefined}
        staleAfterMs={STALE_AFTER_MS}
        onRefresh={() => void snapshot.refetch()}
        onRetry={() => void snapshot.refetch()}
        source="Read from the factory's Fundit list and each Fundit's summary. Gifts come from the history scan."
      >
        <div className="admin-table-tools">
          <input
            className="ui-input admin-search"
            type="search"
            placeholder="Search by title or address"
            aria-label="Search Fundits by title or address"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {/* Phones show rows as blocks without the header row, so sorting moves here. */}
          <select
            className="select admin-sort-select"
            aria-label="Sort Fundits"
            value={`${sort.column}:${sort.desc ? 'desc' : 'asc'}`}
            onChange={(e) => {
              const [column, dir] = e.target.value.split(':') as [Column, string]
              setSort({ column, desc: dir === 'desc' })
            }}
          >
            {COLUMNS.flatMap((c) => [
              <option key={`${c.key}:asc`} value={`${c.key}:asc`}>
                {`${c.label}, ${c.numeric ? 'lowest' : 'A to Z'} first`}
              </option>,
              <option key={`${c.key}:desc`} value={`${c.key}:desc`}>
                {`${c.label}, ${c.numeric ? (c.key === 'created' ? 'newest' : 'highest') : 'Z to A'} first`}
              </option>,
            ])}
          </select>
          <p className="admin-note" aria-live="polite">
            {rows.length === all.length ? `${all.length} Fundits` : `${rows.length} of ${all.length} Fundits`}
          </p>
        </div>
        {rows.length === 0 ? (
          <EmptyState>{all.length === 0 ? 'No Fundits yet.' : 'No Fundit matches that search.'}</EmptyState>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  {COLUMNS.map((c) => {
                    const active = sort.column === c.key
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        className={c.numeric ? 'admin-num' : undefined}
                        aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : undefined}
                      >
                        <button type="button" className="admin-sort" onClick={() => sortBy(c.key, c.numeric)}>
                          {c.label}
                          <span className={`admin-sort-mark${active ? '' : ' admin-sort-idle'}${active && !sort.desc ? ' admin-sort-up' : ''}`}>
                            <ChevronDownIcon />
                          </span>
                        </button>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const g = gifts(r)
                  return (
                    <tr key={r.address} className="admin-table-row" onClick={() => setOpen(r.address)}>
                      <td>
                        <div className="admin-title-cell">
                          <button type="button" className="admin-row-open" onClick={() => setOpen(r.address)} title={r.title || undefined}>
                            <span className="admin-truncate" dir="auto">
                              <Title row={r} />
                            </span>
                          </button>
                          {r.isTest && <Badge tone="attention">Test</Badge>}
                        </div>
                      </td>
                      {/* The copy and explorer buttons work without opening the drawer. */}
                      <td data-label="Creator" onClick={(e) => e.stopPropagation()}>
                        <Address address={r.creator} network={network} label="creator address" />
                      </td>
                      <td data-label="Currency">{r.token}</td>
                      <td className="admin-num" data-label="Raised">
                        <Amount value={r.raised} token={r.token} />
                      </td>
                      <td className="admin-num" data-label="Goal">
                        <Amount value={r.goal} token={r.token} />
                      </td>
                      <td className="admin-num" data-label="Gifts">
                        {g === null ? <span className="admin-muted">Scanning...</span> : g}
                      </td>
                      <td className="admin-num" data-label="Created">
                        {createdDate(r)}
                      </td>
                      <td data-label="Status">
                        <Status closed={r.closed} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {selected && <Drawer row={selected} gifts={gifts(selected)} network={network} onClose={() => setOpen(null)} />}
    </div>
  )
}

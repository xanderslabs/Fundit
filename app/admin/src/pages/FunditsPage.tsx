import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Actions, Badge, Button, Dialog, EmptyState, Field } from '../../../src/components/ui'
import { formatExact } from '../../../src/lib/format'
import { matchesWorker, type ModState, setModeration } from '../lib/api'
import type { ScanState } from '../lib/historyScan'
import { type AdminNetwork, ADMIN_NETWORKS } from '../lib/networks'
import { moderationKey, STALE_AFTER_MS, useModeration, useModerationHistory, useSnapshot } from '../lib/queries'
import type { FunditSnapshot } from '../lib/snapshot'
import { visible } from '../lib/stats'
import { useScan } from '../scan/ScanProvider'
import { Address } from '../ui/Address'
import { Amount } from '../ui/Amount'
import { Card } from '../ui/Card'
import { ChevronDownIcon, ExternalLinkIcon } from '../ui/icons'
import { ScanNote } from '../ui/ScanNote'
import { usePanel } from '../ui/Shell'

type Column = 'title' | 'creator' | 'token' | 'raised' | 'goal' | 'gifts' | 'created' | 'status' | 'review'
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
  { key: 'review', label: 'Review' },
]

// No row in the moderation list means normal, but only once the list has loaded: until then the state is loading,
// and after a failed load it is unknown, so a Removed Fundit is never shown as Normal.
type Review = ModState | 'normal' | 'loading' | 'unknown'
const REVIEW_LABEL: Record<Review, string> = {
  normal: 'Normal',
  review: 'Under review',
  removed: 'Removed',
  cleared: 'Cleared',
  loading: 'Loading...',
  unknown: 'Unknown',
}
const REVIEW_TONE: Record<Review, 'neutral' | 'success' | 'attention'> = {
  normal: 'neutral',
  review: 'attention',
  removed: 'attention',
  cleared: 'success',
  loading: 'neutral',
  unknown: 'attention',
}
const FILTERS: { value: 'all' | ModState; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'review', label: 'Under review' },
  { value: 'removed', label: 'Removed' },
  { value: 'cleared', label: 'Cleared' },
]
const NOTE_MAX = 500

function ReviewBadge({ state }: { state: Review }) {
  return <Badge tone={REVIEW_TONE[state]}>{REVIEW_LABEL[state]}</Badge>
}

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

function compare(a: FunditSnapshot, b: FunditSnapshot, column: Column, gifts: (r: FunditSnapshot) => number | null, review: (r: FunditSnapshot) => Review): number {
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
    case 'review':
      return REVIEW_LABEL[review(a)].localeCompare(REVIEW_LABEL[review(b)])
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

// The owner's review state for one Fundit: the current state, a form to change it with a confirm step (the panel
// cannot use window.confirm), and the change history.
function ReviewSection({ address, network, current }: { address: string; network: AdminNetwork; current: Review }) {
  const queryClient = useQueryClient()
  const history = useModerationHistory(network, address)
  const id = useId()
  const [state, setState] = useState<ModState>('review')
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await setModeration(network, address.toLowerCase(), state, note.trim())
      await queryClient.invalidateQueries({ queryKey: moderationKey(network) })
      setConfirming(false)
      setNote('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review state was not saved')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="admin-review" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`} className="admin-review-title">
        Review state
      </h3>
      <div className="admin-drawer-tags">
        <ReviewBadge state={current} />
      </div>
      <Field label="New state" id={`${id}-state`}>
        <select className="select" value={state} disabled={confirming} onChange={(e) => setState(e.target.value as ModState)}>
          <option value="review">Under review</option>
          <option value="removed">Removed</option>
          <option value="cleared">Cleared</option>
        </select>
      </Field>
      <Field label="Note (stays in the admin panel)" id={`${id}-note`}>
        <textarea className="ui-input" rows={3} maxLength={NOTE_MAX} value={note} disabled={confirming} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {confirming ? (
        <div className="admin-review-confirm" role="group" aria-label="Confirm review state">
          <p className="admin-note">{`Set this Fundit to "${REVIEW_LABEL[state]}"? Money is not affected.`}</p>
          <Actions>
            <Button variant="secondary" disabled={saving} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button loading={saving} onClick={() => void save()}>
              Confirm
            </Button>
          </Actions>
        </div>
      ) : (
        <>
          <Button disabled={state === current} onClick={() => setConfirming(true)}>
            Save
          </Button>
          {state === current && <p className="admin-note">This is already the current state.</p>}
        </>
      )}
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      <h4 className="admin-review-subtitle">History</h4>
      {history.isError ? (
        <p className="admin-error">Could not load the history.</p>
      ) : !history.data ? (
        <p className="admin-muted">Loading...</p>
      ) : history.data.length === 0 ? (
        <p className="admin-muted">No changes yet.</p>
      ) : (
        <ul className="admin-review-history">
          {history.data.map((h, i) => (
            <li key={`${h.at}-${i}`}>
              <span className="admin-amount">{dateTime.format(new Date(h.at))} UTC</span>{' '}
              {`${h.oldState ? REVIEW_LABEL[h.oldState] : 'Normal'} to ${REVIEW_LABEL[h.newState]}`}
              {h.note && <span className="admin-review-note" dir="auto">{h.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Drawer({ row, gifts, network, review, onClose }: { row: FunditSnapshot; gifts: number | null; network: AdminNetwork; review: Review; onClose(): void }) {
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
        <ReviewSection address={row.address} network={network} current={review} />
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
  const [filter, setFilter] = useState<'all' | ModState>('all')
  const moderation = useModeration(network)
  const [params] = useSearchParams()
  const deepLinked = useRef(false)

  // ?open=<address> opens that Fundit's drawer once, when the snapshot has it (the case differs from the API's).
  const wanted = params.get('open')?.toLowerCase()
  const notOnNetwork = !!wanted && snapshot.data !== undefined && !snapshot.data.some((r) => r.address.toLowerCase() === wanted)
  useEffect(() => {
    if (deepLinked.current || !wanted || !snapshot.data) return
    deepLinked.current = true
    const hit = snapshot.data.find((r) => r.address.toLowerCase() === wanted)
    if (hit) setOpen(hit.address)
  }, [wanted, snapshot.data])

  if (!matchesWorker(session, network)) return <p className="admin-error">This panel was built for another network.</p>

  const gifts = giftCounts(scan.state, showTest, network)
  const states = new Map((moderation.data ?? []).map((m) => [m.address.toLowerCase(), m.state]))
  const loaded = moderation.data !== undefined
  const review = (r: FunditSnapshot): Review =>
    loaded ? (states.get(r.address.toLowerCase()) ?? 'normal') : moderation.isError ? 'unknown' : 'loading'
  const all = snapshot.data ? visible(snapshot.data, showTest) : []
  const rows = all.filter((r) => matches(r, query) && (filter === 'all' || review(r) === filter))
  rows.sort((a, b) => (sort.desc ? -1 : 1) * compare(a, b, sort.column, gifts, review))
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
        error={snapshot.error}
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
          <select className="select admin-filter-select" aria-label="Filter Fundits by review state" disabled={!loaded} value={filter} onChange={(e) => setFilter(e.target.value as 'all' | ModState)}>
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
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
          {moderation.isError && (
            <p className="admin-error" role="alert">
              Review states could not be loaded.{' '}
              <Button variant="ghost" onClick={() => void moderation.refetch()}>
                Retry
              </Button>
            </p>
          )}
          {notOnNetwork && <p className="admin-note">{`This Fundit is not on ${network}.`}</p>}
          <p className="admin-note" aria-live="polite">
            {rows.length === all.length ? `${all.length} Fundits` : `${rows.length} of ${all.length} Fundits`}
          </p>
        </div>
        {/* Gift counts come from the history scan, so they are partial until it has caught up. */}
        {all.length > 0 && <ScanNote />}
        {rows.length === 0 ? (
          <EmptyState>{all.length === 0 ? 'No Fundits yet.' : 'No Fundit matches that search or filter.'}</EmptyState>
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
                      <td data-label="Review">
                        <ReviewBadge state={review(r)} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {selected && <Drawer row={selected} gifts={gifts(selected)} network={network} review={review(selected)} onClose={() => setOpen(null)} />}
    </div>
  )
}

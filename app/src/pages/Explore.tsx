import { useQueries } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { CampaignGrid, LoadError } from '../components/CampaignGrid'
import { campaignsQuery, PAGE_SIZE } from '../hooks/useCampaigns'
import type { CampaignView } from '../lib/campaigns'

type Sort = 'newest' | 'raised' | 'closest'

const SORTS: { value: Sort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'raised', label: 'Most raised' },
  { value: 'closest', label: 'Closest to goal' },
]

// Share of the goal raised, in millionths, so bigint amounts compare without rounding.
function share(v: CampaignView): bigint {
  return v.summary.goal > 0n ? (v.summary.raised * 1_000_000n) / v.summary.goal : 0n
}

function compare(sort: Sort) {
  return (a: CampaignView, b: CampaignView): number => {
    if (sort === 'raised') return a.summary.raised === b.summary.raised ? 0 : a.summary.raised > b.summary.raised ? -1 : 1
    if (sort === 'closest') {
      // Fundraisers that already met their goal go last; the rest sort by how near they are.
      const sa = share(a)
      const sb = share(b)
      const doneA = sa >= 1_000_000n
      const doneB = sb >= 1_000_000n
      if (doneA !== doneB) return doneA ? 1 : -1
      return sa === sb ? 0 : sa > sb ? -1 : 1
    }
    return 0 // Pages already come newest first.
  }
}

export function Explore() {
  const [pages, setPages] = useState(1)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<Sort>('newest')
  const [showClosed, setShowClosed] = useState(false)

  const results = useQueries({
    queries: Array.from({ length: pages }, (_, i) => campaignsQuery(BigInt(i) * PAGE_SIZE)),
  })
  const loaded = results.flatMap((r) => r.data ?? [])
  const firstPending = results[0]?.isPending ?? true
  const failed = results.find((r) => r.isError)
  const last = results[results.length - 1]
  // While an older page loads, keep the button in place so the layout does not jump.
  const loadingMore = pages > 1 && last?.isPending === true
  const hasMore = loadingMore || last?.data?.length === Number(PAGE_SIZE)

  const term = search.trim().toLowerCase()
  const shown = loaded
    .filter((v) => showClosed || !v.summary.closed)
    .filter(
      (v) =>
        term === '' ||
        v.summary.meta.title.toLowerCase().includes(term) ||
        v.summary.meta.description.toLowerCase().includes(term),
    )
    .sort(compare(sort))

  return (
    <>
      <section className="page-head">
        <h1>Explore fundraisers</h1>
        <p className="muted">Every fundraiser here holds its donations in its own escrow on Arc.</p>
      </section>

      <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <label className="field field-grow">
          <span className="sr-only">Search fundraisers</span>
          <input
            type="search"
            placeholder="Search by title or description"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="sr-only">Sort by</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          Show closed
        </label>
      </form>

      {failed && loaded.length === 0 ? (
        <LoadError onRetry={() => failed.refetch()} />
      ) : (
        <CampaignGrid
          views={shown}
          loading={firstPending}
          skeletons={9}
          empty={
            loaded.length === 0 ? (
              <>
                <p>No fundraisers yet.</p>
                <Link to="/create" className="btn">
                  Start the first one
                </Link>
              </>
            ) : (
              <p>No fundraisers match. Try another search or show closed ones.</p>
            )
          }
        />
      )}

      {hasMore && (
        <div className="more">
          <button
            type="button"
            className="btn btn-outline"
            disabled={loadingMore}
            onClick={() => setPages((p) => p + 1)}
          >
            {loadingMore ? 'Loading...' : 'Load older fundraisers'}
          </button>
        </div>
      )}
      {failed && loaded.length > 0 && <LoadError onRetry={() => failed.refetch()} />}
    </>
  )
}

import { useQueries } from '@tanstack/react-query'
import { useState } from 'react'
import { CampaignGrid, LoadError } from '../components/CampaignGrid'
import { Button, ButtonLink, PageHeader } from '../components/ui'
import { campaignsQuery, PAGE_SIZE } from '../hooks/useCampaigns'
import { useSender } from '../hooks/useSender'
import { type CampaignView, uniqueByAddress } from '../lib/campaigns'
import './Explore.css'

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
  const signedIn = useSender() !== null

  const results = useQueries({
    queries: Array.from({ length: pages }, (_, i) => campaignsQuery(BigInt(i) * PAGE_SIZE)),
  })
  const loaded = uniqueByAddress(results.flatMap((r) => r.data ?? []))
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
      <PageHeader width="wide" title="Explore Fundits" subtitle="Find a Fundit you care about and help it reach its goal." />

      <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <label className="filters-search">
          <span className="sr-only">Search Fundits</span>
          <input
            type="search"
            className="ui-input"
            placeholder="Search by title or description"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="filters-sort">
          <span className="sr-only">Sort by</span>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="filters-check">
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
              signedIn ? (
                <>
                  <p>No Fundits yet. Yours could be the first.</p>
                  <ButtonLink to="/create">Start a Fundit</ButtonLink>
                </>
              ) : (
                <p>No Fundits yet. Sign in to start the first one.</p>
              )
            ) : (
              <p>No Fundits match. Try another search or show closed ones.</p>
            )
          }
        />
      )}

      {hasMore && (
        <div className="explore-more">
          <Button variant="secondary" disabled={loadingMore} onClick={() => setPages((p) => p + 1)}>
            {loadingMore ? 'Loading...' : 'Load older Fundits'}
          </Button>
        </div>
      )}
      {failed && loaded.length > 0 && <LoadError onRetry={() => failed.refetch()} />}
    </>
  )
}

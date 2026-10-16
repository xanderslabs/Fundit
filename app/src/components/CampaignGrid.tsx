import type { ReactNode } from 'react'
import type { CampaignView } from '../lib/campaigns'
import { CampaignCard, CardSkeleton } from './CampaignCard'

type Props = { views: CampaignView[] | undefined; loading: boolean; empty: ReactNode; skeletons?: number }

export function CampaignGrid({ views, loading, empty, skeletons = 6 }: Props) {
  if (loading) {
    return (
      <div className="grid" aria-busy="true">
        {Array.from({ length: skeletons }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    )
  }
  if (!views || views.length === 0) return <div className="empty">{empty}</div>
  return (
    <div className="grid">
      {views.map((v) => (
        <CampaignCard key={v.address} view={v} />
      ))}
    </div>
  )
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="empty">
      <p>We could not reach the Arc network.</p>
      <button type="button" className="btn btn-outline" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}

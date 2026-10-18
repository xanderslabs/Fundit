import type { ReactNode } from 'react'
import type { CampaignView } from '../lib/campaigns'
import { CampaignCard, CardSkeleton } from './CampaignCard'

// action renders below each card, outside the card's link (My page puts a Share button there).
type Props = {
  views: CampaignView[] | undefined
  loading: boolean
  empty: ReactNode
  skeletons?: number
  action?: (view: CampaignView) => ReactNode
}

export function CampaignGrid({ views, loading, empty, skeletons = 6, action }: Props) {
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
      {views.map((v) =>
        action ? (
          <div key={v.address} className="card-wrap">
            <CampaignCard view={v} />
            <div className="card-action">{action(v)}</div>
          </div>
        ) : (
          <CampaignCard key={v.address} view={v} />
        ),
      )}
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

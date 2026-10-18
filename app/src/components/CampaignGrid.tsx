import type { ReactNode } from 'react'
import type { CampaignView } from '../lib/campaigns'
import { CampaignCard, CardSkeleton } from './CampaignCard'
import { Button, EmptyState } from './ui'
import './CampaignGrid.css'

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
      <div className="fundit-grid" aria-busy="true">
        {Array.from({ length: skeletons }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    )
  }
  if (!views || views.length === 0) return <EmptyState>{empty}</EmptyState>
  return (
    <div className="fundit-grid">
      {views.map((v) =>
        action ? (
          <div key={v.address} className="fundit-grid-item">
            <CampaignCard view={v} />
            <div className="fundit-grid-action">{action(v)}</div>
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
    <EmptyState
      action={
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      <p>We could not reach the Arc network.</p>
    </EmptyState>
  )
}

import { Link } from 'react-router'
import type { CampaignView } from '../lib/campaigns'
import { formatAmount } from '../lib/format'
import { CampaignImage } from './CampaignImage'
import { Name } from './Name'
import { Progress } from './Progress'
import { StatusBadge } from './StatusBadge'

type Props = { view: CampaignView; featured?: boolean }

export function CampaignCard({ view, featured = false }: Props) {
  const { summary, symbol, address } = view
  return (
    <Link to={`/c/${address}`} className={featured ? 'card card-featured' : 'card'}>
      <CampaignImage url={summary.meta.imageUrl} title={summary.meta.title} className="card-image" />
      <div className="card-body">
        <div className="card-tags">
          {featured && <span className="badge badge-accent">Featured</span>}
          <StatusBadge summary={summary} />
          <span className="badge badge-token">{symbol}</span>
        </div>
        <h3 className="card-title">{summary.meta.title || 'Untitled Fundit'}</h3>
        <p className="card-by muted">
          by <Name address={summary.creator} link={false} avatar={false} />
        </p>
        {featured && summary.meta.description && <p className="card-text">{summary.meta.description}</p>}
        <Progress raised={summary.raised} goal={summary.goal} />
        <p className="card-amounts">
          <strong>{formatAmount(summary.raised, symbol)}</strong>
          <span> raised of {formatAmount(summary.goal, symbol)}</span>
        </p>
      </div>
    </Link>
  )
}

export function CardSkeleton() {
  return (
    <div className="card card-skeleton" aria-hidden="true">
      <div className="campaign-image card-image" />
      <div className="card-body">
        <div className="skeleton-line" />
        <div className="skeleton-line short" />
      </div>
    </div>
  )
}

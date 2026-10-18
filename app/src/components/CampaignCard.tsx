import { Link } from 'react-router'
import type { CampaignView } from '../lib/campaigns'
import { formatAmount } from '../lib/format'
import { CampaignImage } from './CampaignImage'
import { Name } from './Name'
import { Progress } from './Progress'
import { StatusBadge } from './StatusBadge'
import { Badge } from './ui'
import './CampaignCard.css'

type Props = { view: CampaignView; featured?: boolean }

export function CampaignCard({ view, featured = false }: Props) {
  const { summary, symbol, address } = view
  return (
    <Link to={`/c/${address}`} className={featured ? 'fundit-card fundit-card-featured' : 'fundit-card'}>
      <CampaignImage url={summary.meta.imageUrl} title={summary.meta.title} className="fundit-card-image" />
      <div className="fundit-card-body">
        <div className="fundit-card-tags">
          {featured && <Badge tone="attention">Featured</Badge>}
          <StatusBadge summary={summary} />
          <Badge>{symbol}</Badge>
        </div>
        <h3 className="fundit-card-title">{summary.meta.title || 'Untitled Fundit'}</h3>
        <p className="fundit-card-by">
          by <Name address={summary.creator} link={false} avatar={false} />
        </p>
        {featured && summary.meta.description && <p className="fundit-card-text">{summary.meta.description}</p>}
        <Progress raised={summary.raised} goal={summary.goal} />
        <p className="fundit-card-amounts">
          <strong>{formatAmount(summary.raised, symbol)}</strong>
          <span> raised of {formatAmount(summary.goal, symbol)}</span>
        </p>
      </div>
    </Link>
  )
}

export function CardSkeleton() {
  return (
    <div className="fundit-card fundit-card-skeleton" aria-hidden="true">
      <div className="campaign-image fundit-card-image" />
      <div className="fundit-card-body">
        <div className="fundit-skeleton-line" />
        <div className="fundit-skeleton-line fundit-skeleton-short" />
      </div>
    </div>
  )
}

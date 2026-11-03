import { Badge, Banner } from './ui'
import './ModerationBanner.css'

// Tells the organiser what the Fundit team did. Withdraw and Manage stay open in every state.
export function ModerationBadge({ state }: { state: 'normal' | 'review' | 'removed' }) {
  if (state === 'normal') return null
  return <Badge tone="attention">{state === 'review' ? 'Under review' : 'Removed'}</Badge>
}

// The Fundit team's notice on a Fundit page. Text is from the fraud and trust design, "Banner and notice text".
export function ModerationBanner({ state }: { state: 'review' | 'removed' }) {
  if (state === 'review') {
    return (
      <div role="status" className="moderation-review">
        <Banner tone="attention">
          <p>
            <strong>This Fundit is under review.</strong> Someone reported it and the Fundit team is looking into it. Gifts
            can't be reversed, so think carefully before you give. Fundit can't freeze or return money held by a Fundit.
          </p>
        </Banner>
      </div>
    )
  }
  return (
    <div className="moderation-removed">
      <Banner tone="attention">
        <p>
          <strong>Fundit removed this fundraiser from the site after a review.</strong> We don't recommend giving to it. The
          money it already holds stays with its organiser, because Fundit can't move or return it.
        </p>
      </Banner>
    </div>
  )
}

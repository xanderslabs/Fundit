import { useParams } from 'react-router'
import { type Address, isAddress, isAddressEqual } from 'viem'
import { ActivityList } from '../components/ActivityList'
import { BackupBanner } from '../components/BackupBanner'
import { CampaignImage } from '../components/CampaignImage'
import { DonatePanel } from '../components/DonatePanel'
import { Name } from '../components/Name'
import { Progress } from '../components/Progress'
import { SharePanel } from '../components/SharePanel'
import { StatusBadge } from '../components/StatusBadge'
import { Button, ButtonLink, Card, EmptyState, PageHeader, Stat } from '../components/ui'
import { EXPLORER_URL } from '../config'
import { useCampaign } from '../hooks/useCampaigns'
import { useSender } from '../hooks/useSender'
import type { CampaignView } from '../lib/campaigns'
import { bpsToPercent, formatAmount } from '../lib/format'
import { shortAddress } from '../lib/names'
import { safeHttpsUrl } from '../lib/urls'
import { NotFound } from './NotFound'
import './CampaignPage.css'

// .stats is a test hook for the page order.
function CampaignStats({ view }: { view: CampaignView }) {
  const { summary, symbol } = view
  return (
    <Card className="stats campaign-stats">
      <Stat size="lg" value={formatAmount(summary.raised, symbol)} label={`raised of ${formatAmount(summary.goal, symbol)} goal`} />
      <Progress raised={summary.raised} goal={summary.goal} size="lg" />
      <dl className="campaign-facts">
        <div>
          <dt>Currency</dt>
          <dd>{symbol} on Arc</dd>
        </div>
        <div>
          <dt>Fee on withdrawal</dt>
          <dd>{bpsToPercent(summary.withdrawFeeBps)}</dd>
        </div>
      </dl>
    </Card>
  )
}

function CampaignLinks({ links }: { links: readonly string[] }) {
  const safe = links.map(safeHttpsUrl).filter((u): u is string => u !== null)
  if (safe.length === 0) return null
  return (
    <section className="campaign-links">
      <h2>Links</h2>
      <ul>
        {safe.map((url, i) => (
          <li key={`${i}-${url}`}>
            <a href={url} target="_blank" rel="noopener noreferrer nofollow ugc">
              {url}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

function CreatorLine({ creator, address }: { creator: Address; address: Address }) {
  return (
    <dl className="campaign-facts campaign-organiser">
      <div>
        <dt>Organiser</dt>
        <dd>
          <Name address={creator} />
        </dd>
      </div>
      <div>
        <dt>Escrow contract</dt>
        <dd>
          <a href={`${EXPLORER_URL}/address/${address}`} target="_blank" rel="noopener noreferrer" title={address}>
            {shortAddress(address)}
          </a>
        </dd>
      </div>
    </dl>
  )
}

function CampaignBody({ view }: { view: CampaignView }) {
  const { summary } = view
  const sender = useSender()
  const isCreator = sender !== null && isAddressEqual(sender.address, summary.creator)
  const created = new Date(Number(summary.createdAt) * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  return (
    <article className="campaign">
      <PageHeader
        width="wide"
        title={summary.meta.title || 'Untitled Fundit'}
        subtitle={
          <span className="campaign-meta">
            <StatusBadge summary={summary} />
            <span>Started {created}</span>
          </span>
        }
        actions={
          isCreator && (
            <ButtonLink to={`/manage/${view.address}`} variant="secondary">
              Manage this Fundit
            </ButtonLink>
          )
        }
      />
      <BackupBanner view={view} />
      {/* DOM order is the narrow-screen and screen reader order. Wide screens place stats and Give in the
          right column with grid areas, so the left column runs on without gaps. */}
      <div className="campaign-grid">
        <CampaignImage url={summary.meta.imageUrl} title={summary.meta.title} className="campaign-hero" />
        <aside className="campaign-side">
          <CampaignStats view={view} />
          <DonatePanel view={view} />
        </aside>
        <div className="campaign-body">
          <section>
            <h2>About</h2>
            <p className="campaign-description">{summary.meta.description || 'The organiser has not added a description.'}</p>
          </section>
          <CampaignLinks links={summary.meta.links} />
          <CreatorLine creator={summary.creator} address={view.address} />
          <section aria-labelledby="share-heading">
            <Card as="div">
              <SharePanel address={view.address} title={summary.meta.title} isCreator={isCreator} headingId="share-heading" />
            </Card>
          </section>
          <ActivityList campaign={view.address} createdAtBlock={summary.createdAtBlock} symbol={view.symbol} />
        </div>
      </div>
    </article>
  )
}

export function CampaignPage() {
  const { address: param = '' } = useParams()
  const valid = isAddress(param)
  const query = useCampaign(valid ? param : undefined)

  // An invalid address and one the factory does not know get the same Fundit 404 page.
  if (!valid || query.data === 'not-a-campaign') return <NotFound fundit />
  if (query.isError) {
    return (
      <>
        <PageHeader width="wide" title="Could not load this Fundit" />
        <EmptyState
          action={
            <Button variant="secondary" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        >
          <p>The Arc network did not answer. Check your connection and try again.</p>
        </EmptyState>
      </>
    )
  }
  if (query.isPending || !query.data) {
    return (
      <section className="campaign-notice" aria-busy="true">
        <p className="campaign-muted">Loading Fundit...</p>
      </section>
    )
  }
  return <CampaignBody view={query.data} />
}

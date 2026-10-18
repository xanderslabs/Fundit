import { Link, useParams } from 'react-router'
import { type Address, isAddress, isAddressEqual } from 'viem'
import { arc } from 'viem/chains'
import { ActivityList } from '../components/ActivityList'
import { BackupBanner } from '../components/BackupBanner'
import { CampaignImage } from '../components/CampaignImage'
import { DonatePanel } from '../components/DonatePanel'
import { Name } from '../components/Name'
import { Progress } from '../components/Progress'
import { SharePanel } from '../components/SharePanel'
import { StatusBadge } from '../components/StatusBadge'
import { useCampaign } from '../hooks/useCampaigns'
import { useSender } from '../hooks/useSender'
import type { CampaignView } from '../lib/campaigns'
import { bpsToPercent, formatAmount } from '../lib/format'
import { shortAddress } from '../lib/names'
import { safeHttpsUrl } from '../lib/urls'

const EXPLORER_URL = arc.blockExplorers.default.url

function NotACampaign() {
  return (
    <section className="notice">
      <h1>Not a Fundit</h1>
      <p>This address was not created by the Fundit factory, so we will not show it as a Fundit.</p>
      <Link to="/explore" className="btn">
        Explore Fundits
      </Link>
    </section>
  )
}

function CampaignStats({ view }: { view: CampaignView }) {
  const { summary, symbol } = view
  return (
    <div className="stats">
      <p className="stats-raised">
        <strong>{formatAmount(summary.raised, symbol)}</strong>
        <span>raised of {formatAmount(summary.goal, symbol)} goal</span>
      </p>
      <Progress raised={summary.raised} goal={summary.goal} size="lg" />
      <dl className="stats-list">
        <div>
          <dt>Currency</dt>
          <dd>{symbol} on Arc</dd>
        </div>
        <div>
          <dt>Fee on withdrawal</dt>
          <dd>{bpsToPercent(summary.withdrawFeeBps)}</dd>
        </div>
      </dl>
    </div>
  )
}

function CampaignLinks({ links }: { links: readonly string[] }) {
  const safe = links.map(safeHttpsUrl).filter((u): u is string => u !== null)
  if (safe.length === 0) return null
  return (
    <section className="links">
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
    <dl className="facts">
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
      <header className="campaign-head">
        <div className="card-tags">
          <StatusBadge summary={summary} />
          <span className="muted">Started {created}</span>
        </div>
        <h1>{summary.meta.title || 'Untitled Fundit'}</h1>
        {isCreator && (
          <div className="campaign-actions">
            <Link to={`/manage/${view.address}`} className="btn btn-outline">
              Manage this Fundit
            </Link>
          </div>
        )}
      </header>
      <BackupBanner view={view} />
      <div className="campaign-grid">
        <CampaignImage url={summary.meta.imageUrl} title={summary.meta.title} className="campaign-hero" />
        <aside className="campaign-side">
          <div className="panel">
            <CampaignStats view={view} />
          </div>
          <DonatePanel view={view} />
          <section className="panel" aria-labelledby="share-heading">
            <SharePanel address={view.address} title={summary.meta.title} isCreator={isCreator} headingId="share-heading" />
          </section>
        </aside>
        <div className="campaign-body">
          <section>
            <h2>About</h2>
            <p className="description">{summary.meta.description || 'The organiser has not added a description.'}</p>
          </section>
          <CampaignLinks links={summary.meta.links} />
          <CreatorLine creator={summary.creator} address={view.address} />
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

  if (!valid || query.data === 'not-a-campaign') return <NotACampaign />
  if (query.isError) {
    return (
      <section className="notice">
        <h1>Could not load this Fundit</h1>
        <p>The Arc network did not answer. Check your connection and try again.</p>
        <button type="button" className="btn" onClick={() => query.refetch()}>
          Try again
        </button>
      </section>
    )
  }
  if (query.isPending || !query.data) {
    return (
      <section className="notice" aria-busy="true">
        <p className="muted">Loading Fundit...</p>
      </section>
    )
  }
  return <CampaignBody view={query.data} />
}

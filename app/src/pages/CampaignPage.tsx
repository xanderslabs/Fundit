import { Link, useParams } from 'react-router'
import { type Address, isAddress } from 'viem'
import { arc } from 'viem/chains'
import { ActivityList } from '../components/ActivityList'
import { CampaignImage } from '../components/CampaignImage'
import { DonatePanel } from '../components/DonatePanel'
import { Progress } from '../components/Progress'
import { StatusBadge } from '../components/StatusBadge'
import { useCampaign } from '../hooks/useCampaigns'
import type { CampaignView } from '../lib/campaigns'
import { bpsToPercent, formatAmount } from '../lib/format'
import { safeHttpsUrl } from '../lib/urls'

const EXPLORER_URL = arc.blockExplorers.default.url

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function NotACampaign() {
  return (
    <section className="notice">
      <h1>Not a Fundit campaign</h1>
      <p>This address was not created by the Fundit factory, so we will not show it as a fundraiser.</p>
      <Link to="/explore" className="btn">
        Explore fundraisers
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

// Task 10 swaps the raw address for a Name component.
function CreatorLine({ creator, address }: { creator: Address; address: Address }) {
  return (
    <dl className="facts">
      <div>
        <dt>Organiser</dt>
        <dd>
          <a href={`${EXPLORER_URL}/address/${creator}`} target="_blank" rel="noopener noreferrer" title={creator}>
            {shortAddress(creator)}
          </a>
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
        <h1>{summary.meta.title || 'Untitled fundraiser'}</h1>
      </header>
      <div className="campaign-grid">
        <CampaignImage url={summary.meta.imageUrl} title={summary.meta.title} className="campaign-hero" />
        <aside className="campaign-side">
          <div className="panel">
            <CampaignStats view={view} />
          </div>
          <DonatePanel view={view} />
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
        <h1>Could not load this fundraiser</h1>
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
        <p className="muted">Loading fundraiser...</p>
      </section>
    )
  }
  return <CampaignBody view={query.data} />
}

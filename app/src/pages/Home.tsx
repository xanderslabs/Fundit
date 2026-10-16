import { Link } from 'react-router'
import { CampaignCard } from '../components/CampaignCard'
import { CampaignGrid, LoadError } from '../components/CampaignGrid'
import { useCampaigns, useFeatured } from '../hooks/useCampaigns'

const NEWEST_COUNT = 6

export function Home() {
  const featured = useFeatured()
  const newest = useCampaigns(0n)

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <h1>Raise money in USDC or EURC, held in an escrow you can check.</h1>
          <p>
            Every donation goes to an on-chain escrow on Arc. Only the organiser can withdraw, and anyone can see what
            came in and what went out.
          </p>
          <div className="hero-actions">
            <Link to="/create" className="btn btn-lg">
              Start a fundraiser
            </Link>
            <Link to="/explore" className="btn btn-outline btn-lg">
              Explore fundraisers
            </Link>
          </div>
        </div>
        {featured.data && (
          <div className="hero-featured">
            <CampaignCard view={featured.data} featured />
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Newest fundraisers</h2>
          <Link to="/explore" className="section-link">
            See all
          </Link>
        </div>
        {newest.isError ? (
          <LoadError onRetry={() => newest.refetch()} />
        ) : (
          <CampaignGrid
            views={newest.data?.slice(0, NEWEST_COUNT)}
            loading={newest.isPending}
            empty={
              <>
                <p>No fundraisers yet.</p>
                <Link to="/create" className="btn">
                  Start the first one
                </Link>
              </>
            }
          />
        )}
      </section>
    </>
  )
}

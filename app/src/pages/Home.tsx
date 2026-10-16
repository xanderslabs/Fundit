import { Link } from 'react-router'
import { CampaignCard } from '../components/CampaignCard'
import { CampaignGrid, LoadError } from '../components/CampaignGrid'
import { PASSKEYS_ENABLED } from '../config'
import { useCampaigns, useFeatured } from '../hooks/useCampaigns'

const NEWEST_COUNT = 6

const STEPS = [
  {
    title: 'Create',
    text: 'Pick USDC or EURC, set a goal and tell your story. Your fundraiser gets its own escrow contract on Arc.',
  },
  {
    title: 'Share',
    text: 'Send the link anywhere. People can give from Arc, from another chain, or from their Circle unified balance.',
  },
  {
    title: 'Withdraw anywhere',
    text: 'Take the money out on Arc, or have USDC sent to Ethereum, Base, Arbitrum and other chains in one step.',
  },
]

type Product = { name: string; text: string }

// Only products the app uses. Circle Wallets shows only while passkeys are switched on.
const PRODUCTS: Product[] = [
  { name: 'USDC and EURC', text: 'Every fundraiser holds one of the two, with 6 decimals, on Arc.' },
  { name: 'CCTP', text: 'Moves USDC between chains for donations and payouts. The Forwarding Service finishes each transfer for you.' },
  { name: 'Gateway', text: 'Lets donors give from a unified USDC balance spread across chains.' },
  ...(PASSKEYS_ENABLED ? [{ name: 'Wallets', text: 'Passkey wallets, so you can give without a browser extension.' }] : []),
  { name: 'App Kits', text: 'Bridge Kit and Unified Balance Kit run the cross-chain steps in your browser.' },
  { name: 'Arc Memo', text: 'Tags each donation from a regular wallet as a Fundit donation on Arc.' },
]

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

      <section className="section" aria-labelledby="how-it-works">
        <div className="section-head">
          <h2 id="how-it-works">How it works</h2>
        </div>
        <ol className="steps">
          {STEPS.map((step, i) => (
            <li key={step.title} className="step">
              <span className="step-number" aria-hidden="true">
                {i + 1}
              </span>
              <h3>{step.title}</h3>
              <p className="muted">{step.text}</p>
            </li>
          ))}
        </ol>
        <Link to="/create" className="btn">
          Start a fundraiser
        </Link>
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

      <section className="section" aria-labelledby="built-on">
        <div className="section-head">
          <h2 id="built-on">Built on Arc with Circle</h2>
        </div>
        <ul className="products">
          {PRODUCTS.map((p) => (
            <li key={p.name}>
              <h3>{p.name}</h3>
              <p className="muted">{p.text}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

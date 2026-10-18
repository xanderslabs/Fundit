import { useAppKitState } from '@reown/appkit/react'
import { type ReactNode, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { SignInButton } from '../components/AccountMenu'
import { CampaignCard } from '../components/CampaignCard'
import { CampaignGrid, LoadError } from '../components/CampaignGrid'
import { CROSSCHAIN_ENABLED, PASSKEYS_ENABLED } from '../config'
import { useCampaigns, useFeatured } from '../hooks/useCampaigns'
import { useSender } from '../hooks/useSender'

const NEWEST_COUNT = 6

// What people raise money for. Photos from Unsplash, credited in public/images/landing/CREDITS.md.
const CAUSES = [
  {
    title: 'Medical',
    image: '/images/landing/medical.webp',
    alt: 'A smiling doctor talks with a patient sitting up in a hospital bed.',
  },
  {
    title: 'Emergencies and disasters',
    image: '/images/landing/disaster.webp',
    alt: 'Two people shovel volcanic ash off a roof after an eruption.',
  },
  {
    title: 'Community and public goods',
    image: '/images/landing/community.webp',
    alt: 'Neighbours plant flowers together in a raised bed outside a brick house.',
  },
  {
    title: 'Charity',
    image: '/images/landing/charity.webp',
    alt: 'Volunteers in masks pack rows of paper grocery bags under a white tent.',
  },
  {
    title: 'People in need',
    image: '/images/landing/people.webp',
    alt: 'One person holds another person\'s hands across a table in comfort.',
  },
]

const STEPS = [
  { title: 'Create', text: 'Tell your story, set a goal and choose USDC or EURC.' },
  { title: 'Share', text: 'Send your link to friends, family and anyone who might help.' },
  {
    title: 'Withdraw anywhere',
    text: 'Take the money out on Arc whenever you like, or have USDC sent to Ethereum, Base and other chains.',
  },
]

type Faq = { q: string; a: ReactNode }

// Built at render, so the flags decide what the page promises. Fees, caps and payout rules match the
// contracts: MAX_FEE_BPS = 500, fees copied into each fundraiser at creation, EURC payouts on Arc only.
function faqs(): Faq[] {
  return [
    {
      q: 'What does Fundit charge?',
      a: (
        <>
          <p>
            At launch, Fundit keeps 1% of each donation and 1% of each withdrawal. Neither fee can ever go above 5%,
            and a fundraiser keeps the rates it had on the day it was created. Its page shows them.
          </p>
          <p>When you give, you can add a tip for Fundit if you want to. You also pay a small network fee in USDC.</p>
        </>
      ),
    },
    {
      q: 'Where is the money kept?',
      a: (
        <>
          <p>
            Each fundraiser has its own escrow contract on Arc, and donations go straight into it. Only the organiser
            can withdraw. Fundit cannot move the money raised; only its fees go to Fundit.
          </p>
          <p>
            An organiser can name a backup wallet. That wallet can take over after a 7-day wait, which the organiser
            can cancel.
          </p>
        </>
      ),
    },
    {
      q: 'How does withdrawing work?',
      a: (
        <p>
          The organiser picks an amount and where it goes. They can withdraw on Arc at any time, or have USDC sent to
          Ethereum, Base, Arbitrum, OP Mainnet, Polygon or Avalanche. EURC fundraisers pay out on Arc only.
        </p>
      ),
    },
    {
      q: 'What can I give with?',
      a: (
        <p>
          Each fundraiser takes one currency: USDC or EURC on Arc. EURC fundraisers take donations on Arc only.
          {CROSSCHAIN_ENABLED &&
            ' USDC fundraisers can also take USDC from another chain, or from your Circle unified balance.'}
        </p>
      ),
    },
    {
      q: 'Do I need a crypto wallet?',
      a: PASSKEYS_ENABLED ? (
        <p>
          You need a wallet, but Fundit can make one for you. Sign in with a wallet such as MetaMask, or any wallet
          that works with WalletConnect. Or sign in with a passkey, and Fundit opens a wallet on Arc for you. You add
          USDC to it before you give.
        </p>
      ) : (
        <p>Yes. Sign in with a wallet such as MetaMask, or any wallet that works with WalletConnect.</p>
      ),
    },
  ]
}

// Signed in, it is a link to /create. Signed out, it opens sign-in first and goes to /create once that
// succeeds. Closing the wallet modal or the sign-in panel without signing in stays on Home.
function CreateFunditButton() {
  const signedIn = useSender() !== null
  const navigate = useNavigate()
  const { open: modalOpen } = useAppKitState()
  // waiting: sign-in started. modal: the wallet modal opened, so its closing without a sign-in ends the wait.
  const [want, setWant] = useState<'no' | 'waiting' | 'modal'>('no')

  useEffect(() => {
    if (want === 'no') return
    if (signedIn) {
      setWant('no')
      void navigate('/create')
    } else if (modalOpen && want === 'waiting') setWant('modal')
    else if (!modalOpen && want === 'modal') setWant('no')
  }, [want, signedIn, modalOpen, navigate])

  const className = 'btn btn-lg btn-outline'
  if (signedIn) {
    return (
      <Link to="/create" className={className}>
        Create a Fundit
      </Link>
    )
  }
  return (
    <SignInButton
      className={className}
      label="Create a Fundit"
      onStart={() => setWant('waiting')}
      onDismiss={() => setWant('no')}
      onPasskeyDone={() => void navigate('/create')}
    />
  )
}

export function Home() {
  const featured = useFeatured()
  const newest = useCampaigns(0n)
  const signedIn = useSender() !== null

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <h1 id="hero-title">Fundraising for everyone, everywhere.</h1>
        <p>
          Raise money for a cause, a person in need or a public good, and get gifts from anyone in the world in
          digital dollars or euros. Every gift goes straight into the fundraiser, and only the organiser can take it
          out.
        </p>
        <div className="hero-actions">
          <Link to="/explore" className="btn btn-lg">
            Donate to a Fundit
          </Link>
          <CreateFunditButton />
        </div>
      </section>

      <section className="causes" aria-labelledby="causes">
        <h2 id="causes" className="sr-only">
          What people raise for
        </h2>
        <ul className="cause-list">
          {CAUSES.map((c, i) => (
            <li key={c.title} className="cause">
              <Link to="/explore" className="cause-link">
                <img
                  src={c.image}
                  alt={c.alt}
                  width={1200}
                  height={800}
                  loading={i === 0 ? 'eager' : 'lazy'}
                  decoding="async"
                />
                <span className="cause-title">{c.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {featured.data && (
        <section className="section featured" aria-labelledby="featured">
          <h2 id="featured">Featured fundraiser</h2>
          <div className="featured-card">
            <CampaignCard view={featured.data} featured />
          </div>
        </section>
      )}

      <section className="section" aria-labelledby="newest">
        <div className="section-head">
          <h2 id="newest">Newest fundraisers</h2>
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
              signedIn ? (
                <>
                  <p>No fundraisers yet. Yours could be the first.</p>
                  <Link to="/create" className="btn">
                    Start a fundraiser
                  </Link>
                </>
              ) : (
                <>
                  <p>No fundraisers yet. Sign in to start the first one, or look around.</p>
                  <Link to="/explore" className="btn btn-outline">
                    Explore
                  </Link>
                </>
              )
            }
          />
        )}
      </section>

      <section className="section how" aria-labelledby="how-it-works">
        <h2 id="how-it-works">How it works</h2>
        <ol className="steps">
          {STEPS.map((step, i) => (
            <li key={step.title} className="step">
              <span className="step-number" aria-hidden="true">
                {i + 1}
              </span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section faq" aria-labelledby="faq">
        <h2 id="faq">Questions people ask</h2>
        <div className="faq-list">
          {faqs().map((f) => (
            <details key={f.q} className="faq-item">
              <summary>{f.q}</summary>
              <div className="faq-answer">{f.a}</div>
            </details>
          ))}
        </div>
      </section>
    </>
  )
}

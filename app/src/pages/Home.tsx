import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { SignInButton } from '../components/AccountMenu'
import { CampaignGrid, LoadError } from '../components/CampaignGrid'
import { ButtonLink } from '../components/ui'
import { CHAIN_NAMES, EMAIL_SIGNIN } from '../config'
import { useCampaigns, useFeatured } from '../hooks/useCampaigns'
import { featuredFirst, publicFundits } from '../lib/campaigns'
import { useSender } from '../hooks/useSender'
import './Home.css'

const NEWEST_COUNT = 6

// What people raise money for. Photos from Unsplash, credited in public/images/landing/CREDITS.md.
// position: where to anchor the crop when the subject is off centre.
const CAUSES: { title: string; image: string; alt: string; position?: string }[] = [
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
  {
    title: 'Personal goals',
    image: '/images/landing/personal-goals.webp',
    alt: 'A young woman studies at her desk, writing in a notebook next to her laptop.',
    position: '68% center',
  },
  {
    title: 'Big moments',
    image: '/images/landing/big-moments.webp',
    alt: 'Friends stand and clap as two brides sign their marriage papers at a table on the beach.',
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

// Fees, caps and payout rules match the contracts: MAX_FEE_BPS = 500, fees copied into each fundraiser at creation, EURC payouts on Arc only.
function faqs(): Faq[] {
  return [
    {
      q: 'What does Fundit charge?',
      a: (
        <>
          <p>
            At launch, Fundit keeps 1% of each donation and 1% of each withdrawal. Neither fee can ever go above 5%,
            and a Fundit keeps the rates it had on the day it was created. Its page shows them.
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
            Each Fundit has its own escrow contract on Arc, and donations go straight into it. Only the organiser
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
          The organiser picks an amount and where it goes. They can withdraw on Arc at any time, or have USDC sent to{' '}
          {CHAIN_NAMES}. EURC Fundits pay out on Arc only.
        </p>
      ),
    },
    {
      q: 'What can I give with?',
      a: (
        <p>
          Each Fundit takes one currency: USDC or EURC on Arc. You give from your Fundit account, so add USDC or
          EURC to it first.
        </p>
      ),
    },
    // Without email sign-in a wallet is the only way in, so "No" would be false.
    ...(EMAIL_SIGNIN
      ? [
          {
            q: 'Do I need a crypto wallet?',
            a: (
              <p>
                No. You can sign in with your email address, and Fundit opens a Fundit account on Arc for you.
                If you already have a wallet, you can sign in with that instead. You add USDC to your account before you
                give.
              </p>
            ),
          },
        ]
      : []),
  ]
}

// Signed in, it is a link to /create. Signed out, it opens the sign-in dialog and goes to /create once that
// succeeds. Closing the sign-in dialog without signing in stays on Home.
function CreateFunditButton() {
  const signedIn = useSender() !== null
  const navigate = useNavigate()

  if (signedIn) {
    return (
      <ButtonLink to="/create" variant="secondary" size="lg">
        Create a Fundit
      </ButtonLink>
    )
  }
  return (
    <SignInButton
      className="ui-btn ui-btn-secondary ui-btn-lg"
      label="Create a Fundit"
      onSignedIn={() => void navigate('/create')}
    />
  )
}

export function Home() {
  const featured = useFeatured()
  const newest = useCampaigns(0n)
  // Test Fundits stay out of public lists (TEST_CREATORS). Their own pages still open.
  const shown = newest.data && featuredFirst(publicFundits(newest.data), featured.data).slice(0, NEWEST_COUNT)
  const signedIn = useSender() !== null

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <h1 id="hero-title">Fundraising for everyone, everywhere.</h1>
        <div className="hero-actions">
          <ButtonLink to="/explore" size="lg">
            Donate to a Fundit
          </ButtonLink>
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
                  style={c.position ? { objectPosition: c.position } : undefined}
                />
                <span className="cause-title">{c.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="section" aria-labelledby="newest">
        <div className="section-head">
          <h2 id="newest">Explore Fundits</h2>
          <Link to="/explore" className="section-link">
            See all
          </Link>
        </div>
        {newest.isError ? (
          <LoadError onRetry={() => newest.refetch()} />
        ) : (
          <CampaignGrid
            views={shown}
            featured={featured.data?.address}
            loading={newest.isPending}
            empty={
              signedIn ? (
                <>
                  <p>No Fundits yet. Yours could be the first.</p>
                  <ButtonLink to="/create">Start a Fundit</ButtonLink>
                </>
              ) : (
                <>
                  <p>No Fundits yet. Sign in to start the first one, or look around.</p>
                  <ButtonLink to="/explore" variant="secondary">
                    Explore
                  </ButtonLink>
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

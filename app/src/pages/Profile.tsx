import { useAppKit } from '@reown/appkit/react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import type { Address } from 'viem'
import { arc } from 'viem/chains'
import { CampaignGrid, LoadError } from '../components/CampaignGrid'
import { Name } from '../components/Name'
import { blockTimes } from '../hooks/useActivity'
import { useCampaign } from '../hooks/useCampaigns'
import { useSender } from '../hooks/useSender'
import { type DonationItem, recentDonationsBy } from '../lib/activity'
import { myCampaigns } from '../lib/campaigns'
import { arcClient } from '../lib/clients'
import { formatAmount } from '../lib/format'

const EXPLORER_URL = arc.blockExplorers.default.url

function DonationRow({ item, time }: { item: DonationItem; time: bigint | undefined }) {
  // Only factory campaigns reach this list, and their token never changes, so the symbol is safe to read here.
  const campaign = useCampaign(item.campaign)
  const view = campaign.data && campaign.data !== 'not-a-campaign' ? campaign.data : null
  return (
    <li>
      <p>
        {view ? (
          <>
            You gave <strong>{formatAmount(item.data.amount as bigint, view.symbol)}</strong> to{' '}
            <Link to={`/c/${item.campaign}`}>{view.summary.meta.title || 'Untitled fundraiser'}</Link>
          </>
        ) : (
          <Link to={`/c/${item.campaign}`}>A donation you made</Link>
        )}
      </p>
      {(item.data.message as string) !== '' && <p className="activity-message">{item.data.message as string}</p>}
      <a className="muted activity-time" href={`${EXPLORER_URL}/tx/${item.txHash}`} target="_blank" rel="noopener noreferrer">
        {time === undefined ? `Block ${item.blockNumber}` : new Date(Number(time) * 1000).toLocaleString()}
      </a>
    </li>
  )
}

function MyFundraisers({ address }: { address: Address }) {
  const query = useQuery({
    queryKey: ['my-campaigns', address.toLowerCase()],
    queryFn: () => myCampaigns(arcClient, address),
    staleTime: 15_000,
  })
  return (
    <section className="section">
      <div className="section-head">
        <h2>My fundraisers</h2>
      </div>
      {query.isError ? (
        <LoadError onRetry={() => query.refetch()} />
      ) : (
        <CampaignGrid
          views={query.data}
          loading={query.isPending}
          skeletons={3}
          empty={
            <>
              <p>You have not started a fundraiser with this address.</p>
              <Link to="/create" className="btn">
                Start a fundraiser
              </Link>
            </>
          }
        />
      )}
    </section>
  )
}

function MyDonations({ address }: { address: Address }) {
  const query = useQuery({
    queryKey: ['my-donations', address.toLowerCase()],
    queryFn: async () => {
      const items = await recentDonationsBy(arcClient, address)
      return { items, times: await blockTimes(arcClient, items.map((i) => i.blockNumber)) }
    },
    staleTime: 15_000,
  })
  return (
    <section className="section activity" aria-label="My donations">
      <h2>My donations</h2>
      {query.isPending && <p className="muted">Loading your donations...</p>}
      {query.isError && (
        <p className="muted">
          Could not load your donations.{' '}
          <button type="button" className="btn btn-outline" onClick={() => query.refetch()}>
            Try again
          </button>
        </p>
      )}
      {query.isSuccess && query.data.items.length === 0 && <p className="muted">No donations from this address recently.</p>}
      {query.isSuccess && query.data.items.length > 0 && (
        <ol className="activity-list">
          {query.data.items.map((item) => (
            <DonationRow key={`${item.txHash}-${item.logIndex}`} item={item} time={query.data.times.get(item.blockNumber)} />
          ))}
        </ol>
      )}
      <p className="muted">
        This list covers about the last 200,000 blocks on Arc.{' '}
        <a href={`${EXPLORER_URL}/address/${address}`} target="_blank" rel="noopener noreferrer">
          Older donations: view on explorer
        </a>
      </p>
      <p className="muted">Donations made from other chains appear on the campaign as cross-chain donations.</p>
    </section>
  )
}

export function Profile() {
  const sender = useSender()
  const { open } = useAppKit()

  if (!sender) {
    return (
      <section className="notice">
        <h1>My page</h1>
        <p>Connect a wallet to see your campaigns</p>
        <button type="button" className="btn" onClick={() => open()}>
          Connect wallet
        </button>
      </section>
    )
  }

  return (
    <>
      <section className="page-head profile-head">
        <h1>
          <Name address={sender.address} />
        </h1>
        <p className="muted">Your fundraisers and the donations you made from this address on Arc.</p>
      </section>
      <MyFundraisers address={sender.address} />
      <MyDonations address={sender.address} />
    </>
  )
}

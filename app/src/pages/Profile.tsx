import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import type { Address } from 'viem'
import { arc } from 'viem/chains'
import { SignInButton } from '../components/AccountMenu'
import { AddBackupPasskey } from '../components/AddBackupPasskey'
import { CampaignGrid, LoadError } from '../components/CampaignGrid'
import { Name } from '../components/Name'
import { ShareDialog } from '../components/SharePanel'
import { CROSSCHAIN_ENABLED } from '../config'
import { blockTimes } from '../hooks/useActivity'
import { useCampaign } from '../hooks/useCampaigns'
import { useSender } from '../hooks/useSender'
import { type DonationItem, recentDonationsBy } from '../lib/activity'
import { readMessage } from '../lib/anon'
import { myCampaigns } from '../lib/campaigns'
import { useBackupNeeded, usePasskeySession } from '../lib/passkey'
import { arcClient } from '../lib/clients'
import { formatAmount } from '../lib/format'

const EXPLORER_URL = arc.blockExplorers.default.url

function DonationRow({ item, time }: { item: DonationItem; time: bigint | undefined }) {
  // Only factory campaigns reach this list, and their token never changes, so the symbol is safe to read here.
  const campaign = useCampaign(item.campaign)
  const view = campaign.data && campaign.data !== 'not-a-campaign' ? campaign.data : null
  const { anonymous, text } = readMessage(item.data.message as string)
  return (
    <li>
      <p>
        {view ? (
          <>
            You gave <strong>{formatAmount(item.data.amount as bigint, view.symbol)}</strong> to{' '}
            <Link to={`/c/${item.campaign}`}>{view.summary.meta.title || 'Untitled Fundit'}</Link>
          </>
        ) : (
          <Link to={`/c/${item.campaign}`}>A donation you made</Link>
        )}
      </p>
      {anonymous && <p className="muted">Given anonymously</p>}
      {text !== '' && <p className="activity-message">{text}</p>}
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
        <h2>Your Fundits</h2>
      </div>
      {query.isError ? (
        <LoadError onRetry={() => query.refetch()} />
      ) : (
        <CampaignGrid
          views={query.data}
          loading={query.isPending}
          skeletons={3}
          action={(v) => <ShareDialog address={v.address} title={v.summary.meta.title} isCreator />}
          empty={
            <>
              <p>You have not started a Fundit with this address.</p>
              <Link to="/create" className="btn">
                Start a Fundit
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
        This list covers about the last day on Arc.{' '}
        <a href={`${EXPLORER_URL}/address/${address}`} target="_blank" rel="noopener noreferrer">
          Older donations: view on explorer
        </a>
      </p>
      {CROSSCHAIN_ENABLED && <p className="muted">Donations made from other chains appear on the Fundit as cross-chain donations.</p>}
    </section>
  )
}

export function Profile() {
  const sender = useSender()
  const session = usePasskeySession()
  // Only for the passkey account, and only while it is the one acting. Later never hides it here.
  const passkey = sender?.kind === 'passkey' ? session : null
  const backupNeeded = useBackupNeeded(passkey)

  if (!sender) {
    return (
      <section className="notice">
        <h1>My page</h1>
        <p>Sign in to see your Fundits and the donations you made.</p>
        <SignInButton />
      </section>
    )
  }

  return (
    <>
      <section className="page-head profile-head">
        <h1>
          <Name address={sender.address} />
        </h1>
        <p className="muted">Your Fundits and the donations you made from this address on Arc.</p>
        <Link to="/create" className="btn btn-lg profile-start">
          Start a Fundit
        </Link>
      </section>
      {passkey && backupNeeded && (
        <section className="section notice">
          <AddBackupPasskey stored={passkey} />
        </section>
      )}
      <MyFundraisers address={sender.address} />
      <MyDonations address={sender.address} />
    </>
  )
}

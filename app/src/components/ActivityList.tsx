import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type Address, encodeFunctionData } from 'viem'
import { arc } from 'viem/chains'
import { campaignAbi } from '../abi/campaign'
import type { TokenSymbol } from '../config'
import { useActivity } from '../hooks/useActivity'
import { useSender } from '../hooks/useSender'
import type { ActivityItem } from '../lib/activity'
import { arcClient } from '../lib/clients'
import { formatAmount } from '../lib/format'
import { Name } from './Name'
import { TxStatus, useTx } from './TxStatus'

const EXPLORER_URL = arc.blockExplorers.default.url
const ZERO = '0x0000000000000000000000000000000000000000'

function Who({ address }: { address: Address }) {
  return <Name address={address} avatar={false} />
}

// Every field comes from a decoded Campaign event, so the types follow the ABI.
function Line({ item, symbol }: { item: ActivityItem; symbol: TokenSymbol }) {
  const d = item.data
  const amount = (v: unknown) => formatAmount(v as bigint, symbol)
  switch (item.kind) {
    case 'donation':
      return (
        <>
          <p>
            <Who address={d.donor as Address} /> gave <strong>{amount(d.amount)}</strong>
            {(d.tip as bigint) > 0n && <span className="muted"> and tipped Fundit {amount(d.tip)}</span>}
          </p>
          {(d.message as string) !== '' && <p className="activity-message">{d.message as string}</p>}
        </>
      )
    case 'external':
      return (
        <p>
          Cross-chain donation of <strong>{amount(d.gross)}</strong>
        </p>
      )
    case 'withdrawal':
      return (
        <p>
          Organiser withdrew <strong>{amount(d.amount)}</strong>
          <span className="muted"> ({amount(d.net)} after fees)</span>
        </p>
      )
    case 'edit':
      return <p>Organiser edited the Fundit. Goal is now {amount(d.goal)}.</p>
    case 'close':
      return <p>Organiser closed the Fundit.</p>
    case 'fees':
      return <p>Fundit collected {amount(d.amount)} in fees and tips.</p>
    case 'sweep':
      return <p>Tokens sent here by mistake were returned to <Who address={d.to as Address} />.</p>
    case 'backup':
      return d.backup === ZERO ? (
        <p>Organiser removed the backup address.</p>
      ) : (
        <p>
          Organiser set <Who address={d.backup as Address} /> as the backup address.
        </p>
      )
    case 'recovery-start':
      return (
        <p>
          Backup <Who address={d.backup as Address} /> asked to take over. The organiser can cancel until{' '}
          {new Date(Number(d.readyAt as bigint) * 1000).toLocaleString()}.
        </p>
      )
    case 'recovery-cancel':
      return <p>The takeover request was cancelled.</p>
    case 'creator-change':
      return (
        <p>
          <Who address={d.newCreator as Address} /> is now the organiser.
        </p>
      )
  }
}

// Money minted to the campaign by CCTP or Gateway counts in raised() at once, but the list shows it only after
// settle() books it as a cross-chain donation. Anyone may call settle(), so any connected wallet can do it here.
function Unaccounted({ campaign, symbol }: { campaign: Address; symbol: TokenSymbol }) {
  const sender = useSender()
  const queryClient = useQueryClient()
  const key = campaign.toLowerCase()
  // Under ['activity', campaign], so every refresh of the activity list reads it again too.
  const query = useQuery({
    queryKey: ['activity', key, 'unaccounted'],
    queryFn: () => arcClient.readContract({ address: campaign, abi: campaignAbi, functionName: 'unaccounted' }),
    staleTime: 15_000,
  })
  const tx = useTx(() => {
    void queryClient.invalidateQueries({ queryKey: ['campaign', key] })
    void queryClient.invalidateQueries({ queryKey: ['activity', key] })
  })
  const amount = query.data ?? 0n
  // After a send the status stays in view, even once the amount drops to 0.
  if (amount === 0n && tx.phase.kind === 'idle') return null

  function count() {
    if (!sender || tx.locked) return
    void tx.run(sender, () => ({ to: campaign, data: encodeFunctionData({ abi: campaignAbi, functionName: 'settle' }) }), 'Count it now')
  }

  return (
    <div className="status-box activity-unaccounted">
      {amount > 0n && (
        <>
          <p>
            <strong>{formatAmount(amount, symbol)} from other chains, not counted yet</strong>
          </p>
          {sender ? (
            <button type="button" className="btn btn-outline" disabled={tx.locked} onClick={count}>
              {tx.busy ? 'Counting...' : 'Count it now'}
            </button>
          ) : (
            <p className="muted">Sign in with any wallet to count it.</p>
          )}
        </>
      )}
      <TxStatus
        tx={tx}
        noun="transaction"
        successText="Counted. It now shows in the list."
        startOverWarning="The earlier transaction may still go through. Try again anyway?"
      />
    </div>
  )
}

export function ActivityList({ campaign, createdAtBlock, symbol }: { campaign: Address; createdAtBlock: bigint; symbol: TokenSymbol }) {
  const query = useActivity(campaign, createdAtBlock)
  const pages = query.data?.pages ?? []
  const items = pages.flatMap((p) => p.items.map((item) => ({ item, time: p.times.get(item.blockNumber) })))

  return (
    <section className="activity" aria-label="Activity">
      <h2>Activity</h2>
      <Unaccounted campaign={campaign} symbol={symbol} />
      {query.isPending && <p className="muted">Loading activity...</p>}
      {query.isError && items.length === 0 && (
        <p className="muted">
          Could not load activity.{' '}
          <button type="button" className="btn btn-outline" onClick={() => query.refetch()}>
            Try again
          </button>
        </p>
      )}
      {query.isSuccess && items.length === 0 && <p className="muted">No activity yet.</p>}
      {items.length > 0 && (
        <ol className="activity-list">
          {items.map(({ item, time }) => (
            <li key={`${item.txHash}-${item.logIndex}`}>
              <Line item={item} symbol={symbol} />
              <a
                className="muted activity-time"
                href={`${EXPLORER_URL}/tx/${item.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {time === undefined ? `Block ${item.blockNumber}` : new Date(Number(time) * 1000).toLocaleString()}
              </a>
            </li>
          ))}
        </ol>
      )}
      {query.hasNextPage && (
        <button
          type="button"
          className="btn btn-outline"
          disabled={query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? 'Loading...' : 'Load more'}
        </button>
      )}
      {query.isFetchNextPageError && <p className="muted">Could not load more. Try again.</p>}
    </section>
  )
}

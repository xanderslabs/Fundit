import type { Address } from 'viem'
import { arc } from 'viem/chains'
import type { TokenSymbol } from '../config'
import { useActivity } from '../hooks/useActivity'
import type { ActivityItem } from '../lib/activity'
import { formatAmount } from '../lib/format'
import { Name } from './Name'

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
      return <p>Organiser edited the fundraiser. Goal is now {amount(d.goal)}.</p>
    case 'close':
      return <p>Organiser closed the fundraiser.</p>
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

export function ActivityList({ campaign, createdAtBlock, symbol }: { campaign: Address; createdAtBlock: bigint; symbol: TokenSymbol }) {
  const query = useActivity(campaign, createdAtBlock)
  const pages = query.data?.pages ?? []
  const items = pages.flatMap((p) => p.items.map((item) => ({ item, time: p.times.get(item.blockNumber) })))

  return (
    <section className="activity" aria-label="Activity">
      <h2>Activity</h2>
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

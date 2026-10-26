import { useQuery } from '@tanstack/react-query'
import { Button, Stat, StatusBox } from '../../src/components/ui'
import type { TokenSymbol } from '../../src/config'
import { formatAmount } from '../../src/lib/format'
import { type AdminSession, matchesWorker } from './lib/api'
import { readClient } from './lib/clients'
import { fetchGiftEvents, giftStats } from './lib/giftLogs'
import { type AdminNetwork, ADMIN_NETWORKS } from './lib/networks'
import { fetchSnapshot } from './lib/snapshot'
import type { ByToken } from './lib/stats'
import { Tile } from './Tile'

const TOKENS_SHOWN: TokenSymbol[] = ['USDC', 'EURC']

function PerToken({ label, value }: { label: string; value: ByToken }) {
  return (
    <dl className="admin-stats">
      {TOKENS_SHOWN.map((t) => (
        <Stat key={t} term label={`${label} (${t})`} value={formatAmount(value[t], t)} />
      ))}
    </dl>
  )
}

export function Gifts({ session, network, showTest }: { session: AdminSession; network: AdminNetwork; showTest: boolean }) {
  const { deployBlock } = ADMIN_NETWORKS[network]
  const matches = matchesWorker(session, network)
  // Same key as the Overview, so the two share one read.
  const snapshot = useQuery({
    queryKey: ['admin', network, 'snapshot'],
    queryFn: () => fetchSnapshot(readClient(network), network),
    enabled: matches,
  })
  const gifts = useQuery({
    // The count is in the key so a newly created Fundit's gifts are fetched.
    queryKey: ['admin', network, 'gifts', snapshot.data?.length ?? 0],
    queryFn: () =>
      fetchGiftEvents(
        readClient(network),
        (snapshot.data ?? []).map((r) => r.address),
        deployBlock,
      ),
    enabled: matches && !!snapshot.data,
  })

  if (!matches) return null

  if (!snapshot.data || !gifts.data) {
    if (!snapshot.isError && !gifts.isError) return <StatusBox>Loading...</StatusBox>
    return (
      <StatusBox tone="error">
        <p>Couldn't load. Try again.</p>
        <Button variant="secondary" onClick={() => void (snapshot.isError ? snapshot.refetch() : gifts.refetch())}>
          Try again
        </Button>
      </StatusBox>
    )
  }

  const result = gifts.data
  if (result.status === 'too-long') {
    return (
      <div className="admin-tiles">
        <Tile title="Gifts since launch" source={`Donated and FeesClaimed events from block ${deployBlock}.`}>
          <p>Too much history to read in the browser ({result.windows} block ranges). This needs the indexer.</p>
        </Tile>
      </div>
    )
  }

  const s = giftStats(result.events, snapshot.data, showTest, network)
  return (
    <div className="admin-tiles">
      <Tile
        title="Gifts since launch"
        source={`Donated and FeesClaimed events from block ${deployBlock} to ${result.toBlock}. USDC and EURC are never added together.`}
      >
        <dl className="admin-stats">
          <Stat term label="Gifts" value={String(s.gifts)} />
          <Stat term label="Donors" value={String(s.uniqueDonors)} />
          <Stat term label="Repeat donors" value={String(s.repeatDonors)} />
        </dl>
        <PerToken label="Average gift" value={s.averageGift} />
        <PerToken label="Tips" value={s.tips} />
        <PerToken label="Fees charged" value={s.fees} />
        <PerToken label="Fees claimed" value={s.feesClaimed} />
      </Tile>
    </div>
  )
}

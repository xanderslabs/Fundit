import { useQuery } from '@tanstack/react-query'
import { isAddressEqual } from 'viem'
import { Button, Stat, StatusBox } from '../../src/components/ui'
import { ARC_CHAIN_ID, FACTORY_ADDRESS, FACTORY_DEPLOY_BLOCK, type TokenSymbol } from '../../src/config'
import { arcClient } from '../../src/lib/clients'
import { formatAmount } from '../../src/lib/format'
import type { AdminSession } from './lib/api'
import { fetchGiftEvents, giftStats } from './lib/giftLogs'
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

export function Gifts({ session, showTest }: { session: AdminSession; showTest: boolean }) {
  const matches = session.chainId === ARC_CHAIN_ID && isAddressEqual(session.factory, FACTORY_ADDRESS)
  // Same key as the Overview, so the two share one read.
  const snapshot = useQuery({
    queryKey: ['admin', session.network, 'snapshot'],
    queryFn: () => fetchSnapshot(arcClient, session.factory),
    enabled: matches,
  })
  const gifts = useQuery({
    queryKey: ['admin', session.network, 'gifts'],
    queryFn: () =>
      fetchGiftEvents(
        arcClient,
        (snapshot.data ?? []).map((r) => r.address),
        FACTORY_DEPLOY_BLOCK,
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
        <Tile title="Gifts since launch" source={`Donated and FeesClaimed events from block ${FACTORY_DEPLOY_BLOCK}.`}>
          <p>Too much history to read in the browser ({result.windows} block ranges). This needs the indexer.</p>
        </Tile>
      </div>
    )
  }

  const s = giftStats(result.events, snapshot.data, showTest)
  return (
    <div className="admin-tiles">
      <Tile
        title="Gifts since launch"
        source={`Donated and FeesClaimed events from block ${FACTORY_DEPLOY_BLOCK} to ${result.toBlock}. USDC and EURC are never added together.`}
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

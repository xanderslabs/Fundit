import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { isAddressEqual, zeroAddress } from 'viem'
import { AddressChip, Button, Stat, StatusBox } from '../../src/components/ui'
import { ARC_CHAIN_ID, FACTORY_ADDRESS, type TokenSymbol } from '../../src/config'
import { arcClient } from '../../src/lib/clients'
import { formatAmount } from '../../src/lib/format'
import type { AdminSession } from './lib/api'
import { type FactoryState, readFactoryState } from './lib/factoryState'
import { fetchSnapshot } from './lib/snapshot'
import { type ByToken, claimable, funditCounts, heldInFundits, raisedByToken, visible } from './lib/stats'
import { Tile } from './Tile'

const TOKENS_SHOWN: TokenSymbol[] = ['USDC', 'EURC']

function fee(bps: number): string {
  return `${bps} bps (${bps / 100}%)`
}

function PerToken({ label, value }: { label: string; value: ByToken }) {
  return (
    <dl className="admin-stats">
      {TOKENS_SHOWN.map((t) => (
        <Stat key={t} term label={`${label} (${t})`} value={formatAmount(value[t], t)} />
      ))}
    </dl>
  )
}

function Loading({ error, retry }: { error: boolean; retry: () => void }) {
  if (!error) return <StatusBox>Loading...</StatusBox>
  return (
    <StatusBox tone="error">
      <p>Couldn't load. Try again.</p>
      <Button variant="secondary" onClick={retry}>
        Try again
      </Button>
    </StatusBox>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="admin-row">
      <dt className="admin-row-label">{label}</dt>
      <dd className="admin-row-value">{children}</dd>
    </div>
  )
}

function FactoryTile({ state }: { state: FactoryState }) {
  const hasPending = !isAddressEqual(state.pendingOwner, zeroAddress)
  const hasFeatured = !isAddressEqual(state.featured, zeroAddress)
  return (
    <Tile title="Factory" source="Read from the factory contract and the treasury's token balances.">
      <dl className="admin-stats">
        <Row label="Owner">
          <AddressChip address={state.owner} explorer />
        </Row>
        {hasPending && (
          <Row label="Pending owner">
            <AddressChip address={state.pendingOwner} explorer />
          </Row>
        )}
        <Row label="Donation fee">{fee(state.donationFeeBps)}</Row>
        <Row label="Withdraw fee">{fee(state.withdrawFeeBps)}</Row>
        <Row label="Treasury">
          <AddressChip address={state.treasury} explorer />
        </Row>
        {TOKENS_SHOWN.map((t) => (
          <Row key={t} label={`Treasury balance (${t})`}>
            {formatAmount(state.treasuryBalance[t], t)}
          </Row>
        ))}
        <Row label="Creation paused">{state.paused ? 'Yes' : 'No'}</Row>
        <Row label="Featured Fundit">{hasFeatured ? <AddressChip address={state.featured} explorer /> : 'None'}</Row>
      </dl>
    </Tile>
  )
}

export function Overview({ session, showTest }: { session: AdminSession; showTest: boolean }) {
  const matches = session.chainId === ARC_CHAIN_ID && isAddressEqual(session.factory, FACTORY_ADDRESS)
  const factory = useQuery({
    queryKey: ['admin', session.network, 'factory'],
    queryFn: () => readFactoryState(arcClient, session.factory),
    enabled: matches,
  })
  const snapshot = useQuery({
    queryKey: ['admin', session.network, 'snapshot'],
    queryFn: () => fetchSnapshot(arcClient, session.factory),
    enabled: matches,
  })

  if (!matches) return <p className="form-error">This panel was built for another network.</p>

  const rows = snapshot.data ? visible(snapshot.data, showTest) : null
  const counts = rows ? funditCounts(rows) : null

  return (
    <div className="admin-tiles">
      {factory.data ? <FactoryTile state={factory.data} /> : <Loading error={factory.isError} retry={() => void factory.refetch()} />}
      {rows && counts ? (
        <>
          <Tile title="Fundits" source="Counted from the factory's campaign list and each Fundit's summary.">
            <dl className="admin-stats">
              <Stat term label="Created" value={String(counts.created)} />
              <Stat term label="Unique creators" value={String(counts.uniqueCreators)} />
              <Stat term label="Reached their goal" value={String(counts.reachedGoal)} />
            </dl>
          </Tile>
          <Tile title="Money" source="Summed from each Fundit's raised, available and fee reads. USDC and EURC are never added together.">
            <PerToken label="Raised" value={raisedByToken(rows)} />
            <PerToken label="Fees claimable" value={claimable(rows)} />
            <PerToken label="Held in Fundits" value={heldInFundits(rows)} />
          </Tile>
        </>
      ) : (
        <Loading error={snapshot.isError} retry={() => void snapshot.refetch()} />
      )}
    </div>
  )
}

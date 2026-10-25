import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { claimable, funditCounts, heldInFundits, raisedByToken, visible } from './stats'
import type { FunditSnapshot } from './snapshot'

const base: FunditSnapshot = {
  address: '0x00000000000000000000000000000000000000a1',
  creator: '0x00000000000000000000000000000000000000c1' as Address,
  token: 'USDC',
  goal: 10_000_000n,
  raised: 0n,
  available: 0n,
  withdrawn: 0n,
  closed: false,
  donationFeeBps: 250,
  createdAtBlock: 1n,
  feesAccrued: 0n,
  unaccounted: 0n,
  isTest: false,
}
const row = (o: Partial<FunditSnapshot>): FunditSnapshot => ({ ...base, ...o })

describe('stats', () => {
  it('raisedByToken sums per token and never across tokens', () => {
    const rows = [row({ raised: 5_000_000n }), row({ raised: 1_000_000n }), row({ token: 'EURC', raised: 2_000_000n })]
    expect(raisedByToken(rows)).toEqual({ USDC: 6_000_000n, EURC: 2_000_000n })
  })

  it("claimable uses each Fundit's own fee snapshot", () => {
    const a = row({ feesAccrued: 100n, unaccounted: 10_000n, donationFeeBps: 250 })
    expect(claimable([a]).USDC).toBe(350n)
    const b = row({ feesAccrued: 5n, unaccounted: 10_000n, donationFeeBps: 0 })
    expect(claimable([a, b]).USDC).toBe(355n)
  })

  it('reachedGoal counts raised >= goal', () => {
    const rows = [row({ goal: 100n, raised: 100n }), row({ goal: 100n, raised: 150n }), row({ goal: 100n, raised: 99n })]
    expect(funditCounts(rows).reachedGoal).toBe(2)
  })

  it('counts created Fundits and unique creators', () => {
    const other = '0x00000000000000000000000000000000000000c2' as Address
    expect(funditCounts([row({}), row({}), row({ creator: other })])).toMatchObject({ created: 3, uniqueCreators: 2 })
  })

  it('heldInFundits adds available and feesAccrued per token', () => {
    const rows = [row({ available: 10n, feesAccrued: 3n }), row({ token: 'EURC', available: 4n, feesAccrued: 1n })]
    expect(heldInFundits(rows)).toEqual({ USDC: 13n, EURC: 5n })
  })

  it('visible drops test Fundits unless showTest', () => {
    const rows = [row({ isTest: true }), row({ isTest: false })]
    expect(visible(rows, false)).toHaveLength(1)
    expect(visible(rows, true)).toHaveLength(2)
  })
})

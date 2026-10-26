import type { TokenSymbol } from '../../../src/config'
import type { FunditSnapshot } from './snapshot'

// USDC and EURC are kept apart. Nothing here adds one to the other.
export type ByToken = Record<TokenSymbol, bigint>

const BPS = 10_000n

function sumByToken(rows: FunditSnapshot[], amount: (r: FunditSnapshot) => bigint): ByToken {
  const total: ByToken = { USDC: 0n, EURC: 0n }
  for (const r of rows) total[r.token] += amount(r)
  return total
}

export function visible(rows: FunditSnapshot[], showTest: boolean): FunditSnapshot[] {
  return showTest ? rows : rows.filter((r) => !r.isTest)
}

export function raisedByToken(rows: FunditSnapshot[]): ByToken {
  return sumByToken(rows, (r) => r.raised)
}

export function funditCounts(rows: FunditSnapshot[]): { created: number; uniqueCreators: number; reachedGoal: number } {
  return {
    created: rows.length,
    uniqueCreators: new Set(rows.map((r) => r.creator.toLowerCase())).size,
    reachedGoal: rows.filter((r) => r.raised >= r.goal).length,
  }
}

// Fees the factory treasury can still collect: what is booked plus the fee on gifts not yet counted,
// at the rate that Fundit was created with.
export function claimable(rows: FunditSnapshot[]): ByToken {
  return sumByToken(rows, (r) => r.feesAccrued + (r.unaccounted * BigInt(r.donationFeeBps)) / BPS)
}

export function heldInFundits(rows: FunditSnapshot[]): ByToken {
  return sumByToken(rows, (r) => r.available + r.feesAccrued)
}

// Fundits still taking gifts.
export function liveCount(rows: FunditSnapshot[]): number {
  return rows.filter((r) => !r.closed).length
}

const WEEK = 7n * 86_400n

// Fundits created in the last 7 days (rolling, not the calendar week).
export function newThisWeek(rows: FunditSnapshot[], nowSec: bigint): number {
  return rows.filter((r) => r.createdAt > nowSec - WEEK && r.createdAt <= nowSec).length
}

import type { Address, Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { giftStats } from './giftLogs'
import type { ScanEvent } from './historyScan'
import type { FunditSnapshot } from './snapshot'

// A real testnet test creator (testnet testCreators); mainnet has none.
const TEST_DONOR = '0x2a867fff6723425c9c835bd6c8f1d3d8ac527de3' as Address

const addr = (i: number) => `0x${i.toString(16).padStart(40, '0')}` as Address
const F1 = addr(1)
const F2 = addr(2)
const F_TEST = addr(3)
const D1 = addr(11)
const D2 = addr(12)

function row(address: Address, token: 'USDC' | 'EURC', isTest = false): FunditSnapshot {
  return {
    address,
    creator: addr(99),
    token,
    goal: 0n,
    raised: 0n,
    available: 0n,
    withdrawn: 0n,
    closed: false,
    donationFeeBps: 250,
    title: '',
    createdAt: 0n,
    createdAtBlock: 1n,
    feesAccrued: 0n,
    unaccounted: 0n,
    isTest,
  }
}

const TX = `0x${'1'.repeat(64)}` as Hex
let block = 1n
const event = (kind: ScanEvent['kind'], address: Address, args: ScanEvent['args']): ScanEvent => ({
  kind,
  address,
  blockNumber: block++,
  logIndex: 0,
  txHash: TX,
  args,
})
const gift = (fundit: Address, donor: Address, amount: bigint, fee = 0n, tip = 0n): ScanEvent =>
  event('Donated', fundit, { donor, amount: String(amount), fee: String(fee), tip: String(tip) })
const claimed = (fundit: Address, amount: bigint): ScanEvent => event('FeesClaimed', fundit, { treasury: addr(50), amount: String(amount) })

describe('giftStats', () => {
  const rows = [row(F1, 'USDC'), row(F2, 'EURC'), row(F_TEST, 'USDC', true)]

  it('drops gifts on test Fundits and gifts from test donors unless showTest', () => {
    const events = [gift(F1, D1, 10n), gift(F_TEST, D1, 10n), gift(F1, TEST_DONOR, 10n)]
    expect(giftStats(events, rows, false, 'testnet').gifts).toBe(1)
    expect(giftStats(events, rows, true, 'testnet').gifts).toBe(3)
    // The test donor list is the network's own: on mainnet that donor's gift counts.
    expect(giftStats(events, rows, false, 'mainnet').gifts).toBe(2)
  })

  it('repeat donors need 2 or more gifts', () => {
    const events = [gift(F1, D1, 1n), gift(F2, D1, 1n), gift(F1, D2, 1n)]
    const s = giftStats(events, rows, false, 'testnet')
    expect(s.uniqueDonors).toBe(2)
    expect(s.repeatDonors).toBe(1)
  })

  it('averageGift and fees never sum USDC and EURC', () => {
    const events: ScanEvent[] = [
      gift(F1, D1, 10_000_000n, 250_000n, 1n),
      gift(F1, D2, 20_000_000n, 500_000n, 2n),
      gift(F2, D1, 100n, 3n, 4n),
      claimed(F1, 700n),
      claimed(F2, 5n),
    ]
    const s = giftStats(events, rows, false, 'testnet')
    expect(s.averageGift).toEqual({ USDC: 15_000_000n, EURC: 100n })
    expect(s.fees).toEqual({ USDC: 750_000n, EURC: 3n })
    expect(s.tips).toEqual({ USDC: 3n, EURC: 4n })
    expect(s.feesClaimed).toEqual({ USDC: 700n, EURC: 5n })
  })

  it('ignores factory settings events', () => {
    const events = [gift(F1, D1, 10n), event('FeesUpdated', F1, { donationFeeBps: '100', withdrawFeeBps: '100' })]
    expect(giftStats(events, rows, false, 'testnet').gifts).toBe(1)
  })
})

import type { Address, Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { latestFeed } from './feed'
import type { ScanEvent } from './historyScan'
import type { FunditSnapshot } from './snapshot'

const addr = (i: number) => `0x${i.toString(16).padStart(40, '0')}` as Address
const FACTORY = addr(100)
const F1 = addr(1)
const F2 = addr(2)
const TX = `0x${'1'.repeat(64)}` as Hex

function row(address: Address, token: 'USDC' | 'EURC', createdAtBlock: bigint, title: string): FunditSnapshot {
  return {
    address,
    title,
    creator: addr(99),
    token,
    goal: 0n,
    raised: 0n,
    available: 0n,
    withdrawn: 0n,
    closed: false,
    donationFeeBps: 250,
    createdAt: 0n,
    createdAtBlock,
    feesAccrued: 0n,
    unaccounted: 0n,
    isTest: false,
  }
}

const event = (kind: ScanEvent['kind'], address: Address, blockNumber: bigint, args: ScanEvent['args'], logIndex = 0): ScanEvent => ({
  kind,
  address,
  blockNumber,
  logIndex,
  txHash: TX,
  args,
})

const gift = (address: Address, blockNumber: bigint, amount: string, logIndex = 0) =>
  event('Donated', address, blockNumber, { donor: addr(11), amount, fee: '0', tip: '0' }, logIndex)

const rows = [row(F1, 'USDC', 10n, 'School roof'), row(F2, 'EURC', 30n, 'Clinic')]
const events = [
  gift(F1, 20n, '25000000'),
  event('FeesUpdated', FACTORY, 40n, { donationFeeBps: '250', withdrawFeeBps: '0' }),
  gift(F2, 50n, '1500000'),
  gift(F2, 50n, '2000000', 3),
]

describe('latestFeed', () => {
  it('puts gifts, new Fundits and settings changes together, newest first', () => {
    const feed = latestFeed(events, rows, 10)
    expect(feed.map((f) => [f.kind, f.blockNumber, f.logIndex])).toEqual([
      ['gift', 50n, 3],
      ['gift', 50n, 0],
      ['setting', 40n, 0],
      ['newFundit', 30n, -1],
      ['gift', 20n, 0],
      ['newFundit', 10n, -1],
    ])
  })

  it('keeps only the newest limit items', () => {
    const feed = latestFeed(events, rows, 2)
    expect(feed).toHaveLength(2)
    expect(feed.map((f) => f.logIndex)).toEqual([3, 0])
  })

  it("names a gift's amount with its Fundit's token, never another", () => {
    const feed = latestFeed(events, rows, 10)
    const usdc = feed.find((f) => f.kind === 'gift' && f.address === F1)!
    const eurc = feed.find((f) => f.kind === 'gift' && f.logIndex === 3)!
    expect(usdc.text).toContain('25.00 USDC')
    expect(usdc.text).toContain('School roof')
    expect(eurc.text).toContain('2.00 EURC')
    expect(eurc.txHash).toBe(TX)
  })

  it('leaves out gifts to Fundits not in the snapshot (hidden test Fundits)', () => {
    const feed = latestFeed(events, [rows[0]!], 10)
    expect(feed.some((f) => f.address === F2)).toBe(false)
  })
})

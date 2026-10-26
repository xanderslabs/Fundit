import type { Address } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { ADDRESS_CHUNK, fetchGiftEvents, type GiftEvent, giftStats, LOG_WINDOW, MAX_WINDOWS, windows } from './giftLogs'
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

const gift = (fundit: Address, donor: Address, amount: bigint, fee = 0n, tip = 0n): GiftEvent => ({
  kind: 'gift',
  fundit,
  donor,
  amount,
  fee,
  tip,
})

describe('windows', () => {
  it('covers every block once in 9,999 block ranges', () => {
    const w = windows(100n, 100n + LOG_WINDOW * 2n + 4n)
    expect(w).toEqual([
      [100n, 100n + LOG_WINDOW - 1n],
      [100n + LOG_WINDOW, 100n + LOG_WINDOW * 2n - 1n],
      [100n + LOG_WINDOW * 2n, 100n + LOG_WINDOW * 2n + 4n],
    ])
    expect(windows(5n, 5n)).toEqual([[5n, 5n]])
    expect(windows(6n, 5n)).toEqual([])
  })
})

describe('fetchGiftEvents', () => {
  it('returns too-long above 500 windows without calling getLogs', async () => {
    const getLogs = vi.fn()
    const tip = LOG_WINDOW * BigInt(MAX_WINDOWS + 1)
    const client = { getLogs, getBlockNumber: async () => tip } as never
    const res = await fetchGiftEvents(client, [F1], 0n)
    expect(res).toEqual({ status: 'too-long', windows: MAX_WINDOWS + 2 })
    expect(getLogs).not.toHaveBeenCalled()
  })

  it('runs at most 4 windows at once', async () => {
    let active = 0
    let peak = 0
    const getLogs = vi.fn(async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return []
    })
    const client = { getLogs, getBlockNumber: async () => LOG_WINDOW * 20n } as never
    const res = await fetchGiftEvents(client, [F1], 0n)
    expect(res.status).toBe('ok')
    expect(getLogs.mock.calls.length).toBeGreaterThan(4)
    expect(peak).toBe(4)
  })

  it('asks the RPC only for the given Fundit addresses', async () => {
    const getLogs = vi.fn(async (_args: { address: Address[] }) => [])
    const client = { getLogs, getBlockNumber: async () => 10n } as never
    await fetchGiftEvents(client, [F1, F2], 0n)
    expect(getLogs).toHaveBeenCalledTimes(1)
    expect(getLogs.mock.calls[0]![0].address).toEqual([F1, F2])
  })

  it('splits more than 100 Fundits into address chunks', async () => {
    const getLogs = vi.fn(async (_args: { address: Address[] }) => [])
    const client = { getLogs, getBlockNumber: async () => LOG_WINDOW * 2n - 1n } as never
    const many = Array.from({ length: 250 }, (_, i) => addr(i + 1000))
    await fetchGiftEvents(client, many, 0n)
    expect(ADDRESS_CHUNK).toBe(100)
    expect(getLogs).toHaveBeenCalledTimes(2 * 3)
    expect(getLogs.mock.calls.map((c) => c[0].address.length).sort((a, b) => a - b)).toEqual([50, 50, 100, 100, 100, 100])
  })

  it('makes no getLogs call with no Fundits', async () => {
    const getLogs = vi.fn()
    const client = { getLogs, getBlockNumber: async () => LOG_WINDOW * 3n } as never
    expect(await fetchGiftEvents(client, [], 0n)).toEqual({ status: 'ok', events: [], toBlock: LOG_WINDOW * 3n })
    expect(getLogs).not.toHaveBeenCalled()
  })

  it('keeps no gift message', async () => {
    const logs = [
      { address: F1, eventName: 'Donated', args: { donor: D1, amount: 5n, fee: 1n, tip: 2n, message: 'secret hello' } },
      { address: F1, eventName: 'FeesClaimed', args: { treasury: addr(50), amount: 7n } },
      { address: addr(77), eventName: 'Donated', args: { donor: D1, amount: 9n, fee: 0n, tip: 0n, message: 'x' } },
    ]
    const getLogs = vi.fn(async () => logs)
    const client = { getLogs, getBlockNumber: async () => 10n } as never
    const res = await fetchGiftEvents(client, [F1], 0n)
    if (res.status !== 'ok') throw new Error('expected ok')
    expect(res.toBlock).toBe(10n)
    expect(res.events).toEqual([
      { kind: 'gift', fundit: F1, donor: D1, amount: 5n, fee: 1n, tip: 2n },
      { kind: 'feesClaimed', fundit: F1, amount: 7n },
    ])
    expect(JSON.stringify(res.events, (_k, v) => (typeof v === 'bigint' ? String(v) : v))).not.toContain('secret')
  })
})

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
    const events: GiftEvent[] = [
      gift(F1, D1, 10_000_000n, 250_000n, 1n),
      gift(F1, D2, 20_000_000n, 500_000n, 2n),
      gift(F2, D1, 100n, 3n, 4n),
      { kind: 'feesClaimed', fundit: F1, amount: 700n },
      { kind: 'feesClaimed', fundit: F2, amount: 5n },
    ]
    const s = giftStats(events, rows, false, 'testnet')
    expect(s.averageGift).toEqual({ USDC: 15_000_000n, EURC: 100n })
    expect(s.fees).toEqual({ USDC: 750_000n, EURC: 3n })
    expect(s.tips).toEqual({ USDC: 3n, EURC: 4n })
    expect(s.feesClaimed).toEqual({ USDC: 700n, EURC: 5n })
  })
})

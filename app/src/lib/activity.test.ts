import { type Address, encodeAbiParameters, encodeEventTopics, type Hex, pad, toHex } from 'viem'
import { describe, expect, it } from 'vitest'
import { campaignAbi } from '../abi/campaign'
import { MAX_LOG_RANGE, MAX_LOGS } from '../config'
import { type ActivityItem, type LogClient, walkActivity } from './activity'

const CAMPAIGN = '0x00000000000000000000000000000000000000a1' as Address
const DONOR = '0x1111111111111111111111111111111111111111' as Address
const OTHER = '0x2222222222222222222222222222222222222222' as Address

type EventName = Extract<(typeof campaignAbi)[number], { type: 'event' }>['name']

type FakeLog = { blockNumber: bigint; logIndex: number; transactionHash: Hex; topics: Hex[]; data: Hex; address: Address }

// Builds a raw log the way the RPC returns it, so the walk has to decode it with campaignAbi.
function rawLog(eventName: EventName, args: Record<string, unknown>, blockNumber: bigint, logIndex = 0): FakeLog {
  const event = campaignAbi.find((x) => x.type === 'event' && x.name === eventName) as Extract<
    (typeof campaignAbi)[number],
    { type: 'event' }
  >
  const topics = encodeEventTopics({ abi: [event], eventName, args } as never) as Hex[]
  const plain = event.inputs.filter((i) => !('indexed' in i && i.indexed))
  const data = encodeAbiParameters(
    plain,
    plain.map((i) => args[i.name!]),
  )
  return {
    address: CAMPAIGN,
    blockNumber,
    logIndex,
    transactionHash: pad(toHex(blockNumber * 1000n + BigInt(logIndex)), { size: 32 }),
    topics,
    data,
  }
}

function donation(block: bigint, prev: bigint, logIndex = 0, amount = 1_000_000n) {
  return rawLog('Donated', { donor: DONOR, amount, fee: 0n, tip: 0n, message: 'hi', prevActivityBlock: prev }, block, logIndex)
}

// A fake Arc RPC that enforces the public limits: at most 10,000 blocks and at most 2,000 logs per call.
// The error strings are the ones Arc's public RPC returns.
function fakeClient(logs: FakeLog[]) {
  const calls: { fromBlock: bigint; toBlock: bigint }[] = []
  const client = {
    async getLogs({ address, fromBlock, toBlock }: { address: Address; fromBlock: bigint; toBlock: bigint }) {
      calls.push({ fromBlock, toBlock })
      if (toBlock - fromBlock + 1n > MAX_LOG_RANGE) throw new Error('requested range too large')
      const hit = logs.filter((l) => l.address === address && l.blockNumber >= fromBlock && l.blockNumber <= toBlock)
      if (hit.length > MAX_LOGS) throw new Error('query exceeds max results 2000')
      return hit
    },
  }
  return { client: client as unknown as LogClient, calls }
}

const TIP = 1_000_000n

describe('walkActivity', () => {
  // The public RPC caps each call at 10,000 blocks, so the walk must jump over quiet stretches via
  // prevActivityBlock instead of scanning every block since creation.
  it('walks_back_via_prev_pointers', async () => {
    const logs = [donation(100n, 90n), donation(50_100n, 100n), donation(130_000n, 50_100n)]
    const { client, calls } = fakeClient(logs)
    const res = await walkActivity(client, CAMPAIGN, {
      fromBlockTip: TIP,
      createdAtBlock: 90n,
      lastActivityBlock: 130_000n,
      limit: 50,
    })
    expect(res.items.map((i) => i.blockNumber)).toEqual([130_000n, 50_100n, 100n])
    expect(res.items.every((i) => i.kind === 'donation')).toBe(true)
    expect(calls.length).toBeLessThanOrEqual(4)
    expect(res.nextCursor).toBeNull()
  })

  // A new campaign with no donations must end the walk, not loop or scan back to block 0.
  it('stops_at_createdAtBlock_with_no_activity', async () => {
    const { client, calls } = fakeClient([])
    const res = await walkActivity(client, CAMPAIGN, {
      fromBlockTip: TIP,
      createdAtBlock: 500n,
      lastActivityBlock: 500n,
      limit: 50,
    })
    expect(res).toEqual({ items: [], nextCursor: null })
    expect(calls).toEqual([{ fromBlock: 500n, toBlock: 500n }])
  })

  // A busy campaign can exceed the 2,000-log cap in one window. Dropping that window would hide donations.
  it('splits_window_on_too_many_results', async () => {
    const logs: FakeLog[] = []
    // 4,500 donations across blocks 1,001 to 5,500; each points to the block before it.
    for (let b = 1001n; b <= 5500n; b++) logs.push(donation(b, b - 1n))
    const { client, calls } = fakeClient(logs)
    const res = await walkActivity(client, CAMPAIGN, {
      fromBlockTip: TIP,
      createdAtBlock: 1000n,
      lastActivityBlock: 5500n,
      limit: 10_000,
    })
    expect(res.items.length).toBe(4500)
    expect(new Set(res.items.map((i) => i.blockNumber)).size).toBe(4500)
    expect(res.items[0]!.blockNumber).toBe(5500n)
    expect(res.items[4499]!.blockNumber).toBe(1001n)
    expect(res.nextCursor).toBeNull()
    expect(calls.length).toBeGreaterThan(1)
  })

  // "Load more" continues from the cursor, so a page must never skip or repeat an event.
  it('respects_limit_and_returns_cursor', async () => {
    const logs = [
      donation(200n, 100n, 0),
      donation(200n, 100n, 1),
      donation(20_000n, 200n),
      donation(40_000n, 20_000n, 0),
      donation(40_000n, 20_000n, 1),
      donation(60_000n, 40_000n),
    ]
    const { client } = fakeClient(logs)
    const opts = { fromBlockTip: TIP, createdAtBlock: 100n, lastActivityBlock: 60_000n }

    const first = await walkActivity(client, CAMPAIGN, { ...opts, limit: 2 })
    // The page never cuts a block in half, so both events at 40,000 come together.
    expect(first.items.map((i) => [i.blockNumber, i.logIndex])).toEqual([
      [60_000n, 0],
      [40_000n, 1],
      [40_000n, 0],
    ])
    expect(first.nextCursor).toBe(20_000n)

    const second = await walkActivity(client, CAMPAIGN, { ...opts, limit: 2, cursor: first.nextCursor! })
    expect(second.items.map((i) => [i.blockNumber, i.logIndex])).toEqual([
      [20_000n, 0],
      [200n, 1],
      [200n, 0],
    ])
    // That window reached the creation block and nothing was cut, so there is nothing left to load.
    expect(second.nextCursor).toBeNull()
  })

  it('never queries past the chain tip', async () => {
    const { client, calls } = fakeClient([donation(150n, 100n)])
    const res = await walkActivity(client, CAMPAIGN, {
      fromBlockTip: 150n,
      createdAtBlock: 100n,
      lastActivityBlock: 999n,
      limit: 50,
    })
    expect(res.items.map((i) => i.blockNumber)).toEqual([150n])
    expect(calls.every((c) => c.toBlock <= 150n)).toBe(true)
  })

  // A result of exactly MAX_LOGS may be a silently truncated page, so it is split rather than trusted.
  it('splits_window_that_returns_exactly_max_logs', async () => {
    const logs: FakeLog[] = []
    for (let b = 1001n; b < 1001n + BigInt(MAX_LOGS); b++) logs.push(donation(b, b - 1n))
    const { client, calls } = fakeClient(logs)
    const res = await walkActivity(client, CAMPAIGN, {
      fromBlockTip: TIP,
      createdAtBlock: 1000n,
      lastActivityBlock: 1000n + BigInt(MAX_LOGS),
      limit: 10_000,
    })
    expect(res.items.length).toBe(MAX_LOGS)
    expect(new Set(res.items.map((i) => i.blockNumber)).size).toBe(MAX_LOGS)
    expect(calls.length).toBeGreaterThan(1)
  })

  // Splitting on a rate limit would turn one refused call into many more, making the limit worse.
  it('rethrows_rate_limit_errors_without_splitting', async () => {
    const calls: unknown[] = []
    const client = {
      async getLogs(args: unknown) {
        calls.push(args)
        throw new Error('HTTP request failed. Status: 429. Details: rate limit exceeded, too many requests')
      },
    } as unknown as LogClient
    await expect(
      walkActivity(client, CAMPAIGN, { fromBlockTip: TIP, createdAtBlock: 1n, lastActivityBlock: 5000n, limit: 50 }),
    ).rejects.toThrow('429')
    expect(calls).toHaveLength(1)
  })

  it('rethrows errors that are not about the range or result size', async () => {
    const client = {
      async getLogs() {
        throw new Error('network down')
      },
    } as unknown as LogClient
    await expect(
      walkActivity(client, CAMPAIGN, { fromBlockTip: TIP, createdAtBlock: 1n, lastActivityBlock: 5n, limit: 50 }),
    ).rejects.toThrow('network down')
  })

  // The list shows each kind differently, so every Campaign event must land on its own kind.
  it('decodes_each_event_kind', async () => {
    const b = 300n
    const p = 200n
    const logs = [
      rawLog('Donated', { donor: DONOR, amount: 5n, fee: 0n, tip: 1n, message: 'm', prevActivityBlock: p }, b, 0),
      rawLog('ExternalDonationSettled', { gross: 7n, fee: 0n, prevActivityBlock: p }, b, 1),
      rawLog(
        'Withdrawn',
        { destDomain: 26, recipient: pad(OTHER), amount: 9n, fee: 1n, net: 8n, prevActivityBlock: p },
        b,
        2,
      ),
      rawLog('Edited', { goal: 10n, prevActivityBlock: p }, b, 3),
      rawLog('Closed', { prevActivityBlock: p }, b, 4),
      rawLog('FeesClaimed', { treasury: OTHER, amount: 3n, prevActivityBlock: p }, b, 5),
      rawLog('Swept', { token: OTHER, to: DONOR, amount: 4n, prevActivityBlock: p }, b, 6),
      rawLog('BackupSet', { backup: OTHER, prevActivityBlock: p }, b, 7),
      rawLog('RecoveryInitiated', { backup: OTHER, readyAt: 99n, prevActivityBlock: p }, b, 8),
      rawLog('RecoveryCancelled', { backup: OTHER, prevActivityBlock: p }, b, 9),
      rawLog('CreatorChanged', { oldCreator: DONOR, newCreator: OTHER, prevActivityBlock: p }, b, 10),
    ]
    const { client } = fakeClient(logs)
    const res = await walkActivity(client, CAMPAIGN, {
      fromBlockTip: TIP,
      createdAtBlock: p,
      lastActivityBlock: b,
      limit: 50,
    })
    const kinds: ActivityItem['kind'][] = [
      'creator-change',
      'recovery-cancel',
      'recovery-start',
      'backup',
      'sweep',
      'fees',
      'close',
      'edit',
      'withdrawal',
      'external',
      'donation',
    ]
    expect(res.items.map((i) => i.kind)).toEqual(kinds)
    const donated = res.items.find((i) => i.kind === 'donation')!
    expect(donated.data).toMatchObject({ donor: DONOR, amount: 5n, tip: 1n, message: 'm' })
    expect(donated.txHash).toBe(logs[0]!.transactionHash)
    expect(res.items.find((i) => i.kind === 'creator-change')!.data).toMatchObject({ newCreator: OTHER })
  })
})

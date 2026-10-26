import type { Address, Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  ADDRESS_CHUNK,
  BACKOFF_MAX_MS,
  BACKOFF_START_MS,
  CONFIRMATIONS,
  initialScanState,
  isRateLimit,
  LOG_WINDOW,
  PAUSE_MS,
  POLL_MS,
  runScan,
  type ScanState,
  type ScanStatus,
  scanStep,
} from './historyScan'
import { ADMIN_NETWORKS } from './networks'

const NET = ADMIN_NETWORKS.testnet
const DEPLOY = NET.deployBlock
const FACTORY = NET.factory

const addr = (i: number) => `0x${i.toString(16).padStart(40, '0')}` as Address
const A = addr(0xa)
const B = addr(0xb)
const STRANGER = addr(0x77)
const DONOR = addr(0xd)
const TX = `0x${'1'.repeat(64)}` as Hex

type FakeLog = { address: Address; blockNumber: bigint; logIndex: number; eventName: string; args: Record<string, unknown> }
type Call = { address: Address[]; fromBlock: bigint; toBlock: bigint }

const donated = (address: Address, blockNumber: bigint, logIndex = 0, amount = 5n): FakeLog => ({
  address,
  blockNumber,
  logIndex,
  eventName: 'Donated',
  args: { donor: DONOR, amount, fee: 1n, tip: 2n, message: 'secret hello', prevActivityBlock: 0n },
})

// A node that answers getLogs from a fixed list, by address and block range, and remembers every call.
// extra logs come back whatever was asked, like a node that ignores the address filter.
function fakeNode(logs: FakeLog[], extra: FakeLog[] = []) {
  const calls: Call[] = []
  const client = {
    async getLogs(args: Call) {
      calls.push({ address: args.address, fromBlock: args.fromBlock, toBlock: args.toBlock })
      const asked = new Set(args.address.map((a) => a.toLowerCase()))
      const hits = logs.filter(
        (l) => asked.has(l.address.toLowerCase()) && l.blockNumber >= args.fromBlock && l.blockNumber <= args.toBlock,
      )
      return [...hits, ...extra].map((l) => ({ ...l, transactionHash: TX }))
    },
  }
  return { calls, client: client as never }
}

const state = (over: Partial<ScanState>): ScanState => ({ ...initialScanState('testnet'), ...over })

describe('scanStep', () => {
  it('reads one window per step from the deploy block', async () => {
    const { calls, client } = fakeNode([])
    const head = DEPLOY + 100_000n
    const first = await scanStep(client, initialScanState('testnet'), [], head)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ fromBlock: DEPLOY, toBlock: DEPLOY + 9998n, address: [FACTORY] })
    expect(first.state.scannedTo).toBe(DEPLOY + 9998n)
    expect(first.done).toBe(false)

    await scanStep(client, first.state, [], head)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({ fromBlock: DEPLOY + 9999n, toBlock: DEPLOY + 9998n + LOG_WINDOW })
  })

  it('stops CONFIRMATIONS blocks behind the head', async () => {
    const { calls, client } = fakeNode([])
    const head = DEPLOY + 50n
    const r = await scanStep(client, initialScanState('testnet'), [], head)
    expect(calls[0]!.toBlock).toBe(head - CONFIRMATIONS)
    expect(r.state.scannedTo).toBe(head - CONFIRMATIONS)
    expect(r.done).toBe(true)

    // Caught up: no call while the head has not moved.
    const again = await scanStep(client, r.state, [], head)
    expect(calls).toHaveLength(1)
    expect(again).toEqual({ state: r.state, done: true, calls: 0 })
  })

  it('resumes from saved scannedTo', async () => {
    const { calls, client } = fakeNode([])
    await scanStep(client, state({ scannedTo: DEPLOY + 40_000n, covered: [A] }), [{ address: A, createdAtBlock: DEPLOY }], DEPLOY + 90_000n)
    expect(calls).toEqual([{ address: [FACTORY, A], fromBlock: DEPLOY + 40_001n, toBlock: DEPLOY + 40_000n + LOG_WINDOW }])
  })

  it('adds a Fundit to the request once the window reaches its creation block', async () => {
    const { calls, client } = fakeNode([donated(A, DEPLOY + 20n)])
    const fundits = [
      { address: A, createdAtBlock: DEPLOY + 10n },
      { address: B, createdAtBlock: DEPLOY + 50_000n },
    ]
    const r = await scanStep(client, initialScanState('testnet'), fundits, DEPLOY + 100_000n)
    expect(calls[0]!.address).toEqual([FACTORY, A])
    expect(r.state.covered).toEqual([A])
    expect(r.state.events).toHaveLength(1)
  })

  it('backfills a new Fundit from its creation block before moving on', async () => {
    const scannedTo = DEPLOY + 500n
    const { calls, client } = fakeNode([donated(B, DEPLOY + 310n), donated(A, DEPLOY + 600n)])
    const fundits = [
      { address: A, createdAtBlock: DEPLOY },
      { address: B, createdAtBlock: DEPLOY + 300n },
    ]
    const head = DEPLOY + 100_000n

    const back = await scanStep(client, state({ scannedTo, covered: [A] }), fundits, head)
    expect(calls[0]).toEqual({ address: [B], fromBlock: DEPLOY + 300n, toBlock: scannedTo })
    expect(back.state.scannedTo).toBe(scannedTo)
    expect(back.state.covered).toEqual([A, B])
    expect(back.state.events.map((e) => e.blockNumber)).toEqual([DEPLOY + 310n])
    expect(back.done).toBe(false)

    const next = await scanStep(client, back.state, fundits, head)
    expect(calls[1]).toEqual({ address: [FACTORY, A, B], fromBlock: scannedTo + 1n, toBlock: scannedTo + LOG_WINDOW })
    expect(next.state.events.map((e) => e.blockNumber)).toEqual([DEPLOY + 310n, DEPLOY + 600n])
  })

  it('backfills a long gap one window at a time and never moves scannedTo meanwhile', async () => {
    const scannedTo = DEPLOY + 25_000n
    const { calls, client } = fakeNode([])
    const fundits = [{ address: B, createdAtBlock: DEPLOY + 1n }]
    const head = DEPLOY + 100_000n
    let s = state({ scannedTo })
    for (let i = 0; i < 3; i++) s = (await scanStep(client, s, fundits, head)).state
    expect(calls.map((c) => [c.address, c.fromBlock, c.toBlock])).toEqual([
      [[B], DEPLOY + 1n, DEPLOY + LOG_WINDOW],
      [[B], DEPLOY + 1n + LOG_WINDOW, DEPLOY + 2n * LOG_WINDOW],
      [[B], DEPLOY + 1n + 2n * LOG_WINDOW, scannedTo],
    ])
    expect(s.scannedTo).toBe(scannedTo)
    expect(s.covered).toEqual([B])
    expect(s.backfill).toBeUndefined()
  })

  it('finishes a due backfill before it says done at the head', async () => {
    const head = DEPLOY + 1_000n
    const { calls, client } = fakeNode([])
    const r = await scanStep(client, state({ scannedTo: head - CONFIRMATIONS }), [{ address: B, createdAtBlock: DEPLOY + 5n }], head)
    expect(calls).toHaveLength(1)
    expect(r.done).toBe(true)
    expect(r.state.covered).toEqual([B])
  })

  // Arc's RPC refuses a getLogs call with more than 20 addresses (code -32012, "requested range too large"), even for
  // 100 blocks (probed 2026-10-26). A window over many Fundits is read in calls of at most 20 addresses.
  it('asks for at most 20 addresses a call and reads every one of them', async () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ address: addr(0x1000 + i), createdAtBlock: DEPLOY }))
    const { calls, client } = fakeNode(many.map((f, i) => donated(f.address, DEPLOY + BigInt(i), 0)))
    const r = await scanStep(client, initialScanState('testnet'), many, DEPLOY + 100_000n)
    expect(ADDRESS_CHUNK).toBe(20)
    expect(calls.map((c) => c.address.length)).toEqual([20, 20, 6])
    expect(calls.every((c) => c.fromBlock === DEPLOY && c.toBlock === DEPLOY + 9998n)).toBe(true)
    expect(calls[0]!.address[0]).toBe(FACTORY)
    expect(r.state.events).toHaveLength(45)
    expect(r.state.covered).toHaveLength(45)
  })

  it('drops logs from addresses it did not ask for', async () => {
    const foreign = [
      donated(STRANGER, DEPLOY + 5n, 1),
      // A factory event name from a Fundit address, and a gift from the factory address, are not real either.
      { address: A, blockNumber: DEPLOY + 6n, logIndex: 0, eventName: 'TreasuryUpdated', args: { treasury: STRANGER } },
      donated(FACTORY, DEPLOY + 7n, 0),
    ]
    const { client } = fakeNode([donated(A, DEPLOY + 5n)], foreign)
    const r = await scanStep(client, initialScanState('testnet'), [{ address: A, createdAtBlock: DEPLOY }], DEPLOY + 100n)
    expect(r.state.events.map((e) => e.address)).toEqual([A])
  })

  it('keeps bigints as decimal strings and never keeps the gift message', async () => {
    const { client } = fakeNode([donated(A, DEPLOY + 5n, 3, 12_345_678_901_234_567_890n)])
    const r = await scanStep(client, initialScanState('testnet'), [{ address: A, createdAtBlock: DEPLOY }], DEPLOY + 100n)
    expect(r.state.events).toEqual([
      {
        kind: 'Donated',
        address: A,
        blockNumber: DEPLOY + 5n,
        logIndex: 3,
        txHash: TX,
        args: { donor: DONOR, amount: '12345678901234567890', fee: '1', tip: '2' },
      },
    ])
    expect(JSON.stringify(r.state.events, (_k, v) => (typeof v === 'bigint' ? String(v) : v))).not.toContain('secret')
  })

  it('does not duplicate events when a window is read twice', async () => {
    const logs = [donated(A, DEPLOY + 9n, 1), donated(A, DEPLOY + 9n, 0), donated(A, DEPLOY + 3n, 4)]
    const { client } = fakeNode(logs)
    const fundits = [{ address: A, createdAtBlock: DEPLOY }]
    const once = await scanStep(client, initialScanState('testnet'), fundits, DEPLOY + 100n)
    // The same window again, as after a save that did not land.
    const twice = await scanStep(client, { ...once.state, scannedTo: DEPLOY - 1n }, fundits, DEPLOY + 100n)
    expect(twice.state.events.map((e) => [e.blockNumber, e.logIndex])).toEqual([
      [DEPLOY + 3n, 4],
      [DEPLOY + 9n, 0],
      [DEPLOY + 9n, 1],
    ])
  })

  it('throws instead of keeping a window the node may have cut short', async () => {
    const many = Array.from({ length: 2000 }, (_, i) => donated(A, DEPLOY + 1n, i))
    const { client } = fakeNode(many)
    const s = initialScanState('testnet')
    await expect(scanStep(client, s, [{ address: A, createdAtBlock: DEPLOY }], DEPLOY + 100n)).rejects.toThrow(/2000 or more/)
  })
})

describe('isRateLimit', () => {
  it('treats -32005 and 429 as rate limits and other errors as errors', () => {
    expect(isRateLimit({ code: -32005, message: 'limit exceeded' })).toBe(true)
    expect(isRateLimit({ status: 429, message: 'HTTP request failed.' })).toBe(true)
    expect(isRateLimit(new Error('rate limit exceeded'))).toBe(true)
    // viem wraps the RPC error, so the code can sit further down the cause chain.
    expect(isRateLimit(Object.assign(new Error('RPC Request failed.'), { cause: { code: -32005, message: 'x' } }))).toBe(true)

    expect(isRateLimit(new Error('execution reverted'))).toBe(false)
    expect(isRateLimit({ code: -32602, message: 'invalid params' })).toBe(false)
    expect(isRateLimit({ status: 500, message: 'Internal Server Error' })).toBe(false)
    expect(isRateLimit(undefined)).toBe(false)
  })
})

// The loop around scanStep: it must never sit in a silent loading state. A rate limit shows a wait with its end
// time and then resumes; any other error shows and is tried again; once caught up it polls.
describe('runScan', () => {
  it('waits out rate limits with a growing wait, resumes, then polls once caught up', async () => {
    const head = DEPLOY + 2n * LOG_WINDOW
    let refusals = 5
    const getLogs = async () => {
      if (refusals-- > 0) throw Object.assign(new Error('RPC Request failed.'), { cause: { code: -32005, message: 'rate limit exceeded' } })
      return []
    }
    const client = { getLogs, getBlockNumber: async () => head } as never
    const controller = new AbortController()
    const statuses: ScanStatus[] = []
    const waits: number[] = []
    let saved: ScanState | null = null
    await runScan({
      client,
      state: initialScanState('testnet'),
      fundits: () => [],
      signal: controller.signal,
      now: () => 1_000,
      onStep: (s) => (saved = s),
      onStatus: (s) => statuses.push(s),
      sleep: async (ms) => {
        waits.push(ms)
        if (ms === POLL_MS) controller.abort()
      },
    })
    expect(waits).toEqual([
      BACKOFF_START_MS,
      BACKOFF_START_MS * 2,
      BACKOFF_START_MS * 4,
      BACKOFF_START_MS * 8,
      BACKOFF_MAX_MS,
      PAUSE_MS,
      POLL_MS,
    ])
    expect(statuses[0]).toEqual({ kind: 'waiting', resumeAt: 1_000 + BACKOFF_START_MS })
    expect(statuses.at(-2)).toEqual({ kind: 'scanning' })
    expect(statuses.at(-1)).toEqual({ kind: 'caughtUp' })
    expect(saved!.scannedTo).toBe(head - CONFIRMATIONS)
  })

  it('shows other errors and tries again', async () => {
    let fail = true
    const client = {
      getLogs: async () => [],
      getBlockNumber: async () => {
        if (fail) {
          fail = false
          throw new Error('fetch failed')
        }
        return DEPLOY + 10n
      },
    } as never
    const controller = new AbortController()
    const statuses: ScanStatus[] = []
    await runScan({
      client,
      state: initialScanState('testnet'),
      fundits: () => [],
      signal: controller.signal,
      now: () => 0,
      onStep: () => {},
      onStatus: (s) => statuses.push(s),
      sleep: async (ms) => {
        if (ms === POLL_MS) controller.abort()
      },
    })
    expect(statuses).toEqual([{ kind: 'error', message: 'fetch failed', resumeAt: BACKOFF_START_MS }, { kind: 'caughtUp' }])
  })

  it('shows the reason the RPC gave for an error', async () => {
    const err = Object.assign(new Error('RPC Request failed.'), {
      shortMessage: 'RPC Request failed.',
      details: 'requested data not available',
      cause: { code: -32014, message: 'requested data not available' },
    })
    const client = { getLogs: async () => [], getBlockNumber: async () => Promise.reject(err) } as never
    const controller = new AbortController()
    const statuses: ScanStatus[] = []
    await runScan({
      client,
      state: initialScanState('testnet'),
      fundits: () => [],
      signal: controller.signal,
      now: () => 0,
      onStep: () => {},
      onStatus: (s) => statuses.push(s),
      sleep: async () => controller.abort(),
    })
    expect(statuses).toEqual([{ kind: 'error', message: 'requested data not available', resumeAt: BACKOFF_START_MS }])
  })

  it('keeps the pace at one call per pause when a step makes several calls', async () => {
    const many = Array.from({ length: 41 }, (_, i) => ({ address: addr(0x1000 + i), createdAtBlock: DEPLOY }))
    const client = { getLogs: async () => [], getBlockNumber: async () => DEPLOY + 2n * LOG_WINDOW } as never
    const controller = new AbortController()
    const waits: number[] = []
    await runScan({
      client,
      state: initialScanState('testnet'),
      fundits: () => many,
      signal: controller.signal,
      onStep: () => {},
      onStatus: () => {},
      sleep: async (ms) => {
        waits.push(ms)
        controller.abort()
      },
    })
    // Factory plus 41 Fundits: three calls in the first window.
    expect(waits).toEqual([3 * PAUSE_MS])
  })
})

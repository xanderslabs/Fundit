import type { Address, Hex, Log, PublicClient } from 'viem'
import { campaignAbi } from '../../../src/abi/campaign'
import { factoryAbi } from '../../../src/abi/factory'
import { MAX_LOGS } from '../../../src/config'
import type { LogClient } from '../../../src/lib/activity'
import { type AdminNetwork, ADMIN_NETWORKS } from './networks'

// The history scan reads gifts (from every Fundit) and settings changes (from the factory) in one pass, one
// eth_getLogs call at a time, from the factory's deploy block up. Its state is saved in the owner's browser only.

// Arc's public RPC allows 10,000 blocks a call, so a window is LOG_WINDOW blocks counted inclusively.
export const LOG_WINDOW = 9_999n
// The scan stays this many blocks behind the head, so a reorg cannot change what it has read.
export const CONFIRMATIONS = 2n
// The wait between calls, and the wait after a rate-limit answer, doubling up to the ceiling.
export const PAUSE_MS = 1_500
export const BACKOFF_START_MS = 10_000
export const BACKOFF_MAX_MS = 120_000
// Once caught up, the scan looks for new blocks this often.
export const POLL_MS = 60_000
// Arc's RPC refuses a getLogs call with more than 20 addresses (code -32012, "requested range too large", probed
// 2026-10-26), so a window over more addresses is read in several calls.
export const ADDRESS_CHUNK = 20

const CAMPAIGN_KINDS = ['Donated', 'FeesClaimed'] as const
const FACTORY_KINDS = [
  'FeesUpdated',
  'TreasuryUpdated',
  'FeaturedUpdated',
  'CreationPausedSet',
  'EurcPayoutDomainSet',
  'CampaignCreatorChanged',
  'OwnershipTransferStarted',
  'OwnershipTransferred',
] as const

export type ScanEvent = {
  kind: (typeof CAMPAIGN_KINDS)[number] | (typeof FACTORY_KINDS)[number]
  address: Address
  blockNumber: bigint
  logIndex: number
  txHash: Hex
  // bigints are kept as decimal strings.
  args: Record<string, string | boolean>
}

export type ScanState = {
  v: 1
  network: AdminNetwork
  factory: Address
  // The last block read, inclusive.
  scannedTo: bigint
  // Fundits whose logs are read up to scannedTo.
  covered: Address[]
  events: ScanEvent[]
  // A backfill in progress: these Fundits were created at or before scannedTo but not yet covered, and are read
  // up to readTo. They join covered once readTo reaches scannedTo.
  backfill?: { addresses: Address[]; readTo: bigint }
}

export type ScanFundit = { address: Address; createdAtBlock: bigint }

export function initialScanState(network: AdminNetwork): ScanState {
  const { factory, deployBlock } = ADMIN_NETWORKS[network]
  return { v: 1, network, factory, scannedTo: deployBlock - 1n, covered: [], events: [] }
}

type AbiEvent<A extends readonly unknown[]> = Extract<A[number], { type: 'event' }>
const CAMPAIGN_EVENTS = campaignAbi.filter(
  (x): x is AbiEvent<typeof campaignAbi> => x.type === 'event' && (CAMPAIGN_KINDS as readonly string[]).includes(x.name),
)
const FACTORY_EVENTS = factoryAbi.filter(
  (x): x is AbiEvent<typeof factoryAbi> => x.type === 'event' && (FACTORY_KINDS as readonly string[]).includes(x.name),
)
const EVENTS = [...CAMPAIGN_EVENTS, ...FACTORY_EVENTS]

// Fields that are never kept: the gift message is the donor's own words, and prevActivityBlock is only a walk link.
const DROPPED_ARGS = new Set(['message', 'prevActivityBlock'])

type Decoded = Log & { eventName?: string; args?: Record<string, unknown> }

function toArgs(args: Record<string, unknown>): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (const [k, v] of Object.entries(args)) {
    if (DROPPED_ARGS.has(k)) continue
    out[k] = typeof v === 'boolean' ? v : String(v)
  }
  return out
}

const lower = (a: string) => a.toLowerCase()

// Sorted by (blockNumber, logIndex), one entry per log.
function merge(old: ScanEvent[], added: ScanEvent[]): ScanEvent[] {
  if (added.length === 0) return old
  const byKey = new Map<string, ScanEvent>()
  for (const e of [...old, ...added]) byKey.set(`${e.blockNumber}:${e.logIndex}`, e)
  return [...byKey.values()].sort((a, b) =>
    a.blockNumber !== b.blockNumber ? (a.blockNumber < b.blockNumber ? -1 : 1) : a.logIndex - b.logIndex,
  )
}

// One window, one getLogs call per ADDRESS_CHUNK addresses. Only the asked addresses are kept, and from each only
// its own kind of event: anyone can deploy a contract that emits Donated, so the address filter is checked here again.
async function read(client: LogClient, factory: Address, fundits: Address[], withFactory: boolean, from: bigint, to: bigint) {
  const address = withFactory ? [factory, ...fundits] : fundits
  const logs: Decoded[] = []
  let calls = 0
  for (let i = 0; i < address.length; i += ADDRESS_CHUNK) {
    const chunk = address.slice(i, i + ADDRESS_CHUNK)
    const part = (await client.getLogs({ address: chunk, events: EVENTS, fromBlock: from, toBlock: to })) as Decoded[]
    calls++
    // The node may cut a long answer short without saying so. An answer that may be cut is never kept as whole.
    if (part.length >= MAX_LOGS) throw new Error(`Blocks ${from} to ${to} have ${MAX_LOGS} or more logs`)
    logs.push(...part)
  }
  const asked = new Set(fundits.map(lower))
  const out: ScanEvent[] = []
  for (const log of logs) {
    if (!log.args || !log.eventName || log.blockNumber === null || log.logIndex === null || !log.transactionHash) continue
    const fromFactory = withFactory && lower(log.address) === lower(factory)
    const kinds: readonly string[] = fromFactory ? FACTORY_KINDS : asked.has(lower(log.address)) ? CAMPAIGN_KINDS : []
    if (!kinds.includes(log.eventName)) continue
    out.push({
      kind: log.eventName as ScanEvent['kind'],
      address: log.address,
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      txHash: log.transactionHash,
      args: toArgs(log.args),
    })
  }
  return { events: out, calls }
}

function min(a: bigint, b: bigint) {
  return a < b ? a : b
}

// Fundits created at or before scannedTo that the scan has not read yet.
function due(state: ScanState, fundits: ScanFundit[]): ScanFundit[] {
  const covered = new Set(state.covered.map(lower))
  return fundits.filter((f) => !covered.has(lower(f.address)) && f.createdAtBlock <= state.scannedTo)
}

function isDone(state: ScanState, fundits: ScanFundit[], head: bigint): boolean {
  return state.scannedTo >= head - CONFIRMATIONS && !state.backfill && due(state, fundits).length === 0
}

// One step of the scan: one window, read in one getLogs call per ADDRESS_CHUNK addresses (calls says how many).
// A backfill of Fundits the scan has missed comes first; otherwise
// the next window from scannedTo + 1 for the factory, every covered Fundit and any Fundit created in that window.
export async function scanStep(
  client: LogClient,
  state: ScanState,
  fundits: ScanFundit[],
  head: bigint,
): Promise<{ state: ScanState; done: boolean; calls: number }> {
  let backfill = state.backfill
  if (!backfill) {
    const missed = due(state, fundits)
    if (missed.length > 0) {
      const start = missed.reduce((m, f) => min(m, f.createdAtBlock), missed[0]!.createdAtBlock)
      backfill = { addresses: missed.map((f) => f.address), readTo: start - 1n }
    }
  }

  if (backfill) {
    const from = backfill.readTo + 1n
    const to = min(from + LOG_WINDOW - 1n, state.scannedTo)
    const { events, calls } = await read(client, state.factory, backfill.addresses, false, from, to)
    const next: ScanState = { ...state, events: merge(state.events, events) }
    if (to >= state.scannedTo) {
      next.covered = [...state.covered, ...backfill.addresses]
      delete next.backfill
    } else {
      next.backfill = { addresses: backfill.addresses, readTo: to }
    }
    return { state: next, done: isDone(next, fundits, head), calls }
  }

  const safe = head - CONFIRMATIONS
  if (state.scannedTo >= safe) return { state, done: true, calls: 0 }
  const from = state.scannedTo + 1n
  const to = min(state.scannedTo + LOG_WINDOW, safe)
  const covered = new Set(state.covered.map(lower))
  const born = fundits.filter((f) => !covered.has(lower(f.address)) && f.createdAtBlock >= from && f.createdAtBlock <= to)
  const addresses = [...state.covered, ...born.map((f) => f.address)]
  const { events, calls } = await read(client, state.factory, addresses, true, from, to)
  const next: ScanState = { ...state, scannedTo: to, covered: addresses, events: merge(state.events, events) }
  return { state: next, done: isDone(next, fundits, head), calls }
}

// A rate-limit answer: JSON-RPC code -32005, HTTP 429, or "rate limit" in the message, anywhere down the cause chain
// (viem wraps the RPC's own error).
export function isRateLimit(err: unknown): boolean {
  for (let e = err, depth = 0; e && typeof e === 'object' && depth < 10; e = (e as { cause?: unknown }).cause, depth++) {
    const { code, status, message } = e as { code?: unknown; status?: unknown; message?: unknown }
    if (code === -32005 || status === 429) return true
    if (typeof message === 'string' && /rate limit/i.test(message)) return true
  }
  return false
}

export type ScanStatus = { kind: 'scanning' | 'waiting' | 'caughtUp' | 'error'; resumeAt?: number; message?: string }

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const t = setTimeout(done, ms)
    function done() {
      clearTimeout(t)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done)
  })
}

// The RPC's own reason ("requested data not available") where viem has it, else viem's short message.
function errorText(err: unknown): string {
  const e = err as { details?: unknown; shortMessage?: unknown; message?: unknown }
  if (typeof e?.details === 'string' && e.details) return e.details
  if (typeof e?.shortMessage === 'string') return e.shortMessage
  if (typeof e?.message === 'string') return e.message
  return String(err)
}

// The scan loop for one network, until signal aborts: one step at a time with PAUSE_MS per call between, POLL_MS between
// checks once caught up. A rate limit waits from BACKOFF_START_MS, doubling to BACKOFF_MAX_MS; other errors wait the
// same way and show their message. Every wait reports when it ends, so the page never shows a bare loading state.
export async function runScan(opts: {
  client: LogClient & Pick<PublicClient, 'getBlockNumber'>
  state: ScanState
  fundits(): ScanFundit[]
  signal: AbortSignal
  onStep(state: ScanState, head: bigint): void
  onStatus(status: ScanStatus): void
  now?(): number
  sleep?(ms: number, signal: AbortSignal): Promise<void>
}): Promise<void> {
  const { client, signal, onStep, onStatus } = opts
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? abortableSleep
  let state = opts.state
  let backoff = BACKOFF_START_MS
  while (!signal.aborted) {
    let wait: number
    try {
      const head = await client.getBlockNumber()
      if (signal.aborted) return
      const r = await scanStep(client, state, opts.fundits(), head)
      if (signal.aborted) return
      state = r.state
      onStep(state, head)
      backoff = BACKOFF_START_MS
      onStatus({ kind: r.done ? 'caughtUp' : 'scanning' })
      wait = r.done ? POLL_MS : PAUSE_MS * Math.max(1, r.calls)
    } catch (err) {
      if (signal.aborted) return
      wait = backoff
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS)
      const resumeAt = now() + wait
      onStatus(isRateLimit(err) ? { kind: 'waiting', resumeAt } : { kind: 'error', message: errorText(err), resumeAt })
    }
    await sleep(wait, signal)
  }
}

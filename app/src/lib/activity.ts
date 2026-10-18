import { type Address, decodeEventLog, type Hex, type Log, type PublicClient } from 'viem'
import { campaignAbi } from '../abi/campaign'
import { factoryAbi } from '../abi/factory'
import { FACTORY_ADDRESS, FACTORY_DEPLOY_BLOCK, MAX_LOG_RANGE, MAX_LOGS } from '../config'

export type ActivityKind =
  | 'donation'
  | 'external'
  | 'withdrawal'
  | 'edit'
  | 'close'
  | 'fees'
  | 'sweep'
  | 'backup'
  | 'recovery-start'
  | 'recovery-cancel'
  | 'creator-change'

export type ActivityItem = {
  kind: ActivityKind
  blockNumber: bigint
  txHash: Hex
  logIndex: number
  data: Record<string, unknown>
}

export type LogClient = Pick<PublicClient, 'getLogs'>

export type WalkOptions = {
  fromBlockTip: bigint
  createdAtBlock: bigint
  lastActivityBlock: bigint
  limit: number
  cursor?: bigint
}

const KINDS: Record<string, ActivityKind> = {
  Donated: 'donation',
  ExternalDonationSettled: 'external',
  Withdrawn: 'withdrawal',
  Edited: 'edit',
  Closed: 'close',
  FeesClaimed: 'fees',
  Swept: 'sweep',
  BackupSet: 'backup',
  RecoveryInitiated: 'recovery-start',
  RecoveryCancelled: 'recovery-cancel',
  CreatorChanged: 'creator-change',
}

// Messages Arc's public RPC returns when a range is too wide or returns too much. Other errors are
// rethrown, so a dead network fails once instead of splitting into thousands of calls.
const LIMIT_ERROR = /range too large|exceeds max results|too many results/i
// Splitting on a rate limit would multiply the calls that caused it.
const RATE_LIMITED = /\b429\b|rate limit/i

type Decoded = ActivityItem & { prev: bigint }

function decode(log: Log): Decoded | null {
  try {
    const { eventName, args } = decodeEventLog({ abi: campaignAbi, topics: log.topics, data: log.data })
    const kind = KINDS[eventName]
    if (!kind || log.blockNumber === null || log.transactionHash === null || log.logIndex === null) return null
    const data = args as unknown as Record<string, unknown>
    return {
      kind,
      blockNumber: log.blockNumber,
      txHash: log.transactionHash,
      logIndex: log.logIndex,
      data,
      prev: BigInt(data.prevActivityBlock as bigint),
    }
  } catch {
    // Not a Campaign event. The walk only follows events from the ABI.
    return null
  }
}

type RangeFetch = (fromBlock: bigint, toBlock: bigint) => Promise<Log[]>

// Fetches [from, to]. If the RPC refuses the range or hits the log cap, halves it and retries each part.
async function getLogsSplit(fetchRange: RangeFetch, from: bigint, to: bigint): Promise<Log[]> {
  let refused: unknown = null
  try {
    const logs = await fetchRange(from, to)
    if (logs.length < MAX_LOGS) return logs
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (RATE_LIMITED.test(message) || !LIMIT_ERROR.test(message)) throw err
    refused = err
  }
  if (from === to) throw refused ?? new Error(`Block ${from} has ${MAX_LOGS} or more logs`)
  const mid = from + (to - from) / 2n
  const older = await getLogsSplit(fetchRange, from, mid)
  const newer = await getLogsSplit(fetchRange, mid + 1n, to)
  return [...older, ...newer]
}

function newestFirst(a: ActivityItem, b: ActivityItem): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber > b.blockNumber ? -1 : 1
  return b.logIndex - a.logIndex
}

// Walks the campaign's history backwards through prevActivityBlock, newest first. See contracts/README.md.
// A page never splits a block, so it can hold a few more than limit items. nextCursor feeds "Load more".
export async function walkActivity(
  client: LogClient,
  campaign: Address,
  opts: WalkOptions,
): Promise<{ items: ActivityItem[]; nextCursor: bigint | null }> {
  const { createdAtBlock, limit } = opts
  let cursor = opts.cursor ?? opts.lastActivityBlock
  if (cursor > opts.fromBlockTip) cursor = opts.fromBlockTip
  const found: Decoded[] = []
  const fetchRange: RangeFetch = async (fromBlock, toBlock) =>
    (await client.getLogs({ address: campaign, fromBlock, toBlock })) as Log[]

  while (cursor >= createdAtBlock) {
    const lowest = cursor - MAX_LOG_RANGE + 1n
    const from = lowest > createdAtBlock ? lowest : createdAtBlock
    const window = (await getLogsSplit(fetchRange, from, cursor))
      .map(decode)
      .filter((d): d is Decoded => d !== null)
    found.push(...window)
    found.sort(newestFirst)
    const reachedStart = from === createdAtBlock

    if (found.length >= limit && found.length > 0) {
      // Cut at the block holding item number `limit`, keeping that whole block.
      const edge = found[Math.max(limit, 1) - 1]!.blockNumber
      const kept = found.filter((d) => d.blockNumber >= edge)
      const cutSomething = kept.length < found.length
      const done = edge === createdAtBlock || (reachedStart && !cutSomething)
      return { items: kept.map(strip), nextCursor: done ? null : kept[kept.length - 1]!.prev }
    }
    if (reachedStart) break
    if (window.length === 0) {
      // Only when the cursor was not an activity block (clamped to the tip, for example). Step back a window.
      cursor = from - 1n
      continue
    }
    // Every event in the oldest block of the window points to the activity block before the window.
    const prev = window.reduce((min, d) => (d.prev < min ? d.prev : min), window[0]!.prev)
    // A pointer inside the window would loop forever. The contract never emits one, but step back anyway.
    cursor = prev < from ? prev : from - 1n
  }
  return { items: found.map(strip), nextCursor: null }
}

function strip({ prev: _prev, ...item }: Decoded): ActivityItem {
  return item
}

export type DonationItem = ActivityItem & { campaign: Address }

export type DonationClient = Pick<PublicClient, 'getLogs' | 'getBlockNumber' | 'multicall'>

export const RECENT_DONATION_BLOCKS = 200_000n

type DonatedEvent = Extract<(typeof campaignAbi)[number], { type: 'event'; name: 'Donated' }>
const DONATED = campaignAbi.find((x): x is DonatedEvent => x.type === 'event' && x.name === 'Donated')!

// factory.isCampaign never turns false, so a true answer is kept for the session. False is asked again.
const knownCampaigns = new Set<string>()

async function onlyCampaigns(client: DonationClient, addresses: Address[]): Promise<Set<string>> {
  const unknown = [...new Set(addresses.map((a) => a.toLowerCase()))].filter((a) => !knownCampaigns.has(a))
  if (unknown.length > 0) {
    const answers = await client.multicall({
      contracts: unknown.map(
        (a) => ({ address: FACTORY_ADDRESS, abi: factoryAbi, functionName: 'isCampaign', args: [a as Address] }) as const,
      ),
      allowFailure: false,
    })
    unknown.forEach((a, i) => {
      if (answers[i]) knownCampaigns.add(a)
    })
  }
  return knownCampaigns
}

// Donated logs from any address, filtered by the indexed donor topic, newest first. Anyone can deploy a
// contract that emits Donated, so only logs from factory campaigns are kept. Money that reaches a campaign
// without donate() does not name the donor on Arc, so it cannot appear here.
export async function recentDonationsBy(
  client: DonationClient,
  donor: Address,
  opts: { blocks?: bigint } = {},
): Promise<DonationItem[]> {
  const tip = await client.getBlockNumber()
  const span = opts.blocks ?? RECENT_DONATION_BLOCKS
  const start = tip - span + 1n > FACTORY_DEPLOY_BLOCK ? tip - span + 1n : FACTORY_DEPLOY_BLOCK
  const fetchRange: RangeFetch = async (fromBlock, toBlock) =>
    (await client.getLogs<DonatedEvent>({ event: DONATED, args: { donor }, fromBlock, toBlock })) as Log[]

  const logs: Log[] = []
  for (let to = tip; to >= start; to -= MAX_LOG_RANGE) {
    const from = to - MAX_LOG_RANGE + 1n > start ? to - MAX_LOG_RANGE + 1n : start
    logs.push(...(await getLogsSplit(fetchRange, from, to)))
  }
  if (logs.length === 0) return []
  const campaigns = await onlyCampaigns(client, logs.map((l) => l.address))
  return logs
    .filter((l) => campaigns.has(l.address.toLowerCase()))
    .map((l) => {
      const d = decode(l)
      return d && d.kind === 'donation' ? { ...strip(d), campaign: l.address } : null
    })
    .filter((d): d is DonationItem => d !== null)
    .sort(newestFirst)
}

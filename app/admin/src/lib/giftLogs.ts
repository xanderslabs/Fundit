import type { Address, Log, PublicClient } from 'viem'
import { campaignAbi } from '../../../src/abi/campaign'
import { getLogsSplit, type LogClient, type RangeFetch } from '../../../src/lib/activity'
import { type AdminNetwork, ADMIN_NETWORKS } from './networks'
import type { FunditSnapshot } from './snapshot'
import type { ByToken } from './stats'

// Arc's public RPC allows 10,000 blocks a call. The browser reads at most MAX_WINDOWS of them, 4 at a time.
export const LOG_WINDOW = 9_999n
export const MAX_WINDOWS = 500
export const PARALLEL = 4
// Fundit addresses sent in one getLogs call.
export const ADDRESS_CHUNK = 100

// The gift message is read off the chain but never kept.
export type GiftEvent =
  | { kind: 'gift'; fundit: Address; donor: Address; amount: bigint; fee: bigint; tip: bigint }
  | { kind: 'feesClaimed'; fundit: Address; amount: bigint }

type Named<N extends string> = Extract<(typeof campaignAbi)[number], { type: 'event'; name: N }>
const DONATED = campaignAbi.find((x): x is Named<'Donated'> => x.type === 'event' && x.name === 'Donated')!
const FEES_CLAIMED = campaignAbi.find((x): x is Named<'FeesClaimed'> => x.type === 'event' && x.name === 'FeesClaimed')!

export function windows(from: bigint, to: bigint, size: bigint = LOG_WINDOW): [bigint, bigint][] {
  const out: [bigint, bigint][] = []
  for (let start = from; start <= to; start += size) {
    const end = start + size - 1n
    out.push([start, end < to ? end : to])
  }
  return out
}

type Decoded = Log & { eventName?: string; args?: Record<string, unknown> }

export async function fetchGiftEvents(
  client: LogClient & Pick<PublicClient, 'getBlockNumber'>,
  fundits: Address[],
  fromBlock: bigint,
): Promise<{ status: 'ok'; events: GiftEvent[]; toBlock: bigint } | { status: 'too-long'; windows: number }> {
  const toBlock = await client.getBlockNumber()
  const ranges = fundits.length === 0 ? [] : windows(fromBlock, toBlock)
  if (ranges.length > MAX_WINDOWS) return { status: 'too-long', windows: ranges.length }

  // Anyone can deploy a contract that emits Donated, so the RPC is asked only for the Fundit addresses,
  // and logs from any other address are dropped again here.
  const known = new Set(fundits.map((a) => a.toLowerCase()))
  const chunks: Address[][] = []
  for (let i = 0; i < fundits.length; i += ADDRESS_CHUNK) chunks.push(fundits.slice(i, i + ADDRESS_CHUNK))
  const fetchChunk =
    (address: Address[]): RangeFetch =>
    async (from, to) =>
      (await client.getLogs({ address, events: [DONATED, FEES_CLAIMED], fromBlock: from, toBlock: to })) as Log[]

  const results: Log[][] = new Array(ranges.length)
  let next = 0
  async function worker() {
    while (next < ranges.length) {
      const i = next++
      const [from, to] = ranges[i]!
      const logs: Log[] = []
      for (const chunk of chunks) logs.push(...(await getLogsSplit(fetchChunk(chunk), from, to)))
      results[i] = logs
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker))

  const events: GiftEvent[] = []
  for (const log of results.flat() as Decoded[]) {
    if (!known.has(log.address.toLowerCase()) || !log.args) continue
    const a = log.args
    if (log.eventName === 'Donated') {
      events.push({
        kind: 'gift',
        fundit: log.address,
        donor: a.donor as Address,
        amount: a.amount as bigint,
        fee: a.fee as bigint,
        tip: a.tip as bigint,
      })
    } else if (log.eventName === 'FeesClaimed') {
      events.push({ kind: 'feesClaimed', fundit: log.address, amount: a.amount as bigint })
    }
  }
  return { status: 'ok', events, toBlock }
}

export function giftStats(events: GiftEvent[], rows: FunditSnapshot[], showTest: boolean, network: AdminNetwork) {
  const { testCreators } = ADMIN_NETWORKS[network]
  const byFundit = new Map(rows.map((r) => [r.address.toLowerCase(), r]))
  const zero = (): ByToken => ({ USDC: 0n, EURC: 0n })
  const total = zero()
  const count = { USDC: 0n, EURC: 0n }
  const tips = zero()
  const fees = zero()
  const feesClaimed = zero()
  const perDonor = new Map<string, number>()
  let gifts = 0

  for (const e of events) {
    const row = byFundit.get(e.fundit.toLowerCase())
    if (!row || (!showTest && row.isTest)) continue
    if (e.kind === 'feesClaimed') {
      feesClaimed[row.token] += e.amount
      continue
    }
    const donor = e.donor.toLowerCase()
    if (!showTest && testCreators.includes(donor)) continue
    gifts++
    perDonor.set(donor, (perDonor.get(donor) ?? 0) + 1)
    total[row.token] += e.amount
    count[row.token] += 1n
    tips[row.token] += e.tip
    fees[row.token] += e.fee
  }

  const averageGift = zero()
  for (const t of ['USDC', 'EURC'] as const) if (count[t] > 0n) averageGift[t] = total[t] / count[t]
  return {
    gifts,
    uniqueDonors: perDonor.size,
    repeatDonors: [...perDonor.values()].filter((n) => n >= 2).length,
    averageGift,
    tips,
    fees,
    feesClaimed,
  }
}

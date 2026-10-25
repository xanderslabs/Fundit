// The factory's owner events: fetched as raw logs over JSON-RPC (so tests stub fetch), decoded with the app's ABI,
// and written as the plain-words Telegram messages. Only public chain data goes into a message.
import { decodeEventLog, encodeEventTopics, type Address, type Hex } from 'viem'
import { factoryAbi } from '../../src/abi/factory'
import type { AdminChain } from './chain'

export const OWNER_EVENTS = ['FeesUpdated', 'TreasuryUpdated', 'FeaturedUpdated', 'CreationPausedSet', 'OwnershipTransferStarted', 'OwnershipTransferred'] as const
// getLogs windows per cron run, and blocks a head must be buried under before it is announced.
export const MAX_EVENT_WINDOWS_PER_RUN = 5
export const CONFIRMATIONS = 2n

const TIMEOUT_MS = 5_000
const ZERO = '0x0000000000000000000000000000000000000000'

export type OwnerEvent = { name: (typeof OWNER_EVENTS)[number]; args: Record<string, unknown>; blockNumber: bigint; txHash: Hex; logIndex: number }

type RawLog = { topics?: unknown; data?: unknown; blockNumber?: unknown; transactionHash?: unknown; logIndex?: unknown; removed?: unknown }

const isHex = (v: unknown): v is Hex => typeof v === 'string' && /^0x[0-9a-fA-F]*$/.test(v)

// Throws on any RPC problem, so the caller leaves its cursor where it was.
export async function fetchOwnerEvents(rpcUrl: string, factory: Address, from: bigint, to: bigint, fetcher: typeof fetch = (i, n) => fetch(i, n)): Promise<OwnerEvent[]> {
  const topic0 = OWNER_EVENTS.map((eventName) => encodeEventTopics({ abi: factoryAbi, eventName })[0])
  const res = await fetcher(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getLogs',
      params: [{ address: factory, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics: [topic0] }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (res.status !== 200) throw new Error(`RPC ${res.status}`)
  const out = (await res.json()) as { result?: unknown; error?: unknown }
  if (out.error !== undefined || !Array.isArray(out.result)) throw new Error('RPC gave no logs')
  const events: OwnerEvent[] = []
  for (const log of out.result as RawLog[]) {
    if (log.removed === true) continue
    if (!Array.isArray(log.topics) || !isHex(log.data) || !isHex(log.blockNumber) || !isHex(log.transactionHash) || !isHex(log.logIndex)) throw new Error('RPC gave a bad log')
    const decoded = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] })
    if (!(OWNER_EVENTS as readonly string[]).includes(decoded.eventName)) continue
    events.push({
      name: decoded.eventName as OwnerEvent['name'],
      args: (decoded.args ?? {}) as Record<string, unknown>,
      blockNumber: BigInt(log.blockNumber),
      txHash: log.transactionHash,
      logIndex: Number(BigInt(log.logIndex)),
    })
  }
  return events.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1))
}

export const networkLabel = (chain: AdminChain): string => (chain.network === 'testnet' ? 'Arc Testnet' : 'Arc Mainnet')

export function ownerEventText(e: OwnerEvent, chain: AdminChain): string {
  const a = e.args
  let text: string
  switch (e.name) {
    case 'FeesUpdated':
      text = `Fees changed to ${a.donationFeeBps} bps on gifts and ${a.withdrawFeeBps} bps on withdrawals.`
      break
    case 'TreasuryUpdated':
      text = `Treasury changed to ${a.treasury}.`
      break
    case 'FeaturedUpdated':
      text = String(a.campaign).toLowerCase() === ZERO ? 'Featured Fundit cleared.' : `Featured Fundit changed to ${a.campaign}.`
      break
    case 'CreationPausedSet':
      text = a.paused === true ? 'New Fundits paused.' : 'New Fundits allowed again.'
      break
    case 'OwnershipTransferStarted':
      text = `Ownership transfer started to ${a.newOwner}.`
      break
    case 'OwnershipTransferred':
      text = `Ownership moved from ${a.previousOwner} to ${a.newOwner}.`
      break
  }
  return `[${networkLabel(chain)}] ${text} ${chain.explorerUrl}/tx/${e.txHash}`
}

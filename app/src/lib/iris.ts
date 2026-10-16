import type { Hex } from 'viem'
import { IRIS_URL } from '../config'

// CCTP finality thresholds: 1000 is a Fast transfer, 2000 is Standard.
const FAST_THRESHOLD = 1000
const STANDARD_THRESHOLD = 2000

type FeeTier = { finalityThreshold: number; minimumFee: number; forwardFee: { low: number; med: number; high: number } }

export type ForwardFee = { maxFee: bigint; protocolFee: bigint; forwardFee: bigint }

// Fee quote for a forwarded USDC transfer, in 6-decimal units. Used before a wallet is connected, and as
// the fallback when Bridge Kit's estimate through the wallet's network fails.
export async function fetchForwardFee(srcDomain: number, dstDomain: number, amount: bigint, fast: boolean): Promise<ForwardFee> {
  const res = await fetch(`${IRIS_URL}/v2/burn/USDC/fees/${srcDomain}/${dstDomain}?forward=true`)
  if (!res.ok) throw new Error(`Circle did not return a fee quote (HTTP ${res.status}).`)
  const tiers = (await res.json()) as FeeTier[]
  const threshold = fast ? FAST_THRESHOLD : STANDARD_THRESHOLD
  const tier = Array.isArray(tiers) ? tiers.find((t) => t.finalityThreshold === threshold) : undefined
  if (!tier) throw new Error('Circle did not return a fee quote for this speed.')
  // high, as Bridge Kit budgets: the fee charged is never above it, so "at least" amounts stay true.
  // BigInt throws on a fractional or missing value, so a malformed quote fails loudly.
  const forwardFee = BigInt(tier.forwardFee.high)
  // minimumFee is in basis points with up to two decimals: amount * bps / 10,000.
  const protocolFee = (amount * BigInt(Math.round(tier.minimumFee * 100))) / 1_000_000n
  return { maxFee: forwardFee + protocolFee, protocolFee, forwardFee }
}

export type TransferStatus = 'pending' | 'attested' | 'minted' | 'unknown'

type IrisMessage = { status?: unknown; forwardTxHash?: unknown }

// Where a burn is on its way to Arc. 'unknown' means Iris could not be asked, not that anything failed.
export async function fetchTransferStatus(srcDomain: number, burnTx: Hex): Promise<TransferStatus> {
  let res: Response
  try {
    res = await fetch(`${IRIS_URL}/v2/messages/${srcDomain}?transactionHash=${burnTx}`)
  } catch {
    return 'unknown'
  }
  // Iris answers 404 until it has seen the burn.
  if (res.status === 404) return 'pending'
  if (!res.ok) return 'unknown'
  let body: { messages?: IrisMessage[] }
  try {
    body = (await res.json()) as { messages?: IrisMessage[] }
  } catch {
    return 'unknown'
  }
  const message = Array.isArray(body?.messages) ? body.messages[0] : undefined
  if (!message) return 'pending'
  if (typeof message.forwardTxHash === 'string' && message.forwardTxHash !== '') return 'minted'
  if (message.status === 'complete') return 'attested'
  return 'pending'
}

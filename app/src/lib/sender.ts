import { type Address, type Hex, type TransactionReceipt, WaitForTransactionReceiptTimeoutError } from 'viem'
import type { TokenSymbol } from '../config'
import { arcClient } from './clients'
import { revertText } from './errors'

// No value field: Arc amounts always move through the ERC-20 interface, never msg.value.
export type Call = { to: Address; data: Hex }

// completed counts the calls in this send() that were mined successfully before it stopped.
export type TxResult =
  | { status: 'success'; hash: Hex; receipt: TransactionReceipt }
  | { status: 'reverted'; hash: Hex; error: string; completed: number }
  | { status: 'timeout'; hash: Hex; completed: number }
  | { status: 'rejected'; completed: number }

// onHash runs as soon as a hash for calls[index] is known, before its receipt, so a caller can save it and a
// reload during the wait still knows it went out.
// A payment, for the approval screen of an email account (Circle's window): what goes out and who receives it.
export type PaymentReview = { amount: bigint; symbol: TokenSymbol; toName: string; to: Address }
export type SendOptions = { label: string; payment?: PaymentReview; onHash?: (hash: Hex, index: number) => void }

// The single write path. Every action builds Calls and hands them to a Sender.
// send() resolves to a TxResult. It throws only for a failure before anything is sent (for example a
// gas estimate that reverts), so callers pass that to explainError (lib/errors.ts).
export interface Sender {
  kind: 'email' | 'wallet'
  address: Address
  send(calls: Call[], opts?: SendOptions): Promise<TxResult>
}

// The viem public actions waitForResult needs. viem resolves a reverted receipt; it does not throw.
export type ReceiptClient = {
  waitForTransactionReceipt(args: { hash: Hex; timeout?: number }): Promise<TransactionReceipt>
  getTransaction(args: { hash: Hex }): Promise<{ from: Address; to: Address | null; input: Hex }>
  call(args: { account: Address; to: Address | null; data: Hex; blockNumber: bigint }): Promise<unknown>
}

// Arc reads go through our own public RPC client, not the wallet.
export const arcReceipts: ReceiptClient = {
  waitForTransactionReceipt: (args) => arcClient.waitForTransactionReceipt(args),
  getTransaction: (args) => arcClient.getTransaction(args),
  call: (args) => arcClient.call(args),
}

const REVERTED = 'The transaction failed on chain. Nothing changed, but the network fee was spent.'
const REASON_TIMEOUT_MS = 10_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms)
  })
  return Promise.race([promise, timedOut]).finally(() => clearTimeout(timer))
}

// Replays the mined transaction at its block to read the custom error. Falls back to plain text.
async function revertReason(client: ReceiptClient, receipt: TransactionReceipt): Promise<string> {
  try {
    const replay = async () => {
      const tx = await client.getTransaction({ hash: receipt.transactionHash })
      await client.call({ account: tx.from, to: tx.to, data: tx.input, blockNumber: receipt.blockNumber })
    }
    await withTimeout(replay(), REASON_TIMEOUT_MS)
    return REVERTED
  } catch (err) {
    // Only a custom error from our contracts says why. A failed replay (a slow RPC, say) adds nothing.
    const text = revertText(err)
    return text ? `${REVERTED} ${text}` : REVERTED
  }
}

// Waits for the receipt, but never longer than timeoutMs. A dropped transaction becomes 'timeout', never success.
export async function waitForResult(client: ReceiptClient, hash: Hex, timeoutMs: number): Promise<TxResult> {
  let receipt: TransactionReceipt | 'timeout'
  try {
    receipt = await withTimeout(client.waitForTransactionReceipt({ hash, timeout: timeoutMs }), timeoutMs)
  } catch (err) {
    if (err instanceof WaitForTransactionReceiptTimeoutError) return { status: 'timeout', hash, completed: 0 }
    // Any other RPC error during the wait leaves the outcome unknown: the transaction may still be mined.
    // Reporting it as failed could make the person send it twice, so it is a timeout and they check the explorer.
    return { status: 'timeout', hash, completed: 0 }
  }
  if (receipt === 'timeout') return { status: 'timeout', hash, completed: 0 }
  if (receipt.status === 'success') return { status: 'success', hash, receipt }
  return { status: 'reverted', hash, error: await revertReason(client, receipt), completed: 0 }
}

// A gas estimate may run against the latest block, but the transaction lands in a later one. Campaign._activity()
// skips two storage writes when the campaign's last activity is in the current block, so right after a
// donation, withdrawal or settle() the estimate comes out about 3,200 gas short and the write would run out
// of gas. 25% on top covers that gap with room to spare. Used for email and wallet transactions.
export function withGasMargin(estimate: bigint): bigint {
  return (estimate * 125n) / 100n
}

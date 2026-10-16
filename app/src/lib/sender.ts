import { type Config, getChainId, sendTransaction, switchChain } from '@wagmi/core'
import { type Address, type Hex, type TransactionReceipt, WaitForTransactionReceiptTimeoutError } from 'viem'
import { ARC_CHAIN_ID, TX_TIMEOUT_MS } from '../config'
import { arcClient } from './clients'
import { explainError, isUserRejection } from './errors'

// No value field: Arc amounts always move through the ERC-20 interface, never msg.value.
export type Call = { to: Address; data: Hex }

// completed counts the calls in this send() that were mined successfully before it stopped.
export type TxResult =
  | { status: 'success'; hash: Hex; receipt: TransactionReceipt }
  | { status: 'reverted'; hash: Hex; error: string; completed: number }
  | { status: 'timeout'; hash: Hex; completed: number }
  | { status: 'rejected'; completed: number }

// The single write path. Every action builds Calls and hands them to a Sender.
// send() resolves to a TxResult. It throws only for a failure before anything is sent (for example a
// gas estimate that reverts), so callers pass that to explainError.
export interface Sender {
  kind: 'eoa' | 'passkey'
  address: Address
  send(calls: Call[], opts?: { label: string }): Promise<TxResult>
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
const GENERIC_PREFIX = 'Something went wrong.'
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
    const text = explainError(err)
    return text.startsWith(GENERIC_PREFIX) ? REVERTED : `${REVERTED} ${text}`
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

export function wagmiSender(config: Config, address: Address): Sender {
  return {
    kind: 'eoa',
    address,
    async send(calls) {
      if (calls.length === 0) throw new Error('No calls to send')
      if (getChainId(config) !== ARC_CHAIN_ID) {
        try {
          await switchChain(config, { chainId: ARC_CHAIN_ID })
        } catch (err) {
          if (isUserRejection(err)) return { status: 'rejected', completed: 0 }
          throw err
        }
      }
      let last: TxResult | null = null
      for (const [completed, call] of calls.entries()) {
        let hash: Hex
        try {
          // chainId makes wagmi refuse to send if the wallet is not on Arc.
          hash = await sendTransaction(config, { account: address, chainId: ARC_CHAIN_ID, to: call.to, data: call.data })
        } catch (err) {
          if (isUserRejection(err)) return { status: 'rejected', completed }
          throw err
        }
        last = await waitForResult(arcReceipts, hash, TX_TIMEOUT_MS)
        if (last.status !== 'success') return { ...last, completed }
      }
      // calls is not empty, so the loop ran and every call succeeded.
      return last!
    },
  }
}

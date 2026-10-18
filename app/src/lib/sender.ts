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
  // hashKind 'userop' means hash is a passkey user operation hash, not a transaction hash: the explorer and
  // waitForResult cannot find it, so only sender.recheck can. Absent means a transaction hash.
  | { status: 'timeout'; hash: Hex; completed: number; hashKind?: 'tx' | 'userop' }
  | { status: 'rejected'; completed: number }

// onHash runs as soon as a hash for calls[index] is known, before its receipt, so a caller can save it and a
// reload during the wait still knows it went out. A passkey sender reports its one user operation hash for the
// last call.
// usdcOut is the USDC these calls move out of the sender. A passkey sender keeps the network fee on top of it.
export type SendOptions = { label: string; onHash?: (hash: Hex, index: number) => void; usdcOut?: bigint }

// The single write path. Every action builds Calls and hands them to a Sender.
// send() resolves to a TxResult. It throws only for a failure before anything is sent (for example a
// gas estimate that reverts), so callers pass that to explainError.
export interface Sender {
  kind: 'eoa' | 'passkey'
  address: Address
  send(calls: Call[], opts?: SendOptions): Promise<TxResult>
  // Checks a timed-out result again without sending anything or asking for a signature. Senders whose
  // timeouts carry a transaction hash leave it out, and callers use waitForResult.
  recheck?(hash: Hex): Promise<TxResult>
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

export const REVERTED = 'The transaction failed on chain. Nothing changed, but the network fee was spent.'
const GENERIC_PREFIX = 'Something went wrong.'
const REASON_TIMEOUT_MS = 10_000

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
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

// A gas estimate may run against the latest block, but the transaction lands in a later one. Campaign._activity()
// skips two storage writes when the campaign's last activity is in the current block, so right after a
// donation, withdrawal or settle() the estimate comes out about 3,200 gas short and the write would run out
// of gas. 25% on top covers that gap with room to spare. Used for wallet transactions and passkey call gas.
export function withGasMargin(estimate: bigint): bigint {
  return (estimate * 125n) / 100n
}

export function wagmiSender(config: Config, address: Address): Sender {
  return {
    kind: 'eoa',
    address,
    async send(calls, opts) {
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
        // A revert here throws before anything is sent, like a wallet's own estimate would.
        const gas = withGasMargin(await arcClient.estimateGas({ account: address, to: call.to, data: call.data }))
        let hash: Hex
        try {
          // chainId makes wagmi refuse to send if the wallet is not on Arc.
          hash = await sendTransaction(config, { account: address, chainId: ARC_CHAIN_ID, to: call.to, data: call.data, gas })
        } catch (err) {
          if (isUserRejection(err)) return { status: 'rejected', completed }
          throw err
        }
        opts?.onHash?.(hash, completed)
        last = await waitForResult(arcReceipts, hash, TX_TIMEOUT_MS)
        if (last.status !== 'success') return { ...last, completed }
      }
      // calls is not empty, so the loop ran and every call succeeded.
      return last!
    },
  }
}

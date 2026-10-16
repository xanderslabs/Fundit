import { type Config, getChainId, sendTransaction, switchChain, waitForTransactionReceipt } from '@wagmi/core'
import type { Address, Hex, TransactionReceipt } from 'viem'
import { ARC_CHAIN_ID, TX_TIMEOUT_MS } from '../config'
import { isUserRejection } from './errors'

// No value field: Arc amounts always move through the ERC-20 interface, never msg.value.
export type Call = { to: Address; data: Hex }

export type TxResult =
  | { status: 'success'; hash: Hex; receipt: TransactionReceipt }
  | { status: 'reverted'; hash: Hex; error: string }
  | { status: 'timeout'; hash: Hex }
  | { status: 'rejected' }

// The single write path. Every action builds Calls and hands them to a Sender.
// send() resolves to a TxResult. It throws only for a failure before anything is sent (for example a
// gas estimate that reverts), so callers pass that to explainError.
export interface Sender {
  kind: 'eoa' | 'passkey'
  address: Address
  send(calls: Call[], opts?: { label: string }): Promise<TxResult>
}

export type ReceiptClient = {
  waitForTransactionReceipt(args: { hash: Hex; timeout?: number }): Promise<TransactionReceipt>
}

const REVERTED = 'The transaction failed on chain. Nothing changed, but the network fee was spent.'

// Waits for the receipt, but never longer than timeoutMs. A dropped transaction becomes 'timeout', never success.
export async function waitForResult(client: ReceiptClient, hash: Hex, timeoutMs: number): Promise<TxResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
  })
  try {
    const receipt = await Promise.race([client.waitForTransactionReceipt({ hash, timeout: timeoutMs }), timedOut])
    if (receipt === 'timeout') return { status: 'timeout', hash }
    if (receipt.status === 'success') return { status: 'success', hash, receipt }
    return { status: 'reverted', hash, error: REVERTED }
  } catch {
    // The wait's own timeout, or the RPC failing. Either way the outcome is unknown, so the person checks the explorer.
    return { status: 'timeout', hash }
  } finally {
    clearTimeout(timer)
  }
}

export function wagmiSender(config: Config, address: Address): Sender {
  const receipts: ReceiptClient = {
    waitForTransactionReceipt: (args) => waitForTransactionReceipt(config, { ...args, chainId: ARC_CHAIN_ID }),
  }
  return {
    kind: 'eoa',
    address,
    async send(calls) {
      if (getChainId(config) !== ARC_CHAIN_ID) {
        try {
          await switchChain(config, { chainId: ARC_CHAIN_ID })
        } catch (err) {
          if (isUserRejection(err)) return { status: 'rejected' }
          throw err
        }
      }
      let last: TxResult = { status: 'rejected' }
      for (const call of calls) {
        let hash: Hex
        try {
          // chainId makes wagmi refuse to send if the wallet is not on Arc.
          hash = await sendTransaction(config, { account: address, chainId: ARC_CHAIN_ID, to: call.to, data: call.data })
        } catch (err) {
          if (isUserRejection(err)) return { status: 'rejected' }
          throw err
        }
        last = await waitForResult(receipts, hash, TX_TIMEOUT_MS)
        if (last.status !== 'success') return last
      }
      return last
    },
  }
}

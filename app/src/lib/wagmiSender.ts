import { type Config, getChainId, sendTransaction, switchChain } from '@wagmi/core'
import type { Address, Hex } from 'viem'
import { ARC_CHAIN_ID, TX_TIMEOUT_MS } from '../config'
import { arcClient } from './clients'
import { isUserRejection } from './errors'
import { arcReceipts, type Sender, type TxResult, waitForResult, withGasMargin } from './sender'

// The sender for a wallet connected in Add money. It lives apart from sender.ts so the passkey path, which
// imports sender.ts at start, never loads wagmi.
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

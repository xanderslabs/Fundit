import { type Config, getAccount, getChainId, sendTransaction, switchChain } from '@wagmi/core'
import type { Address, Hex } from 'viem'
import { ARC_CHAIN_ID, TX_TIMEOUT_MS } from '../config'
import { toBatch } from './batch'
import { arcClient } from './clients'
import { isUserRejection, WrongWalletAccount } from './errors'
import { arcReceipts, type Sender, waitForResult, withGasMargin } from './sender'

// The sender for a connected wallet. It lives apart from sender.ts so the app start, which imports sender.ts,
// never loads wagmi. Several calls go out as one transaction through Multicall3From.
export function wagmiSender(config: Config, address: Address): Sender {
  return {
    kind: 'wallet',
    address,
    async send(calls, opts) {
      if (calls.length === 0) throw new Error('No calls to send')
      // The person may have switched accounts inside the wallet since signing in. Never send from another one.
      if (getAccount(config).address?.toLowerCase() !== address.toLowerCase()) throw new WrongWalletAccount(address)
      if (getChainId(config) !== ARC_CHAIN_ID) {
        try {
          await switchChain(config, { chainId: ARC_CHAIN_ID })
        } catch (err) {
          if (isUserRejection(err)) return { status: 'rejected', completed: 0 }
          throw err
        }
      }
      const call = toBatch(calls)
      // A revert here throws before anything is sent, like a wallet's own estimate would.
      const gas = withGasMargin(await arcClient.estimateGas({ account: address, to: call.to, data: call.data }))
      let hash: Hex
      try {
        // chainId makes wagmi refuse to send if the wallet is not on Arc.
        hash = await sendTransaction(config, { account: address, chainId: ARC_CHAIN_ID, to: call.to, data: call.data, gas })
      } catch (err) {
        if (isUserRejection(err)) return { status: 'rejected', completed: 0 }
        throw err
      }
      opts?.onHash?.(hash, calls.length - 1)
      const result = await waitForResult(arcReceipts, hash, TX_TIMEOUT_MS)
      // One transaction: every call ran or none did.
      return result.status === 'success' ? result : { ...result, completed: 0 }
    },
  }
}

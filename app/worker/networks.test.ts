// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { MULTICALL3_FROM, NETWORKS } from '../src/config'
import { NETWORKS_WORKER } from './networks'

// The Worker cannot import src/config.ts (it reads Vite's env), so it keeps its own copy of the addresses that
// decide what Circle may sign. A drift here would let the Worker allow a contract the app no longer uses, or
// refuse the one it does.
describe('NETWORKS_WORKER', () => {
  it("matches the app's network table", () => {
    for (const name of ['testnet', 'mainnet'] as const) {
      const w = NETWORKS_WORKER[name]
      const app = NETWORKS[name]
      expect(w.chainId).toBe(app.chain.id)
      expect(w.rpcUrl).toBe(app.rpcUrl)
      expect(w.explorerUrl).toBe(app.explorerUrl)
      expect(w.usdc).toBe(app.usdc)
      expect(w.eurc).toBe(app.eurc)
      expect(w.tokenMessengerV2).toBe(app.tokenMessengerV2)
      expect(w.multicall3From).toBe(MULTICALL3_FROM)
    }
    // Circle's sign/transaction refuses ARC-TESTNET and ARC wallets (code 156027).
    expect(NETWORKS_WORKER.testnet.walletType).toBe('EVM-TESTNET')
    expect(NETWORKS_WORKER.mainnet.walletType).toBe('EVM')
  })
})

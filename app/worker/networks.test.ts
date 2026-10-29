// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MULTICALL3_FROM, NETWORKS } from '../src/config'
import { NETWORKS_WORKER, rpcUrlFor } from './networks'

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

afterEach(() => vi.restoreAllMocks())

// A provider URL replaces the public RPC that rate-limits Cloudflare. A typo must not send reads to a plain-http
// or broken address, so anything but an https URL falls back to the public RPC.
describe('rpcUrlFor', () => {
  it('uses the provider URL when it is https', () => {
    expect(rpcUrlFor('mainnet', 'https://lb.example.org/arc/KEY')).toBe('https://lb.example.org/arc/KEY')
  })

  it('falls back to the public RPC when unset, not https, or not a URL', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    for (const bad of [undefined, '', 'http://lb.example.org/arc/KEY', 'not a url']) {
      expect(rpcUrlFor('mainnet', bad)).toBe(NETWORKS_WORKER.mainnet.rpcUrl)
      expect(rpcUrlFor('testnet', bad)).toBe(NETWORKS_WORKER.testnet.rpcUrl)
    }
  })

  // The URL can carry an API key, and Worker logs are readable from the dashboard.
  it('never logs the URL it rejects', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    rpcUrlFor('mainnet', 'http://lb.example.org/arc/SECRETKEY')
    expect(log.mock.calls.flat().join(' ')).not.toContain('SECRETKEY')
  })
})

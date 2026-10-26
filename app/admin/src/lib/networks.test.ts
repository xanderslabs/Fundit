import { describe, expect, it } from 'vitest'
import { ADMIN_NETWORKS } from './networks'

describe('ADMIN_NETWORKS', () => {
  it('has both factories from KNOWN_FACTORIES and the right chain IDs', () => {
    const { mainnet, testnet } = ADMIN_NETWORKS
    expect(mainnet.chainId).toBe(5042)
    expect(mainnet.chain.id).toBe(5042)
    expect(mainnet.factory).toBe('0xf1b2AEF82c37fC41D254D8e06BD7780ce34617d9')
    expect(mainnet.label).toBe('Arc Mainnet')
    expect(testnet.chainId).toBe(5042002)
    expect(testnet.chain.id).toBe(5042002)
    expect(testnet.factory).toBe('0x6890D40a9A472D0d05aDb5938D85B07059ad54ab')
    expect(testnet.label).toBe('Arc Testnet')
    // Each network has its own EURC; reading one with the other's address would show nothing.
    expect(mainnet.eurc.toLowerCase()).not.toBe(testnet.eurc.toLowerCase())
  })

  // The admin build serves both networks at once, so a value that only describes the build's network would
  // silently point one of them at the wrong chain or factory.
  it('admin code never imports single-network config', () => {
    const sources = import.meta.glob(['../**/*.ts', '../**/*.tsx', '!../**/*.test.ts', '!../**/*.test.tsx'], {
      query: '?raw',
      import: 'default',
      eager: true,
    })
    const banned = new Set(['ARC_CHAIN', 'ARC_CHAIN_ID', 'ARC_RPC_URL', 'FACTORY_ADDRESS', 'FACTORY_DEPLOY_BLOCK', 'TEST_CREATORS', 'TOKENS', 'NETWORK', 'EXPLORER_URL'])
    expect(Object.keys(sources).length).toBeGreaterThan(10)
    const found: string[] = []
    for (const [file, src] of Object.entries(sources)) {
      for (const m of (src as string).matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]*)['"]/g)) {
        if (!/(^|\/)src\/config$/.test(m[2]!)) continue
        for (const raw of m[1]!.split(',')) {
          const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]!
          if (banned.has(name)) found.push(`${file}: ${name}`)
        }
      }
    }
    expect(found).toEqual([])
  })
})

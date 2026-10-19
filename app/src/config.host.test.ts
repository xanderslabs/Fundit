// @vitest-environment-options {"url": "https://fundit.fun/"}
import { afterEach, describe, expect, it, vi } from 'vitest'

// fundit.fun runs on Arc testnet until the switch to mainnet, which changes environment variables only. The build
// guard in deployConfig.ts (VITE_ALLOW_TESTNET_BUILD=1) is the one check, so the page must load there.
describe('config on fundit.fun', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('loads a testnet build on fundit.fun', async () => {
    expect(window.location.hostname).toBe('fundit.fun')
    vi.stubEnv('VITE_ARC_NETWORK', 'testnet')
    vi.resetModules()
    const { NETWORK } = await import('./config')
    expect(NETWORK.name).toBe('testnet')
  })
})

// VITE_BETA reaches the tag through the real env, not a mocked constant: the owner turns Beta on and off on mainnet
// with this one value.
describe('NETWORK_TAG from the build env', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function tagWith(env: Record<string, string>) {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
    vi.resetModules()
    return (await import('./config')).NETWORK_TAG
  }

  it('reads Testnet on testnet', async () => {
    expect(await tagWith({ VITE_ARC_NETWORK: 'testnet', VITE_BETA: '' })).toBe('Testnet')
  })

  it('reads Beta on mainnet with VITE_BETA=1', async () => {
    expect(await tagWith({ VITE_ARC_NETWORK: 'mainnet', VITE_BETA: '1' })).toBe('Beta')
  })

  it('is empty on mainnet with VITE_BETA empty', async () => {
    expect(await tagWith({ VITE_ARC_NETWORK: 'mainnet', VITE_BETA: '' })).toBeNull()
  })
})

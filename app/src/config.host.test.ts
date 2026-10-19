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

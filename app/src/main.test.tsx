import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// Every page load used to create AppKit and reconnect a wallet from an earlier visit, so Reown showed its
// Switch Network modal on any page. The wallet code now loads only inside Add money. Each factory below runs
// only when something imports that module, so a count of zero after the page renders means none of it loaded.
const loads = vi.hoisted(() => ({ wagmi: 0, wagmiCore: 0, walletConnect: 0, walletSetup: 0 }))
vi.mock('wagmi', () => {
  loads.wagmi++
  return {}
})
vi.mock('@wagmi/core', () => {
  loads.wagmiCore++
  return {}
})
vi.mock('wagmi/connectors/walletConnect', () => {
  loads.walletConnect++
  return {}
})
vi.mock('./wagmi', () => {
  loads.walletSetup++
  return {}
})
// Reads never answer, so the page stays on its loading states and makes no network calls.
vi.mock('./lib/clients', () => {
  const pending = new Proxy({}, { get: () => () => new Promise(() => {}) })
  return { arcClient: pending, mainnetClient: pending, baseClient: pending, arcRpcUrls: () => [], arcTransport: () => undefined }
})

describe('app start', () => {
  it('loads no wagmi or WalletConnect code, so no wallet reconnects', async () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.append(root)
    await import('./main')
    expect(await screen.findByRole('heading', { level: 1, name: 'Fundraising for everyone, everywhere.' })).toBeTruthy()
    expect(loads).toEqual({ wagmi: 0, wagmiCore: 0, walletConnect: 0, walletSetup: 0 })
  })
})

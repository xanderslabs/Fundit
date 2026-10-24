import { describe, expect, it, vi } from 'vitest'

const core = vi.hoisted(() => ({ disconnect: vi.fn() }))
vi.mock('@wagmi/core', async (importOriginal) => ({ ...(await importOriginal<typeof import('@wagmi/core')>()), disconnect: core.disconnect }))
// The real connector loads WalletConnect's provider. Only its options matter here.
const wc = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }))
vi.mock('wagmi/connectors/walletConnect', async () => {
  const { injected } = await import('@wagmi/core')
  return {
    walletConnect: (o: Record<string, unknown>) => {
      wc.options.push(o)
      return injected({ target: { id: 'walletConnect', name: 'WalletConnect', provider: () => undefined } })
    },
  }
})

describe('wagmiConfig', () => {
  // ConnectWallet draws the QR code itself, from the display_uri message. A modal from WalletConnect would show
  // a second, unstyled QR code over it.
  it('has the browser wallet and WalletConnect without its own modal', async () => {
    const { wagmiConfig } = await import('./wagmi')
    expect(wagmiConfig.connectors.map((c) => c.id)).toEqual(expect.arrayContaining(['injected', 'walletConnect']))
    expect(wc.options[0]).toMatchObject({ showQrModal: false })
  })

  it('has Arc first, so a new connection starts there', async () => {
    const { wagmiConfig } = await import('./wagmi')
    const { ARC_CHAIN_ID } = await import('./config')
    expect(wagmiConfig.chains[0]?.id).toBe(ARC_CHAIN_ID)
  })
})

describe('disconnectWallet', () => {
  // Sign out goes ahead whatever the wallet does.
  it('never throws, even when the disconnect fails', async () => {
    core.disconnect.mockRejectedValueOnce(new Error('no wallet'))
    const { disconnectWallet } = await import('./wagmi')
    await expect(disconnectWallet()).resolves.toBeUndefined()
    expect(core.disconnect).toHaveBeenCalledTimes(1)
  })
})

import { describe, expect, it, vi } from 'vitest'

// Plain functions, not vi.fn: wagmi.ts calls createAppKit once, when the first test imports it.
const appkit = vi.hoisted(() => {
  const order: string[] = []
  const options: Record<string, unknown>[] = []
  const instance = {
    ready: async () => {
      order.push('ready')
    },
  }
  return { order, options, instance }
})
vi.mock('@reown/appkit/react', () => ({
  createAppKit: (o: Record<string, unknown>) => {
    appkit.options.push(o)
    return appkit.instance
  },
}))
vi.mock('@reown/appkit-adapter-wagmi', () => ({
  WagmiAdapter: class {
    wagmiConfig = { fake: 'config' }
  },
}))
const core = vi.hoisted(() => ({ disconnect: vi.fn() }))
vi.mock('@wagmi/core', () => core)

describe('createAppKit options', () => {
  // Coinbase Smart Wallet and Base Account are smart contract wallets. A wallet connects only to add money on
  // Arc, and these connectors stay off until one is checked there.
  it('turns off the Coinbase and Base Account connectors', async () => {
    await import('./wagmi')
    expect(appkit.options).toHaveLength(1)
    expect(appkit.options[0]).toMatchObject({ enableCoinbase: false, enableBaseAccount: false })
  })

  // A wallet on a chain outside the network list must not get Reown's Switch Network modal. The deposit
  // switches the wallet to Arc itself before it sends (lib/wagmiSender.ts).
  it('allows a wallet on an unsupported chain without the Switch Network modal', async () => {
    await import('./wagmi')
    expect(appkit.options[0]).toMatchObject({ allowUnsupportedChain: true })
  })
})

describe('disconnectWallet', () => {
  // Sign out must drop a wallet remembered from an earlier visit. AppKit reconnects it while it starts, so the
  // disconnect waits for that, or the wallet would come back after it.
  it('waits for AppKit to finish reconnecting, then disconnects through wagmi', async () => {
    core.disconnect.mockImplementation(async () => {
      appkit.order.push('disconnect')
    })
    const { disconnectWallet } = await import('./wagmi')
    await disconnectWallet()
    expect(appkit.order).toEqual(['ready', 'disconnect'])
    expect(core.disconnect).toHaveBeenCalledWith({ fake: 'config' })
  })
})

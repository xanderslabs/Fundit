import { describe, expect, it, vi } from 'vitest'

const appkit = vi.hoisted(() => ({ createAppKit: vi.fn() }))
vi.mock('@reown/appkit/react', () => appkit)
vi.mock('@reown/appkit-adapter-wagmi', () => ({
  WagmiAdapter: class {
    wagmiConfig = {}
  },
}))

describe('createAppKit options', () => {
  // Coinbase Smart Wallet and Base Account are smart contract wallets, and Arc Memo reverts for a caller with
  // code. The donate panel falls back to a direct call for such an address, but these connectors stay off.
  it('turns off the Coinbase and Base Account connectors', async () => {
    await import('./wagmi')
    expect(appkit.createAppKit).toHaveBeenCalledTimes(1)
    expect(appkit.createAppKit.mock.calls[0]![0]).toMatchObject({ enableCoinbase: false, enableBaseAccount: false })
  })
})

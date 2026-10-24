import { afterEach, describe, expect, it, vi } from 'vitest'
import { disconnectWallet } from './walletSession'

// Loading ../wagmi loads the wallet code. Sign out must not do that for a person who never connected a wallet here.
const wallet = vi.hoisted(() => ({ loads: 0, disconnect: vi.fn(async () => {}) }))
vi.mock('../wagmi', () => {
  wallet.loads++
  return { disconnectWallet: wallet.disconnect }
})

afterEach(() => localStorage.clear())

describe('disconnectWallet', () => {
  it('loads no wallet code when this browser never connected a wallet', async () => {
    disconnectWallet()
    await new Promise((r) => setTimeout(r, 0))
    expect(wallet.loads).toBe(0)
    expect(wallet.disconnect).not.toHaveBeenCalled()
  })

  // A wallet connected on an earlier visit would stay connected for the next person on this browser.
  it('disconnects a wallet this browser remembers', async () => {
    localStorage.setItem('wagmi.recentConnectorId', '"io.metamask"')
    disconnectWallet()
    await vi.waitFor(() => expect(wallet.disconnect).toHaveBeenCalledTimes(1))
  })

  // wagmi never clears its recent connector, so without this every later sign-out would load the wallet code again.
  it('forgets the wallet once it is disconnected, so the next sign-out loads nothing', async () => {
    localStorage.setItem('wagmi.recentConnectorId', '"io.metamask"')
    localStorage.setItem('wagmi.store', '{}')
    disconnectWallet()
    await vi.waitFor(() => expect(localStorage.getItem('wagmi.recentConnectorId')).toBeNull())
    expect(localStorage.getItem('wagmi.store')).toBeNull()
  })
})

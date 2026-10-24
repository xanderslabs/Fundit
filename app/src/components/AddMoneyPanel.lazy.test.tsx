import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import type { Address } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddMoneyPanel } from './AddMoneyPanel'

// A fresh module registry per test file: the wallet setup below has not loaded before this test runs.
// Reconnecting a wallet from an earlier visit must wait until the person opens a wallet tab.
const loads = vi.hoisted(() => ({ walletSetup: 0 }))
vi.mock('../wagmi', () => {
  loads.walletSetup++
  return { wagmiConfig: { fake: 'config' } }
})
const provider = vi.hoisted(() => ({ values: [] as unknown[] }))
vi.mock('wagmi', () => ({
  WagmiContext: {
    Provider: ({ children, value }: { children: ReactNode; value: unknown }) => {
      provider.values.push(value)
      return children
    },
  },
  useConfig: () => ({}),
  useConnection: () => ({ isConnected: false }),
  useDisconnect: () => ({ mutate: vi.fn() }),
}))
const reconnect = vi.hoisted(() => vi.fn(async () => []))
vi.mock('@wagmi/core', async (importOriginal) => ({ ...(await importOriginal<typeof import('@wagmi/core')>()), reconnect }))
vi.mock('../config', async (importOriginal) => ({ ...(await importOriginal<typeof import('../config')>()), REOWN_PROJECT_ID: 'test-project' }))

const ACCOUNT = '0x00000000000000000000000000000000000000cc' as Address

afterEach(cleanup)

describe('AddMoneyPanel wallet loading', () => {
  it('loads the wallet setup and reconnects a remembered wallet only when From a wallet opens, and gives the tab its config', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AddMoneyPanel account={ACCOUNT} />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('tabpanel', { name: 'Your address' })).toBeTruthy()
    expect(loads.walletSetup).toBe(0)
    expect(provider.values).toEqual([])
    expect(reconnect).not.toHaveBeenCalled()

    await userEvent.setup().click(screen.getByRole('tab', { name: 'From a wallet' }))
    expect(await screen.findByRole('button', { name: 'Connect a wallet' }, { timeout: 5000 })).toBeTruthy()
    expect(loads.walletSetup).toBe(1)
    // Only the context: WagmiProvider's own hydrate step wiped the connection on re-render (WalletTabs.rerender.test.tsx).
    expect(provider.values.at(-1)).toEqual({ fake: 'config' })

    // AppKit used to bring back a wallet from an earlier visit. Now the tab asks wagmi once, the first time it opens.
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: 'Your address' }))
    await user.click(screen.getByRole('tab', { name: 'From a wallet' }))
    expect(reconnect).toHaveBeenCalledTimes(1)
    expect(reconnect).toHaveBeenCalledWith({ fake: 'config' })
  })
})

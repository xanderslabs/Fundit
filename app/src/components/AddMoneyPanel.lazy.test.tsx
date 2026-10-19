import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import type { Address } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddMoneyPanel } from './AddMoneyPanel'

// A fresh module registry per test file: the wallet setup below has not loaded before this test runs.
// Creating AppKit reconnects a wallet from an earlier visit, so it must wait until the person opens a wallet tab.
const loads = vi.hoisted(() => ({ walletSetup: 0 }))
vi.mock('../wagmi', () => {
  loads.walletSetup++
  return { wagmiConfig: { fake: 'config' } }
})
const provider = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }))
vi.mock('wagmi', () => ({
  WagmiProvider: ({ children, ...props }: { children: ReactNode }) => {
    provider.props.push(props)
    return children
  },
  useConfig: () => ({}),
  useConnection: () => ({ isConnected: false }),
  useDisconnect: () => ({ mutate: vi.fn() }),
}))
vi.mock('@reown/appkit/react', () => ({ useAppKit: () => ({ open: vi.fn() }) }))
vi.mock('../config', async (importOriginal) => ({ ...(await importOriginal<typeof import('../config')>()), REOWN_PROJECT_ID: 'test-project' }))

const ACCOUNT = '0x00000000000000000000000000000000000000cc' as Address

afterEach(cleanup)

describe('AddMoneyPanel wallet loading', () => {
  it('loads the wallet setup only when From a wallet opens, under a provider that does not reconnect on mount', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AddMoneyPanel account={ACCOUNT} />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('tabpanel', { name: 'Your address' })).toBeTruthy()
    expect(loads.walletSetup).toBe(0)
    expect(provider.props).toEqual([])

    await userEvent.setup().click(screen.getByRole('tab', { name: 'From a wallet' }))
    expect(await screen.findByRole('button', { name: 'Connect a wallet' }, { timeout: 5000 })).toBeTruthy()
    expect(loads.walletSetup).toBe(1)
    // A wallet from an earlier visit reconnects when AppKit starts here, never on page load.
    expect(provider.props.at(-1)).toEqual({ config: { fake: 'config' }, reconnectOnMount: false })
  })
})

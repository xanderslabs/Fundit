import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FundWallet } from './FundWallet'

const PASSKEY = '0x00000000000000000000000000000000000000cc'

const flags = vi.hoisted(() => ({ crosschain: false }))
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  get CROSSCHAIN_ENABLED() {
    return flags.crosschain
  },
}))
vi.mock('../lib/passkey', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/passkey')>()),
  usePasskeySession: () => ({ address: PASSKEY, credentialId: 'cred-1' }),
}))
vi.mock('../lib/clients', () => ({ arcClient: { readContract: async () => 0n } }))
vi.mock('wagmi', () => ({ useConnection: () => ({ isConnected: false }) }))
vi.mock('@reown/appkit/react', () => ({ useAppKit: () => ({ open: () => {} }) }))

afterEach(() => {
  cleanup()
  localStorage.clear()
  flags.crosschain = false
})

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <FundWallet />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('FundWallet with cross-chain transfers', () => {
  it('off: offers only the Arc address, no bridge from another chain', () => {
    renderPage()
    expect(screen.getByText(PASSKEY)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Bridge USDC from another chain' })).toBeNull()
  })

  // A bridge started before the flag went off may still arrive. Its row stays in view.
  it('off: still tracks a transfer already on its way to the passkey wallet', () => {
    localStorage.setItem(
      'fundit.pendingBridges',
      JSON.stringify([{ kind: 'submitted', id: 's-1', campaign: PASSKEY, srcDomain: 6, amount: '25', createdAt: Date.now() }]),
    )
    renderPage()
    expect(screen.getByText(/25 USDC from Base: Submitted/)).toBeTruthy()
  })

  it('on: offers the bridge from another chain', () => {
    flags.crosschain = true
    renderPage()
    expect(screen.getByRole('heading', { name: 'Bridge USDC from another chain' })).toBeTruthy()
  })
})

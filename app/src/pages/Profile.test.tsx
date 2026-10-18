import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Sender } from '../lib/sender'
import { Profile } from './Profile'

const state: { sender: Sender | null } = { sender: null }
vi.mock('../hooks/useSender', () => ({ useSender: () => state.sender }))
vi.mock('@reown/appkit/react', () => ({ useAppKit: () => ({ open: () => {} }) }))
// The lists load from Arc; lib/activity.test.ts and lib/campaigns.test.ts cover the reads.
vi.mock('../lib/clients', () => ({ arcClient: {} }))
vi.mock('../lib/activity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/activity')>()),
  recentDonationsBy: () => new Promise(() => {}),
}))
vi.mock('../lib/campaigns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/campaigns')>()),
  myCampaigns: () => new Promise(() => {}),
}))
vi.mock('../hooks/useName', () => ({ useName: () => ({ data: undefined }) }))

afterEach(() => {
  cleanup()
  state.sender = null
})

function renderProfile() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Profile />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Profile', () => {
  // With no wallet there is no address to look up, so the page asks to connect instead of loading forever.
  it('asks to sign in when no wallet is connected', () => {
    renderProfile()
    expect(screen.getByText('Sign in to see your fundraisers and the donations you made.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Start a fundraiser' })).toBeNull()
  })

  // My page is where a signed-in person starts a new fundraiser, so the button sits at the top.
  it('shows Start a fundraiser near the top when signed in', () => {
    state.sender = { kind: 'eoa', address: '0x1111111111111111111111111111111111111111', send: vi.fn() }
    renderProfile()
    const head = screen.getByRole('heading', { level: 1 }).closest('section')!
    const start = head.querySelector('a[href="/create"]')
    expect(start?.textContent).toBe('Start a fundraiser')
  })

  // A block count means nothing to most people. The window is about a day of Arc blocks.
  it('describes the donations window in time, not blocks', () => {
    state.sender = { kind: 'eoa', address: '0x1111111111111111111111111111111111111111', send: vi.fn() }
    renderProfile()
    expect(screen.getByText(/This list covers about the last day on Arc\./)).toBeTruthy()
    expect(screen.queryByText(/200,000 blocks/)).toBeNull()
  })
})

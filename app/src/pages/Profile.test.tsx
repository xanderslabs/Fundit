import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Profile } from './Profile'

vi.mock('../hooks/useSender', () => ({ useSender: () => null }))
vi.mock('@reown/appkit/react', () => ({ useAppKit: () => ({ open: () => {} }) }))

afterEach(cleanup)

describe('Profile', () => {
  // With no wallet there is no address to look up, so the page asks to connect instead of loading forever.
  it('asks to connect a wallet when none is connected', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Profile />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('Connect a wallet to see your campaigns')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Connect wallet' })).toBeTruthy()
  })
})

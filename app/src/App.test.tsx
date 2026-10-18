import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

// The layout and the pages are tested on their own. Here only the routing matters.
vi.mock('./components/Layout', async () => {
  const { Outlet } = await import('react-router')
  return { Layout: () => <Outlet /> }
})
vi.mock('./pages/Recover', () => ({ Recover: () => <h1>Recover your account</h1> }))

afterEach(cleanup)

function renderAt(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('App routes', () => {
  // Add money is a panel on My page now. The old page addresses are gone and must not redirect anywhere.
  it.each(['/add-money', '/fund'])('shows Page not found for the removed %s address', async (path) => {
    renderAt(path)
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Add money' })).toBeNull()
  })

  it('serves /recover with no feature flag', async () => {
    renderAt('/recover')
    expect(await screen.findByRole('heading', { name: 'Recover your account' })).toBeTruthy()
  })
})

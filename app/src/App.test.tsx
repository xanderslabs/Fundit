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
  it.each(['/add-money', '/fund'])('shows the 404 page for the removed %s address', async (path) => {
    renderAt(path)
    expect(await screen.findByRole('heading', { name: "This page doesn't exist" })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Add money' })).toBeNull()
  })

  // A wrong link gets a way back: Explore Fundits or the home page.
  it('shows the 404 page with Explore Fundits and Go home for an unknown route', async () => {
    renderAt('/no/such/page')
    expect(await screen.findByRole('heading', { level: 1, name: "This page doesn't exist" })).toBeTruthy()
    expect(screen.getByText('The link may be wrong, or the page has moved.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Explore Fundits' }).getAttribute('href')).toBe('/explore')
    expect(screen.getByRole('link', { name: 'Go home' }).getAttribute('href')).toBe('/')
  })

  // The passkey recovery page is gone with passkey accounts. Old links get the 404, with no redirect.
  it('/recover shows the 404 page', async () => {
    renderAt('/recover')
    expect(await screen.findByRole('heading', { level: 1, name: "This page doesn't exist" })).toBeTruthy()
  })
})

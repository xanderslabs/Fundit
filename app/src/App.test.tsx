import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

const flags = vi.hoisted(() => ({ passkeys: true }))
vi.mock('./config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./config')>()),
  get PASSKEYS_ENABLED() {
    return flags.passkeys
  },
}))
// The layout and the pages are tested on their own. Here only the routing matters.
vi.mock('./components/Layout', async () => {
  const { Outlet } = await import('react-router')
  return { Layout: () => <Outlet /> }
})
vi.mock('./pages/AddMoney', () => ({ AddMoney: () => <h1>Add money</h1> }))

afterEach(() => {
  cleanup()
  flags.passkeys = true
})

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
  // Old links and bookmarks to /fund must still reach the page.
  it('redirects /fund to the Add money page', async () => {
    renderAt('/fund')
    expect(await screen.findByRole('heading', { name: 'Add money' })).toBeTruthy()
  })

  it('serves /add-money with passkeys on', async () => {
    renderAt('/add-money')
    expect(await screen.findByRole('heading', { name: 'Add money' })).toBeTruthy()
  })

  // Without passkeys there is no Fundit account to add money to.
  it.each(['/fund', '/add-money'])('shows Page not found for %s with passkeys off', (path) => {
    flags.passkeys = false
    renderAt(path)
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy()
  })
})

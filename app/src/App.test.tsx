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
vi.mock('./pages/AddMoney', () => ({ AddMoney: () => <h1>Add money</h1> }))
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
  // Old links and bookmarks to /fund must still reach the page.
  it('redirects /fund to the Add money page', async () => {
    renderAt('/fund')
    expect(await screen.findByRole('heading', { name: 'Add money' })).toBeTruthy()
  })

  // Every account is a Fundit account, so these pages are always there, with no feature flag.
  it('serves /add-money with no feature flag', async () => {
    renderAt('/add-money')
    expect(await screen.findByRole('heading', { name: 'Add money' })).toBeTruthy()
  })

  it('serves /recover with no feature flag', async () => {
    renderAt('/recover')
    expect(await screen.findByRole('heading', { name: 'Recover your account' })).toBeTruthy()
  })
})

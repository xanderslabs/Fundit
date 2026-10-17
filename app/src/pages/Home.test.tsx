import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Home } from './Home'

const flags = vi.hoisted(() => ({ crosschain: false }))
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  get CROSSCHAIN_ENABLED() {
    return flags.crosschain
  },
}))
vi.mock('../hooks/useCampaigns', () => ({
  useFeatured: () => ({ data: null }),
  useCampaigns: () => ({ data: [], isPending: false, isError: false, refetch: () => {} }),
}))

afterEach(() => {
  cleanup()
  flags.crosschain = false
})

function renderHome() {
  render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  )
  return screen.getByRole('region', { name: 'Built on Arc with Circle' })
}

const products = (built: HTMLElement) => [...built.querySelectorAll('h3')].map((h) => h.textContent)

// Cross-chain donations ship behind VITE_CROSSCHAIN. The home page must not promise ways to give that the
// donate panel does not offer.
describe('Home with cross-chain donations', () => {
  it('off: no Gateway or App Kits, and no giving from another chain', () => {
    const built = renderHome()
    expect(products(built)).not.toContain('Gateway')
    expect(products(built)).not.toContain('App Kits')
    expect(built.textContent).not.toMatch(/donations and payouts/)
    expect(document.body.textContent).not.toMatch(/from another chain|unified balance/i)
  })

  it('on: lists Gateway and App Kits, and giving from another chain', () => {
    flags.crosschain = true
    const built = renderHome()
    expect(products(built)).toEqual(expect.arrayContaining(['CCTP', 'Gateway', 'App Kits']))
    expect(document.body.textContent).toMatch(/from another chain/)
  })
})

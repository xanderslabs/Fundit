import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOKENS } from '../config'
import type { CampaignView } from '../lib/campaigns'
import { CampaignPage } from './CampaignPage'

const ADDRESS = '0x00000000000000000000000000000000000000a1'

const hookState: { current: { data?: CampaignView | 'not-a-campaign'; isPending: boolean; isError: boolean } } = {
  current: { isPending: true, isError: false },
}

vi.mock('../hooks/useCampaigns', () => ({
  useCampaign: () => ({ ...hookState.current, refetch: () => {} }),
}))

// The activity walk hits the network; it has its own tests in lib/activity.test.ts.
vi.mock('../hooks/useActivity', () => ({
  useActivity: () => ({ isPending: true, isError: false, isSuccess: false, hasNextPage: false }),
}))
// The activity list reads unaccounted() on Arc; ActivityList.test.tsx covers that row.
vi.mock('../lib/clients', () => ({ arcClient: { readContract: async () => 0n } }))

// No wallet connected: the donate panel shows its connect prompt. DonatePanel.test.tsx covers donating.
vi.mock('../hooks/useSender', () => ({ useSender: () => null }))
vi.mock('@reown/appkit/react', () => ({ useAppKit: () => ({ open: () => {} }) }))
vi.mock('wagmi', () => ({ useConnection: () => ({ isConnected: false }) }))
// Names come from Ethereum mainnet; lib/names.test.ts covers the lookup.
vi.mock('../hooks/useName', () => ({ useName: () => ({ data: undefined }) }))

function view(meta: Partial<CampaignView['summary']['meta']>, closed = false): CampaignView {
  return {
    address: ADDRESS,
    symbol: 'USDC',
    summary: {
      creator: '0x1111111111111111111111111111111111111111',
      token: TOKENS.USDC.address,
      goal: 1000000000n,
      raised: 250000000n,
      available: 250000000n,
      withdrawn: 0n,
      closed,
      donationFeeBps: 0,
      withdrawFeeBps: 250,
      createdAt: 1760000000n,
      createdAtBlock: 1n,
      backup: '0x0000000000000000000000000000000000000000',
      recoveryReadyAt: 0n,
      meta: { title: 'Clean water', description: 'Wells for the village.', imageUrl: '', links: [], ...meta },
    },
  }
}

function renderPage(path = `/c/${ADDRESS}`) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/c/:address" element={<CampaignPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  hookState.current = { isPending: true, isError: false }
})

describe('CampaignPage', () => {
  // An address that the factory does not know may be a clone with a hostile creator, so it is never shown as a fundraiser.
  it("shows 'Not a Fundit campaign' for an address the factory does not know", () => {
    hookState.current = { data: 'not-a-campaign', isPending: false, isError: false }
    renderPage()
    expect(screen.getByText('Not a Fundit campaign')).toBeTruthy()
  })

  it("shows 'Not a Fundit campaign' for a URL that is not an address", () => {
    renderPage('/c/hello')
    expect(screen.getByText('Not a Fundit campaign')).toBeTruthy()
  })

  // Campaign text is written by anyone, so it must render as inert text.
  it('renders a script title as literal text', () => {
    hookState.current = { data: view({ title: '<script>alert(1)</script>' }), isPending: false, isError: false }
    const { container } = renderPage()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('<script>alert(1)</script>')
    expect(container.querySelector('script')).toBeNull()
  })

  it('renders only https links and images as live elements', () => {
    hookState.current = {
      data: view({
        imageUrl: 'javascript:alert(1)',
        links: ['javascript:alert(1)', 'http://plain.example', 'https://good.example/page'],
      }),
      isPending: false,
      isError: false,
    }
    const { container } = renderPage()
    const anchors = Array.from(container.querySelectorAll('a'))
    const hrefs = anchors.map((a) => a.getAttribute('href'))
    expect(hrefs).toContain('https://good.example/page')
    expect(hrefs.some((h) => h?.startsWith('javascript:') || h?.startsWith('http:'))).toBe(false)
    expect(container.querySelector('img')).toBeNull()
  })

  it('shows progress, raised, goal and the donate panel', () => {
    hookState.current = { data: view({}), isPending: false, isError: false }
    renderPage()
    expect(screen.getAllByText(/250\.00 USDC/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/1,000\.00 USDC/).length).toBeGreaterThan(0)
    expect(screen.getByText('25%')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Donate' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Connect wallet to donate' })).toBeTruthy()
  })

  // A closed campaign reverts every donation, so the page must not offer one.
  it('disables donating on a closed campaign', () => {
    hookState.current = { data: view({}, true), isPending: false, isError: false }
    renderPage()
    expect(screen.getByText('This fundraiser is closed.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Donate' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

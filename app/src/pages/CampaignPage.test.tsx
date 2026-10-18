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
  it("shows 'Not a Fundit' for an address the factory does not know", () => {
    hookState.current = { data: 'not-a-campaign', isPending: false, isError: false }
    renderPage()
    expect(screen.getByText('Not a Fundit')).toBeTruthy()
  })

  it("shows 'Not a Fundit' for a URL that is not an address", () => {
    renderPage('/c/hello')
    expect(screen.getByText('Not a Fundit')).toBeTruthy()
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
    // The share panel shows our own logo from /images/. No image may come from the Fundit's data.
    const imgs = Array.from(container.querySelectorAll('img')).map((i) => i.getAttribute('src'))
    expect(imgs.every((src) => src?.startsWith('/images/'))).toBe(true)
  })

  it('shows progress, raised, goal and the donate panel', () => {
    hookState.current = { data: view({}), isPending: false, isError: false }
    renderPage()
    expect(screen.getAllByText(/250\.00 USDC/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/1,000\.00 USDC/).length).toBeGreaterThan(0)
    expect(screen.getByText('25%')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Give' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in to give' })).toBeTruthy()
  })

  // Screen readers and narrow screens follow the DOM: the money facts and Give come right after the image,
  // before the story. The wide layout moves stats and Give to the right column with grid placement only.
  it('orders the page image, stats, Give, About, links, organiser, Share, Activity', () => {
    hookState.current = { data: view({ links: ['https://example.org/report'] }), isPending: false, isError: false }
    const { container } = renderPage()
    const parts = [
      container.querySelector('.campaign-hero'),
      container.querySelector('.stats'),
      screen.getByRole('region', { name: 'Give' }),
      screen.getByRole('heading', { name: 'About' }),
      screen.getByRole('heading', { name: 'Links' }),
      screen.getByText('Organiser'),
      screen.getByRole('heading', { name: 'Share this Fundit' }),
      screen.getByRole('heading', { name: 'Activity' }),
    ]
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i - 1]!.compareDocumentPosition(parts[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    // Only stats and Give sit in the sticky column.
    const side = container.querySelector('.campaign-side')!
    expect(side.contains(screen.getByRole('heading', { name: 'Share this Fundit' }))).toBe(false)
  })

  // A closed campaign reverts every donation, so the page must not offer one.
  it('disables donating on a closed campaign', () => {
    hookState.current = { data: view({}, true), isPending: false, isError: false }
    renderPage()
    expect(screen.getByText('This Fundit is closed.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Give' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { Address } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CampaignView } from '../lib/campaigns'
import { Explore } from './Explore'

vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  TEST_CREATORS: ['0x2222222222222222222222222222222222222222'],
}))
vi.mock('../hooks/useSender', () => ({ useSender: () => null }))
const page = vi.hoisted(() => ({ views: [] as unknown[], featured: null as unknown }))
vi.mock('../hooks/useCampaigns', () => ({
  PAGE_SIZE: 24n,
  campaignsQuery: (offset: bigint) => ({ queryKey: ['campaigns', offset.toString()], queryFn: async () => page.views }),
  useFeatured: () => ({ data: page.featured }),
}))

afterEach(() => {
  cleanup()
  page.views = []
  page.featured = null
})

// Fundits for the public lists. TESTER is on the test-creator list; the others are real.
const TESTER = '0x2222222222222222222222222222222222222222'
function fundit(n: number, title: string, creator: string): CampaignView {
  return {
    address: `0x${n.toString(16).padStart(40, '0')}` as Address,
    symbol: 'USDC',
    summary: {
      creator: creator as Address,
      token: '0x3600000000000000000000000000000000000000',
      goal: 10_000_000n,
      raised: 0n,
      available: 0n,
      withdrawn: 0n,
      closed: false,
      donationFeeBps: 100,
      withdrawFeeBps: 100,
      createdAt: 0n,
      createdAtBlock: 1n,
      backup: '0x0000000000000000000000000000000000000000',
      recoveryReadyAt: 0n,
      meta: { title, description: '', imageUrl: '', links: [] },
    },
  }
}

describe('Explore hides test Fundits', () => {
  it('lists real Fundits and leaves out those made by test accounts', async () => {
    page.views = [fundit(1, 'Real garden', '0x1111111111111111111111111111111111111111'), fundit(2, 'E2E testnet garden', TESTER)]
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Explore />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Real garden')).toBeTruthy()
    expect(screen.queryByText('E2E testnet garden')).toBeNull()
  })
})

// The featured Fundit leads the default order, even when it is older than the loaded pages, and is listed once.
// Other sorts keep their own order.
describe('Explore puts the featured Fundit first', () => {
  it('in the default order only', async () => {
    const owner = '0x1111111111111111111111111111111111111111'
    const featured = fundit(1, 'Help build Fundit', owner)
    const rich = fundit(3, 'Big garden', owner)
    rich.summary = { ...rich.summary, raised: 5_000_000n }
    page.views = [rich, featured]
    page.featured = featured
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Explore />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await screen.findByText('Big garden')
    const titles = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(titles()).toEqual(['Help build Fundit', 'Big garden'])
    expect(screen.getAllByText('Featured')).toHaveLength(1)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'raised' } })
    expect(titles()).toEqual(['Big garden', 'Help build Fundit'])
    expect(screen.queryByText('Featured')).toBeNull()
  })
})

// The native arrow sat half outside the box. Every dropdown uses the .select look, whose chevron stays inside.
describe('Dropdowns', () => {
  it('the Explore sort dropdown has the custom select class', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Explore />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByRole('combobox', { name: 'Sort by' }).classList.contains('select')).toBe(true)
  })

  // A guardrail for the next <select> someone adds: it must opt into the shared style too.
  it('every <select> in the app source has className="select"', () => {
    const sources = import.meta.glob(['../**/*.tsx', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true })
    const selects = Object.entries(sources).flatMap(([file, src]) =>
      [...(src as string).matchAll(/<select\b[^>]*>/g)].map((m) => ({ file, tag: m[0] })),
    )
    expect(selects.length).toBeGreaterThanOrEqual(4)
    for (const s of selects) expect(s.tag, s.file).toMatch(/className="select"/)
  })
})

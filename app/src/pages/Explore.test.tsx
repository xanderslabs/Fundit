import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Explore } from './Explore'

vi.mock('../hooks/useSender', () => ({ useSender: () => null }))
vi.mock('../hooks/useCampaigns', () => ({
  PAGE_SIZE: 24n,
  campaignsQuery: (offset: bigint) => ({ queryKey: ['campaigns', offset.toString()], queryFn: async () => [] }),
}))

afterEach(cleanup)

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

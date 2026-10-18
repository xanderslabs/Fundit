import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Layout } from './Layout'

vi.mock('@reown/appkit/react', () => ({ useAppKit: () => ({ open: () => {} }) }))
vi.mock('wagmi', () => ({ useDisconnect: () => ({ mutate: () => {} }) }))
vi.mock('../hooks/useSender', () => ({
  useWalletChoice: () => ({ both: false, active: null, external: null, setActive: () => {} }),
}))

afterEach(cleanup)

function renderLayout() {
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<p>Page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('Layout', () => {
  // The top bar is the logo and the account control only. Start a Fundit moved into the account menu.
  it('has the logo and Sign in in the top bar, and no page links', () => {
    renderLayout()
    const banner = screen.getByRole('banner')
    expect(within(banner).getByRole('link', { name: 'Fundit home' }).getAttribute('href')).toBe('/')
    expect(within(banner).getByRole('button', { name: 'Sign in' })).toBeTruthy()
    expect(within(banner).getAllByRole('link')).toHaveLength(1)
  })

  it('has Terms, Privacy and four labelled social links that open safely in a new tab', () => {
    renderLayout()
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByRole('link', { name: 'Terms' })).toBeTruthy()
    expect(within(footer).getByRole('link', { name: 'Privacy' })).toBeTruthy()
    const socials = within(within(footer).getByRole('list', { name: 'Fundit on social media' })).getAllByRole('link')
    expect(socials.map((a) => a.getAttribute('aria-label'))).toEqual([
      'Fundit on X',
      'Fundit on Telegram',
      'Fundit on Discord',
      'Fundit on Instagram',
    ])
    for (const a of socials) {
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    }
  })
})

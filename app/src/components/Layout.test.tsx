import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NetworkTagLabel } from '../config'
import { Layout } from './Layout'

const state = vi.hoisted(() => ({ tag: null as NetworkTagLabel | null }))
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  get NETWORK_TAG() {
    return state.tag
  },
}))
vi.mock('@reown/appkit/react', () => ({ useAppKit: () => ({ open: () => {} }) }))
vi.mock('../lib/walletSession', () => ({ disconnectWallet: () => {} }))

afterEach(() => {
  cleanup()
  state.tag = null
})

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

  // The icons are one-colour glyphs drawn inline in the text colour, so they follow the theme tokens and load no
  // image file or icon library.
  it('draws each social icon as an inline monochrome glyph', () => {
    renderLayout()
    const list = within(screen.getByRole('contentinfo')).getByRole('list', { name: 'Fundit on social media' })
    expect(list.querySelectorAll('img')).toHaveLength(0)
    const svgs = Array.from(list.querySelectorAll('a > svg'))
    expect(svgs).toHaveLength(4)
    for (const svg of svgs) {
      expect(svg.getAttribute('aria-hidden')).toBe('true')
      expect(svg.getAttribute('focusable')).toBe('false')
      expect(svg.getAttribute('fill')).toBe('currentColor')
      expect(svg.querySelector('path')?.getAttribute('d')).toMatch(/^M/)
      expect(svg.querySelector('[fill]:not(svg), [style]')).toBeNull()
    }
  })
})

// Test tokens look like real USDC, so a testnet site says so beside the logo on every page. The tag is part of
// the logo link's name and is never a separate link or tab stop.
describe('Layout network tag', () => {
  it('shows Testnet beside the logo on testnet', () => {
    state.tag = 'Testnet'
    renderLayout()
    const banner = screen.getByRole('banner')
    const logo = within(banner).getByRole('link', { name: 'Fundit home, testnet' })
    expect(logo.textContent).toBe('Testnet')
    expect(within(banner).getAllByRole('link')).toHaveLength(1)
    expect(banner.querySelectorAll('[tabindex]')).toHaveLength(0)
  })

  it('shows Beta beside the logo on mainnet with VITE_BETA=1', () => {
    state.tag = 'Beta'
    renderLayout()
    const logo = within(screen.getByRole('banner')).getByRole('link', { name: 'Fundit home, beta' })
    expect(logo.textContent).toBe('Beta')
  })

  it('shows no tag on mainnet without VITE_BETA', () => {
    renderLayout()
    const logo = within(screen.getByRole('banner')).getByRole('link', { name: 'Fundit home' })
    expect(logo.textContent).toBe('')
  })
})

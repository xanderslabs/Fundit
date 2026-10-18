import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SOCIAL_LINKS } from '../config'
import type { Sender } from '../lib/sender'
import { Home } from './Home'

const flags = vi.hoisted(() => ({ crosschain: false, passkeys: false }))
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  get CROSSCHAIN_ENABLED() {
    return flags.crosschain
  },
  get PASSKEYS_ENABLED() {
    return flags.passkeys
  },
}))
vi.mock('../hooks/useCampaigns', () => ({
  useFeatured: () => ({ data: null }),
  useCampaigns: () => ({ data: [], isPending: false, isError: false, refetch: () => {} }),
}))
const state: { sender: Sender | null } = { sender: null }
vi.mock('../hooks/useSender', () => ({ useSender: () => state.sender }))
const modal = vi.hoisted(() => ({ open: false, openWallet: vi.fn() }))
vi.mock('@reown/appkit/react', () => ({
  useAppKit: () => ({ open: modal.openWallet }),
  useAppKitState: () => ({ open: modal.open }),
}))

const ME: Sender = { kind: 'eoa', address: '0x1111111111111111111111111111111111111111', send: vi.fn() }

afterEach(() => {
  cleanup()
  flags.crosschain = false
  flags.passkeys = false
  state.sender = null
  modal.open = false
  modal.openWallet.mockReset()
})

const ui = () => (
  <MemoryRouter>
    <Routes>
      <Route index element={<Home />} />
      <Route path="/create" element={<p>Create page</p>} />
    </Routes>
  </MemoryRouter>
)

function renderHome() {
  return render(ui())
}

const faq = () => screen.getByRole('region', { name: 'Questions people ask' })

describe('Home hero', () => {
  const hero = () => screen.getByRole('region', { name: 'Fundraising for everyone, everywhere.' })

  it('has the centred headline, the supporting line and the two buttons', () => {
    renderHome()
    expect(hero().classList.contains('hero')).toBe(true)
    expect(within(hero()).getByText(/get gifts from anyone in the world in digital dollars/)).toBeTruthy()
    const actions = hero().querySelector('.hero-actions')!
    expect([...actions.querySelectorAll('a, button')].map((el) => el.textContent)).toEqual([
      'Donate to a Fundit',
      'Create a Fundit',
    ])
  })

  it('Donate to a Fundit goes to /explore', () => {
    renderHome()
    expect(within(hero()).getByRole('link', { name: 'Donate to a Fundit' }).getAttribute('href')).toBe('/explore')
  })

  it('signed in, Create a Fundit is a link to /create', () => {
    state.sender = ME
    renderHome()
    expect(within(hero()).getByRole('link', { name: 'Create a Fundit' }).getAttribute('href')).toBe('/create')
  })

  // Only signed-in people can create. Signed out, the button signs them in first, then carries on to /create.
  it('signed out, Create a Fundit opens sign-in and goes to /create once signed in', async () => {
    const view = renderHome()
    await userEvent.setup().click(within(hero()).getByRole('button', { name: 'Create a Fundit' }))
    expect(modal.openWallet).toHaveBeenCalledTimes(1)
    modal.open = true
    view.rerender(ui())
    state.sender = ME
    modal.open = false
    view.rerender(ui())
    expect(await screen.findByText('Create page')).toBeTruthy()
  })

  it('signed out, closing sign-in without connecting stays on Home, and a later sign-in does not jump', async () => {
    const view = renderHome()
    await userEvent.setup().click(within(hero()).getByRole('button', { name: 'Create a Fundit' }))
    modal.open = true
    view.rerender(ui())
    modal.open = false
    view.rerender(ui())
    expect(hero()).toBeTruthy()
    state.sender = ME
    view.rerender(ui())
    expect(screen.queryByText('Create page')).toBeNull()
  })

  it('shows the five causes with alt text, each linking to Explore', () => {
    renderHome()
    const causes = screen.getByRole('region', { name: 'What people raise for' })
    const imgs = within(causes).getAllByRole('img')
    expect(imgs).toHaveLength(5)
    for (const img of imgs) {
      expect((img.getAttribute('alt') ?? '').length).toBeGreaterThan(20)
      expect(img.getAttribute('src')).toMatch(/^\/images\/landing\/.+\.webp$/)
    }
    expect(imgs.map((i) => i.getAttribute('loading'))).toEqual(['eager', 'lazy', 'lazy', 'lazy', 'lazy'])
    for (const link of within(causes).getAllByRole('link')) expect(link.getAttribute('href')).toBe('/explore')
  })

  it('has no Start a fundraiser link for a signed-out visitor', () => {
    renderHome()
    expect(screen.queryByRole('link', { name: 'Start a fundraiser' })).toBeNull()
  })

  it('invites a signed-out visitor to explore when there are no fundraisers', () => {
    renderHome()
    expect(screen.getByText(/No fundraisers yet\. Sign in to start the first one/)).toBeTruthy()
  })

  it('invites a signed-in person to start one when there are no fundraisers', () => {
    state.sender = ME
    renderHome()
    expect(screen.getByRole('link', { name: 'Start a fundraiser' }).getAttribute('href')).toBe('/create')
  })

  it('has no Built on Arc with Circle section', () => {
    renderHome()
    expect(screen.queryByText(/Built on Arc/)).toBeNull()
  })

  it('shows the three steps in order', () => {
    renderHome()
    const how = screen.getByRole('region', { name: 'How it works' })
    expect(within(how).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Create',
      'Share',
      'Withdraw anywhere',
    ])
  })
})

describe('Home FAQ', () => {
  it('lists five questions as disclosures that start closed', () => {
    renderHome()
    const items = faq().querySelectorAll('details')
    expect(items).toHaveLength(5)
    for (const d of items) {
      expect(d.open).toBe(false)
      expect(d.querySelector('summary')).not.toBeNull()
    }
  })

  // The fee answer must match the contract: 1% each at launch, capped at 5%, fixed at creation.
  it('states the launch fees, the 5% cap and that rates are fixed at creation', () => {
    renderHome()
    const text = faq().textContent
    expect(text).toMatch(/1% of each donation and 1% of each withdrawal/)
    expect(text).toMatch(/5%/)
    expect(text).toMatch(/rates it had on the day it was created/)
    expect(text).toMatch(/tip for Fundit/)
  })

  // Cross-chain donations ship behind VITE_CROSSCHAIN. The page must not promise ways to give that the donate
  // panel does not offer.
  it('cross-chain off: does not mention giving from another chain', () => {
    renderHome()
    expect(document.body.textContent).not.toMatch(/from another chain|unified balance/i)
  })

  it('cross-chain on: mentions giving from another chain', () => {
    flags.crosschain = true
    renderHome()
    expect(faq().textContent).toMatch(/from another chain/)
  })

  // Passkeys ship behind VITE_PASSKEYS, so the wallet answer only mentions them when they are on.
  it('passkeys off: a wallet is required and passkeys are not mentioned', () => {
    renderHome()
    expect(faq().textContent).toMatch(/Yes\. Sign in with a wallet/)
    expect(faq().textContent).not.toMatch(/passkey/i)
  })

  it('passkeys on: mentions passkey sign-in', () => {
    flags.passkeys = true
    renderHome()
    expect(faq().textContent).toMatch(/sign in with a passkey/)
  })
})

describe('Social links config', () => {
  it('has X, Telegram, Discord and Instagram, all on https', () => {
    expect(SOCIAL_LINKS.map((s) => s.name)).toEqual(['X', 'Telegram', 'Discord', 'Instagram'])
    for (const s of SOCIAL_LINKS) expect(s.href.startsWith('https://')).toBe(true)
  })
})

// Credits for the landing photos must ship with them.
describe('Landing photo credits', () => {
  it('CREDITS.md exists and names each photo with its Unsplash page and license', () => {
    const files = import.meta.glob('../../public/images/landing/CREDITS.md', { query: '?raw', import: 'default', eager: true })
    const credits = Object.values(files)[0] as string | undefined
    expect(credits).toBeDefined()
    for (const name of ['medical', 'disaster', 'community', 'charity', 'people']) {
      expect(credits).toMatch(new RegExp(`\\| \`${name}\\.webp\` \\| https://unsplash\\.com/photos/[^ ]+ \\| [^|]+ \\| Unsplash License \\|`))
    }
  })
})

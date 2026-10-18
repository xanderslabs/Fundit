import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SOCIAL_LINKS } from '../config'
import type { Sender } from '../lib/sender'
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
const state: { sender: Sender | null } = { sender: null }
vi.mock('../hooks/useSender', () => ({ useSender: () => state.sender }))
// AppKit is mocked only to prove Home never opens it. It opens only inside Add money.
const openWallet = vi.hoisted(() => vi.fn())
vi.mock('@reown/appkit/react', () => ({ useAppKit: () => ({ open: openWallet }) }))
const loginPasskey = vi.hoisted(() => vi.fn())
vi.mock('../lib/passkey', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/passkey')>()),
  loginPasskey,
}))

const ME: Sender = { kind: 'passkey', address: '0x1111111111111111111111111111111111111111', send: vi.fn() }

afterEach(() => {
  cleanup()
  flags.crosschain = false
  state.sender = null
  openWallet.mockReset()
  loginPasskey.mockReset()
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

  // The headline and the two buttons say it all, so the hero has no supporting paragraph.
  it('has only the centred headline and the two buttons', () => {
    renderHome()
    expect(hero().classList.contains('hero')).toBe(true)
    expect(hero().querySelector('p')).toBeNull()
    expect(within(hero()).queryByText(/Raise money for a cause/)).toBeNull()
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

  // Only signed-in people can create. Signed out, the button opens the passkey sign-in, then carries on to /create.
  it('signed out, Create a Fundit opens the passkey sign-in and goes to /create once signed in', async () => {
    loginPasskey.mockResolvedValue({ address: ME.address })
    renderHome()
    const user = userEvent.setup()
    await user.click(within(hero()).getByRole('button', { name: 'Create a Fundit' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Sign in' })).getByRole('button', { name: 'Continue with passkey' }))
    await user.click(screen.getByRole('button', { name: 'Sign in with a passkey' }))
    expect(await screen.findByText('Create page')).toBeTruthy()
    expect(openWallet).not.toHaveBeenCalled()
  })

  it('signed out, closing sign-in without signing in stays on Home, and a later sign-in does not jump', async () => {
    const view = renderHome()
    const user = userEvent.setup()
    await user.click(within(hero()).getByRole('button', { name: 'Create a Fundit' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(hero()).toBeTruthy()
    state.sender = ME
    view.rerender(ui())
    expect(screen.queryByText('Create page')).toBeNull()
  })

  it('shows the seven causes with alt text, each linking to Explore', () => {
    renderHome()
    const causes = screen.getByRole('region', { name: 'What people raise for' })
    const imgs = within(causes).getAllByRole('img')
    expect(imgs).toHaveLength(7)
    for (const img of imgs) {
      expect((img.getAttribute('alt') ?? '').length).toBeGreaterThan(20)
      expect(img.getAttribute('src')).toMatch(/^\/images\/landing\/.+\.webp$/)
    }
    expect(imgs.map((i) => i.getAttribute('loading'))).toEqual(['eager', 'lazy', 'lazy', 'lazy', 'lazy', 'lazy', 'lazy'])
    for (const link of within(causes).getAllByRole('link')) expect(link.getAttribute('href')).toBe('/explore')
  })

  // People should see they can raise for themselves too, not only for causes and others in need.
  it('includes Personal goals and Big moments, each with a described photo', () => {
    renderHome()
    const causes = screen.getByRole('region', { name: 'What people raise for' })
    for (const [title, alt] of [
      ['Personal goals', /studies at her desk/],
      ['Big moments', /marriage/],
    ] as const) {
      const link = within(causes).getByText(title).closest('a')!
      expect(within(link).getByRole('img', { name: alt }).getAttribute('loading')).toBe('lazy')
    }
  })

  it('has no Start a Fundit link for a signed-out visitor', () => {
    renderHome()
    expect(screen.queryByRole('link', { name: 'Start a Fundit' })).toBeNull()
  })

  it('invites a signed-out visitor to explore when there are no Fundits', () => {
    renderHome()
    expect(screen.getByText(/No Fundits yet\. Sign in to start the first one/)).toBeTruthy()
  })

  it('invites a signed-in person to start one when there are no Fundits', () => {
    state.sender = ME
    renderHome()
    expect(screen.getByRole('link', { name: 'Start a Fundit' }).getAttribute('href')).toBe('/create')
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

  // Gifts come only from the Fundit account. The page must not promise ways to give that the donate panel
  // does not offer, whatever the cross-chain flag says.
  it.each([false, true])('cross-chain %s: does not mention giving from another chain or a unified balance', (on) => {
    flags.crosschain = on
    renderHome()
    expect(faq().textContent).not.toMatch(/from another chain|unified balance/i)
  })

  // Sign-in is passkey only, so the answer must not send people to a wallet app.
  it('says no wallet is needed: a passkey opens a Fundit account', () => {
    renderHome()
    const text = faq().textContent
    expect(text).toMatch(/sign in with a passkey/)
    expect(text).toMatch(/Fundit account/)
    expect(text).not.toMatch(/MetaMask|WalletConnect/)
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

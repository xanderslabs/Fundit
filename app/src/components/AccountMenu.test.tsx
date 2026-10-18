import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { Address } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WalletChoice } from '../hooks/useSender'
import type { StoredPasskey } from '../lib/passkey'
import { AccountControl } from './AccountMenu'

const EXTERNAL = '0x1111111111111111111111111111111111111111' as Address

const state: { session: StoredPasskey | null; external: Address | null } = { session: null, external: null }
const openWallet = vi.fn()
const disconnect = vi.fn()
const logoutPasskey = vi.fn()

vi.mock('@reown/appkit/react', () => ({ useAppKit: () => ({ open: openWallet }) }))
vi.mock('wagmi', () => ({ useDisconnect: () => ({ mutate: disconnect }) }))
vi.mock('../hooks/useName', () => ({ useName: () => ({ data: undefined }) }))
vi.mock('../lib/passkey', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/passkey')>()),
  usePasskeySession: () => state.session,
  logoutPasskey: () => logoutPasskey(),
}))
vi.mock('../hooks/useSender', () => ({
  useWalletChoice: (): WalletChoice => ({
    both: state.session !== null && state.external !== null,
    active: state.session ? 'passkey' : state.external ? 'external' : null,
    external: state.external,
    setActive: () => {},
  }),
}))

afterEach(() => {
  cleanup()
  state.session = null
  state.external = null
  openWallet.mockReset()
  disconnect.mockReset()
  logoutPasskey.mockReset()
})

function ui() {
  return (
    <MemoryRouter initialEntries={['/']}>
      <AccountControl />
      <Routes>
        <Route path="/" element={<p>Home page</p>} />
        <Route path="/create" element={<p>Create page</p>} />
        <Route path="/me" element={<p>My page content</p>} />
      </Routes>
    </MemoryRouter>
  )
}

const pill = () => screen.getByRole('button', { name: '0x1111...1111' })

describe('AccountControl signed out', () => {
  // One clear way in. Without passkeys it goes straight to the wallet modal, as the old Connect wallet did.
  it('shows Sign in, which opens the wallet sign-in', async () => {
    render(ui())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }))
    expect(openWallet).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /0x/ })).toBeNull()
  })
})

describe('AccountControl signed in', () => {
  it('shows the short address as a menu button', () => {
    state.external = EXTERNAL
    render(ui())
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
    expect(pill().getAttribute('aria-haspopup')).toBe('menu')
    expect(pill().getAttribute('aria-expanded')).toBe('false')
  })

  // Start a fundraiser lives here because only signed-in people can start one. The order is the product spec.
  it('opens a menu with Start a fundraiser, My page and Sign out, in that order, and focuses the first item', async () => {
    state.external = EXTERNAL
    render(ui())
    await userEvent.setup().click(pill())
    expect(pill().getAttribute('aria-expanded')).toBe('true')
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent)
    expect(items).toEqual(['Start a fundraiser', 'My page', 'Sign out'])
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Start a fundraiser' }))
  })

  it('moves between items with the arrow keys, wrapping at the ends', async () => {
    state.external = EXTERNAL
    render(ui())
    const user = userEvent.setup()
    await user.click(pill())
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'My page' }))
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Start a fundraiser' }))
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Sign out' }))
  })

  it('opens from the keyboard with Enter', async () => {
    state.external = EXTERNAL
    render(ui())
    const user = userEvent.setup()
    pill().focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  // Keyboard users must land back where they were, not at the top of the page.
  it('closes on Escape and returns focus to the button', async () => {
    state.external = EXTERNAL
    render(ui())
    const user = userEvent.setup()
    await user.click(pill())
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(pill().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(pill())
  })

  it('closes on a click outside', async () => {
    state.external = EXTERNAL
    render(ui())
    const user = userEvent.setup()
    await user.click(pill())
    await user.click(screen.getByText('Home page'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('My page goes to /me', async () => {
    state.external = EXTERNAL
    render(ui())
    const user = userEvent.setup()
    await user.click(pill())
    await user.click(screen.getByRole('menuitem', { name: 'My page' }))
    expect(screen.getByText('My page content')).toBeTruthy()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Start a fundraiser goes to /create', async () => {
    state.external = EXTERNAL
    render(ui())
    const user = userEvent.setup()
    await user.click(pill())
    await user.click(screen.getByRole('menuitem', { name: 'Start a fundraiser' }))
    expect(screen.getByText('Create page')).toBeTruthy()
  })

  // Sign out has to end the wallet connection for real, or the next person on this browser acts as this one.
  it('Sign out disconnects the wallet and leaves a passkey session alone when there is none', async () => {
    state.external = EXTERNAL
    const { rerender } = render(ui())
    const user = userEvent.setup()
    await user.click(pill())
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(logoutPasskey).not.toHaveBeenCalled()
    state.external = null
    rerender(ui())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sign in' }))
  })
})

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { Address } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { storageKey } from '../config'
import { readWalletSession, saveWalletSession } from '../lib/walletAccount'
import { AccountControl } from './AccountMenu'

const ACCOUNT = { address: '0x1111111111111111111111111111111111111111' as Address }

// Signed in with a wallet, through the real wallet store.
const signIn = () => saveWalletSession({ address: ACCOUNT.address, connectorId: 'io.metamask' })
const disconnect = vi.fn()
const signOutEmail = vi.fn(async () => {})

// Nothing here connects a wallet: the wallet setup loads only inside Add money, so importing it fails the test.
vi.mock('../wagmi', () => {
  throw new Error('AccountMenu loaded the wallet setup')
})
vi.mock('../lib/walletSession', () => ({ disconnectWallet: () => disconnect() }))
vi.mock('../lib/circleEmail', () => ({ signOutEmail: () => signOutEmail() }))
vi.mock('../hooks/useName', () => ({ useName: () => ({ data: undefined }) }))

afterEach(() => {
  cleanup()
  localStorage.clear()
  disconnect.mockReset()
  signOutEmail.mockClear()
})

function ui(start = '/') {
  return (
    <MemoryRouter initialEntries={[start]}>
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
  // Sign in opens Fundit's own sign-in dialog. It never opens a separate wallet modal.
  it('shows Sign in, which opens the sign-in dialog and never a separate wallet modal', async () => {
    render(ui())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }))
    const dialog = screen.getByRole('dialog', { name: 'Sign in' })
    expect(within(dialog).getByRole('button', { name: 'Connect a wallet' })).toBeTruthy()
    expect(within(dialog).queryByText(/crypto wallet/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /0x/ })).toBeNull()
  })
})

describe('AccountControl signed in', () => {
  it('shows the short address as a menu button', () => {
    signIn()
    render(ui())
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
    expect(pill().getAttribute('aria-haspopup')).toBe('menu')
    expect(pill().getAttribute('aria-expanded')).toBe('false')
  })

  // Start a Fundit lives here because only signed-in people can start one. The order is the product spec.
  it('opens a menu with Start a Fundit, My page and Sign out, in that order, and focuses the first item', async () => {
    signIn()
    render(ui())
    await userEvent.setup().click(pill())
    expect(pill().getAttribute('aria-expanded')).toBe('true')
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent)
    expect(items).toEqual(['Start a Fundit', 'My page', 'Sign out'])
    expect(screen.queryByRole('menuitem', { name: 'Add money' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Start a Fundit' }))
  })

  it('moves between items with the arrow keys, wrapping at the ends', async () => {
    signIn()
    render(ui())
    const user = userEvent.setup()
    await user.click(pill())
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'My page' }))
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Start a Fundit' }))
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Sign out' }))
  })

  it('opens from the keyboard with Enter', async () => {
    signIn()
    render(ui())
    const user = userEvent.setup()
    pill().focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  // Keyboard users must land back where they were, not at the top of the page.
  it('closes on Escape and returns focus to the button', async () => {
    signIn()
    render(ui())
    const user = userEvent.setup()
    await user.click(pill())
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(pill().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(pill())
  })

  it('closes on a click outside', async () => {
    signIn()
    render(ui())
    const user = userEvent.setup()
    await user.click(pill())
    await user.click(screen.getByText('Home page'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('My page goes to /me', async () => {
    signIn()
    render(ui())
    const user = userEvent.setup()
    await user.click(pill())
    await user.click(screen.getByRole('menuitem', { name: 'My page' }))
    expect(screen.getByText('My page content')).toBeTruthy()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Start a Fundit goes to /create', async () => {
    signIn()
    render(ui())
    const user = userEvent.setup()
    await user.click(pill())
    await user.click(screen.getByRole('menuitem', { name: 'Start a Fundit' }))
    expect(screen.getByText('Create page')).toBeTruthy()
  })

  // Sign out has to end the session for real, or the next person on this browser acts as this one. A wallet
  // connected to add money is disconnected too.
  it('Sign out clears the wallet session, disconnects the wallet and moves focus to Sign in', async () => {
    signIn()
    render(ui())
    const user = userEvent.setup()
    await user.click(pill())
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(readWalletSession()).toBeNull()
    expect(disconnect).toHaveBeenCalledTimes(1)
    const signInButton = await screen.findByRole('button', { name: 'Sign in' })
    expect(document.activeElement).toBe(signInButton)
  })

  // A page that needs an account would only show "Sign in to continue" after sign out, so it goes home.
  it('Sign out from My page lands on the home page', async () => {
    signIn()
    render(ui('/me'))
    expect(screen.getByText('My page content')).toBeTruthy()
    const user = userEvent.setup()
    await user.click(pill())
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(await screen.findByText('Home page')).toBeTruthy()
    expect(screen.queryByText('My page content')).toBeNull()
  })

  // A wallet account has no name of its own. The pill shows its short address, like Name does elsewhere.
  it('the pill shows the short address for a wallet account', () => {
    signIn()
    render(ui())
    expect(pill().textContent).toBe('0x1111...1111')
    expect(pill().getAttribute('aria-haspopup')).toBe('menu')
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
  })

  // Every store goes on sign out, so no account of any kind comes back for the next person on this browser.
  it('sign out clears the email session too', async () => {
    localStorage.setItem(storageKey('session.email'), JSON.stringify({ address: ACCOUNT.address, walletId: 'w-1', email: 'ana@example.com' }))
    render(ui())
    const user = userEvent.setup()
    // The pill never shows the email address, which anyone looking at the screen would see. It shows the short address.
    expect(screen.queryByText('ana@example.com')).toBeNull()
    await user.click(pill())
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(localStorage.getItem(storageKey('session.email'))).toBeNull()
    // The Worker drops Circle's token cookies too.
    expect(signOutEmail).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy()
  })
})

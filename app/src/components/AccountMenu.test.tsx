import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { Address } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StoredPasskey } from '../lib/passkey'
import { AccountControl } from './AccountMenu'

const ACCOUNT: StoredPasskey = { address: '0x1111111111111111111111111111111111111111' as Address, credentialId: 'cred-1' }

const state: { session: StoredPasskey | null } = { session: null }
const openWallet = vi.fn()
const disconnect = vi.fn()
const logoutPasskey = vi.fn()
const confirmLeave = vi.fn(() => true)

// AppKit is mocked only to prove that nothing here opens it. It opens only inside Add money.
vi.mock('@reown/appkit/react', () => ({ useAppKit: () => ({ open: openWallet }) }))
vi.mock('wagmi', () => ({ useDisconnect: () => ({ mutate: disconnect }) }))
vi.mock('../hooks/useName', () => ({ useName: () => ({ data: undefined }) }))
vi.mock('../lib/passkey', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/passkey')>()),
  usePasskeySession: () => state.session,
  useBackupPrompt: () => false,
  logoutPasskey: () => logoutPasskey(),
}))
vi.mock('./AddBackupPasskey', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./AddBackupPasskey')>()),
  confirmLeave: () => confirmLeave(),
}))

afterEach(() => {
  cleanup()
  state.session = null
  openWallet.mockReset()
  disconnect.mockReset()
  logoutPasskey.mockReset()
  confirmLeave.mockReset()
  confirmLeave.mockReturnValue(true)
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
  // Sign-in is passkey only. There is no wallet sign-in, so Sign in never opens the wallet modal.
  it('shows Sign in, which opens the passkey sign-in dialog and never the wallet modal', async () => {
    render(ui())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }))
    const dialog = screen.getByRole('dialog', { name: 'Sign in' })
    expect(within(dialog).getByRole('button', { name: 'Sign in with your passkey' })).toBeTruthy()
    expect(within(dialog).queryByText(/crypto wallet/i)).toBeNull()
    expect(openWallet).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /0x/ })).toBeNull()
  })
})

describe('AccountControl signed in', () => {
  it('shows the short address as a menu button', () => {
    state.session = ACCOUNT
    render(ui())
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
    expect(pill().getAttribute('aria-haspopup')).toBe('menu')
    expect(pill().getAttribute('aria-expanded')).toBe('false')
  })

  // Start a Fundit lives here because only signed-in people can start one. The order is the product spec.
  it('opens a menu with Start a Fundit, My page, Add money and Sign out, in that order, and focuses the first item', async () => {
    state.session = ACCOUNT
    render(ui())
    await userEvent.setup().click(pill())
    expect(pill().getAttribute('aria-expanded')).toBe('true')
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent)
    expect(items).toEqual(['Start a Fundit', 'My page', 'Add money', 'Sign out'])
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Start a Fundit' }))
  })

  it('moves between items with the arrow keys, wrapping at the ends', async () => {
    state.session = ACCOUNT
    render(ui())
    const user = userEvent.setup()
    await user.click(pill())
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'My page' }))
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Start a Fundit' }))
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Sign out' }))
  })

  it('opens from the keyboard with Enter', async () => {
    state.session = ACCOUNT
    render(ui())
    const user = userEvent.setup()
    pill().focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  // Keyboard users must land back where they were, not at the top of the page.
  it('closes on Escape and returns focus to the button', async () => {
    state.session = ACCOUNT
    render(ui())
    const user = userEvent.setup()
    await user.click(pill())
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(pill().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(pill())
  })

  it('closes on a click outside', async () => {
    state.session = ACCOUNT
    render(ui())
    const user = userEvent.setup()
    await user.click(pill())
    await user.click(screen.getByText('Home page'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('My page goes to /me', async () => {
    state.session = ACCOUNT
    render(ui())
    const user = userEvent.setup()
    await user.click(pill())
    await user.click(screen.getByRole('menuitem', { name: 'My page' }))
    expect(screen.getByText('My page content')).toBeTruthy()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Start a Fundit goes to /create', async () => {
    state.session = ACCOUNT
    render(ui())
    const user = userEvent.setup()
    await user.click(pill())
    await user.click(screen.getByRole('menuitem', { name: 'Start a Fundit' }))
    expect(screen.getByText('Create page')).toBeTruthy()
  })

  // Sign out has to end the session for real, or the next person on this browser acts as this one. A wallet
  // connected to add money is disconnected too.
  it('Sign out ends the passkey session and disconnects any wallet connected for Add money', async () => {
    state.session = ACCOUNT
    const { rerender } = render(ui())
    const user = userEvent.setup()
    await user.click(pill())
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(logoutPasskey).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalledTimes(1)
    state.session = null
    rerender(ui())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sign in' }))
  })

  // On My page with recovery words on screen, Sign out would drop them, so it asks first like any other exit.
  it('Sign out asks first while recovery words are on screen, and does nothing when the person stays', async () => {
    state.session = ACCOUNT
    confirmLeave.mockReturnValue(false)
    render(ui())
    const user = userEvent.setup()
    await user.click(pill())
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(confirmLeave).toHaveBeenCalledTimes(1)
    expect(disconnect).not.toHaveBeenCalled()
    expect(logoutPasskey).not.toHaveBeenCalled()
  })
})

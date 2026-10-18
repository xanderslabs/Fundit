import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { Address } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WalletChoice } from '../hooks/useSender'
import type { StoredPasskey } from '../lib/passkey'
import { AccountControl } from './AccountMenu'

const PASSKEY = '0x00000000000000000000000000000000000000cc' as Address
const EXTERNAL = '0x1111111111111111111111111111111111111111' as Address

const state: { session: StoredPasskey | null; external: Address | null; active: 'passkey' | 'external' } = {
  session: null,
  external: null,
  active: 'passkey',
}
const setActive = vi.fn()
const disconnect = vi.fn()
const logoutPasskey = vi.fn()

vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  PASSKEYS_ENABLED: true,
}))
vi.mock('@reown/appkit/react', () => ({ useAppKit: () => ({ open: () => {} }) }))
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
    active: state.session && (state.active === 'passkey' || !state.external) ? 'passkey' : state.external ? 'external' : null,
    external: state.external,
    setActive,
  }),
}))

afterEach(() => {
  cleanup()
  state.session = null
  state.external = null
  state.active = 'passkey'
  setActive.mockReset()
  disconnect.mockReset()
  logoutPasskey.mockReset()
})

function renderControl() {
  render(
    <MemoryRouter>
      <AccountControl />
    </MemoryRouter>,
  )
}

async function openMenu(name: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name }))
  return user
}

describe('Sign in with passkeys on', () => {
  // Keyboard and screen reader users land in the sign-in panel, and Escape takes them back where they were.
  it('moves focus into the panel on open, and Escape closes it and returns focus to Sign in', async () => {
    renderControl()
    const user = userEvent.setup()
    const trigger = screen.getByRole('button', { name: 'Sign in' })
    await user.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Use a wallet' }))
    expect(screen.getByLabelText('Name for your passkey')).toBeTruthy()

    await user.keyboard('{Escape}')
    expect(screen.queryByLabelText('Name for your passkey')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })
})

describe('Account menu with a passkey session', () => {
  it('shows which wallet is in use and switches to the connected wallet', async () => {
    state.session = { address: PASSKEY, credentialId: 'cred-1' }
    state.external = EXTERNAL
    renderControl()
    await openMenu('0x0000...00cc')
    expect(screen.getByText('Using your passkey wallet')).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('menuitem', { name: 'Use connected wallet' }))
    expect(setActive).toHaveBeenCalledWith('external')
  })

  it('shows the connected wallet in use and switches back to the passkey', async () => {
    state.session = { address: PASSKEY, credentialId: 'cred-1' }
    state.external = EXTERNAL
    state.active = 'external'
    renderControl()
    await openMenu('0x1111...1111')
    expect(screen.getByText('Using your connected wallet')).toBeTruthy()
    await act(async () => userEvent.setup().click(screen.getByRole('menuitem', { name: 'Use passkey wallet' })))
    expect(setActive).toHaveBeenCalledWith('passkey')
  })

  it('shows no switch with only the passkey, and keeps the spec order around the passkey wallet link', async () => {
    state.session = { address: PASSKEY, credentialId: 'cred-1' }
    renderControl()
    await openMenu('0x0000...00cc')
    expect(screen.queryByText(/Using your/)).toBeNull()
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Start a fundraiser',
      'My page',
      'Passkey wallet',
      'Sign out',
    ])
  })

  // Signing out ends every session this browser holds, so nobody else can act as this person afterwards.
  it('Sign out ends the passkey session and disconnects the wallet', async () => {
    state.session = { address: PASSKEY, credentialId: 'cred-1' }
    state.external = EXTERNAL
    renderControl()
    await openMenu('0x0000...00cc')
    await userEvent.setup().click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(logoutPasskey).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})

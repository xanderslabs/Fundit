import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { Address } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WalletChoice } from '../hooks/useSender'
import type { StoredPasskey } from '../lib/passkey'
import { PasskeyMenu } from './PasskeyLogin'

const PASSKEY = '0x00000000000000000000000000000000000000cc' as Address
const EXTERNAL = '0x1111111111111111111111111111111111111111' as Address

const state: { session: StoredPasskey | null; external: Address | null; active: 'passkey' | 'external' } = {
  session: null,
  external: null,
  active: 'passkey',
}
const setActive = vi.fn()

vi.mock('../lib/passkey', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/passkey')>()),
  usePasskeySession: () => state.session,
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
})

function renderMenu() {
  render(
    <MemoryRouter>
      <PasskeyMenu />
    </MemoryRouter>,
  )
}

describe('PasskeyMenu popover', () => {
  // Keyboard and screen reader users land in the sign-in form, and Escape takes them back where they were.
  it('moves focus into the popover on open, and Escape closes it and returns focus to the trigger', async () => {
    renderMenu()
    const user = userEvent.setup()
    const trigger = screen.getByRole('button', { name: 'Use a passkey' })
    await user.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(screen.getByLabelText('Name for your passkey'))

    await user.keyboard('{Escape}')
    expect(screen.queryByLabelText('Name for your passkey')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })
})

describe('PasskeyMenu with a passkey and a connected wallet', () => {
  it('shows which wallet is in use and switches to the connected wallet', async () => {
    state.session = { address: PASSKEY, credentialId: 'cred-1' }
    state.external = EXTERNAL
    renderMenu()
    expect(screen.getByText('In use: passkey wallet')).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Use connected wallet' }))
    expect(setActive).toHaveBeenCalledWith('external')
  })

  it('shows the connected wallet in use and switches back to the passkey', async () => {
    state.session = { address: PASSKEY, credentialId: 'cred-1' }
    state.external = EXTERNAL
    state.active = 'external'
    renderMenu()
    expect(screen.getByText('In use: connected wallet')).toBeTruthy()
    await act(async () => userEvent.setup().click(screen.getByRole('button', { name: 'Use passkey wallet' })))
    expect(setActive).toHaveBeenCalledWith('passkey')
  })

  it('shows no switch with only the passkey', () => {
    state.session = { address: PASSKEY, credentialId: 'cred-1' }
    renderMenu()
    expect(screen.queryByText(/In use/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Use connected wallet|Use passkey wallet/ })).toBeNull()
  })
})

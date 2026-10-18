import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
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
const openWallet = vi.fn()
const registerPasskey = vi.fn()
const loginPasskey = vi.fn()
const dismissBackupPrompt = vi.fn()
const prompt = { value: false }

vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  PASSKEYS_ENABLED: true,
}))
vi.mock('@reown/appkit/react', () => ({ useAppKit: () => ({ open: openWallet }) }))
vi.mock('wagmi', () => ({ useDisconnect: () => ({ mutate: disconnect }) }))
vi.mock('../hooks/useName', () => ({ useName: () => ({ data: undefined }) }))
vi.mock('../lib/passkey', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/passkey')>()),
  usePasskeySession: () => state.session,
  logoutPasskey: () => logoutPasskey(),
  registerPasskey: (name: string) => registerPasskey(name),
  loginPasskey: () => loginPasskey(),
  useBackupPrompt: () => prompt.value,
  dismissBackupPrompt: () => dismissBackupPrompt(),
  useBackupPending: () => false,
  canPayBackupGas: async () => true,
  newRecoveryPhrase: async () => 'one two three four five six seven eight nine ten eleven twelve',
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
  openWallet.mockReset()
  registerPasskey.mockReset()
  loginPasskey.mockReset()
  dismissBackupPrompt.mockReset()
  prompt.value = false
  vi.restoreAllMocks()
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
  async function openSignIn() {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    return user
  }

  async function openPasskey() {
    const user = await openSignIn()
    await user.click(screen.getByRole('button', { name: 'Continue with passkey' }))
    return user
  }

  // The Fundit account is the main way in. A crypto wallet is still one tap away for people who have one.
  it('shows Continue with passkey first and Use a crypto wallet instead second, which opens the wallet modal', async () => {
    renderControl()
    const user = await openSignIn()
    const dialog = screen.getByRole('dialog', { name: 'Sign in' })
    const buttons = [...dialog.querySelectorAll('button')].map((b) => b.textContent).filter((t) => t !== '')
    expect(buttons.indexOf('Continue with passkey')).toBeLessThan(buttons.indexOf('Use a crypto wallet instead'))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Continue with passkey' }))
    await user.click(screen.getByRole('button', { name: 'Use a crypto wallet instead' }))
    expect(openWallet).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // Keyboard and screen reader users stay inside the dialog, and Escape takes them back where they were.
  it('keeps focus inside the dialog, and Escape closes it and returns focus to Sign in', async () => {
    renderControl()
    const trigger = screen.getByRole('button', { name: 'Sign in' })
    const user = await openSignIn()
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const dialog = screen.getByRole('dialog', { name: 'Sign in' })
    for (let i = 0; i < 6; i++) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
    await user.tab({ shift: true })
    expect(dialog.contains(document.activeElement)).toBe(true)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })

  // Someone who lost every passkey needs a way back in from the place they would look for it.
  it('links to recovery from the passkey step, and the link closes the dialog', async () => {
    render(
      <MemoryRouter>
        <AccountControl />
        <Routes>
          <Route path="/" element={<p>Home page</p>} />
          <Route path="/recover" element={<p>Recover page</p>} />
        </Routes>
      </MemoryRouter>,
    )
    const user = await openPasskey()
    await user.click(screen.getByRole('link', { name: 'Lost your passkey? Recover your account' }))
    expect(screen.getByText('Recover page')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('offers a new account with a username, and sign-in for a returning person', async () => {
    renderControl()
    await openPasskey()
    expect(screen.getByLabelText('Name for your passkey')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create my Fundit account' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in with a passkey' })).toBeTruthy()
  })

  // The name is stored with the passkey, so stray spaces and empty or very long names are stopped here.
  it('creates the account with the trimmed username', async () => {
    registerPasskey.mockResolvedValue({ address: PASSKEY })
    renderControl()
    const user = await openPasskey()
    await user.type(screen.getByLabelText('Name for your passkey'), '  ana  ')
    await user.click(screen.getByRole('button', { name: 'Create my Fundit account' }))
    expect(registerPasskey).toHaveBeenCalledWith('ana')
  })

  it('refuses an empty or over-32-character username with a plain message', async () => {
    renderControl()
    const user = await openPasskey()
    await user.click(screen.getByRole('button', { name: 'Create my Fundit account' }))
    expect(screen.getByRole('alert').textContent).toBe('Enter a name for your account.')
    await user.type(screen.getByLabelText('Name for your passkey'), 'a'.repeat(33))
    await user.click(screen.getByRole('button', { name: 'Create my Fundit account' }))
    expect(screen.getByRole('alert').textContent).toBe('Keep the name to 32 characters.')
    expect(registerPasskey).not.toHaveBeenCalled()
  })

  // Sign-up can fail after the browser already saved the passkey. The person must be able to use it.
  it('login works after an interrupted register', async () => {
    registerPasskey.mockRejectedValue(new Error('network down'))
    loginPasskey.mockResolvedValue({ address: PASSKEY })
    renderControl()
    const user = await openPasskey()
    await user.type(screen.getByLabelText('Name for your passkey'), 'ana')
    await user.click(screen.getByRole('button', { name: 'Create my Fundit account' }))
    expect(screen.getByRole('alert').textContent).toMatch(/If your browser saved a passkey, sign in with it\./)
    await user.click(screen.getByRole('button', { name: 'Sign in with a passkey' }))
    expect(loginPasskey).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: 'Sign in' })).toBeNull()
  })
})

describe('Backup prompt after sign-up', () => {
  // Shown once, right after a new account exists, as a dialog over whatever page the person lands on.
  it('shows the backup dialog for a new account, and Later dismisses it for this visit', async () => {
    state.session = { address: PASSKEY, credentialId: 'cred-1' }
    prompt.value = true
    renderControl()
    const dialog = screen.getByRole('dialog', { name: 'Add a recovery key' })
    expect(dialog.textContent).toContain('If you lose every device with your passkey, nobody can recover your Fundit account.')
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Later' }))
    expect(dismissBackupPrompt).toHaveBeenCalledTimes(1)
  })

  it('Escape also means Later', async () => {
    state.session = { address: PASSKEY, credentialId: 'cred-1' }
    prompt.value = true
    renderControl()
    await userEvent.setup().keyboard('{Escape}')
    expect(dismissBackupPrompt).toHaveBeenCalledTimes(1)
  })

  // Escape, the backdrop and Close would drop words the person may not have written down yet.
  it('asks before closing while the words are on screen, and stays open when the person says no', async () => {
    state.session = { address: PASSKEY, credentialId: 'cred-1' }
    prompt.value = true
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderControl()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Show my recovery key' }))
    await user.keyboard('{Escape}')
    expect(confirm).toHaveBeenCalledWith('Leave without saving your backup? Your recovery key has not been added yet.')
    expect(dismissBackupPrompt).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(dismissBackupPrompt).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(dismissBackupPrompt).toHaveBeenCalledTimes(1)
  })

  it('does not show for a returning account', () => {
    state.session = { address: PASSKEY, credentialId: 'cred-1' }
    renderControl()
    expect(screen.queryByRole('dialog')).toBeNull()
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

  it('shows no switch with only the passkey, and keeps the spec order around the Add money link', async () => {
    state.session = { address: PASSKEY, credentialId: 'cred-1' }
    renderControl()
    await openMenu('0x0000...00cc')
    expect(screen.queryByText(/Using your/)).toBeNull()
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Start a Fundit',
      'My page',
      'Add money',
      'Sign out',
    ])
    expect(screen.getByRole('menuitem', { name: 'Add money' }).getAttribute('href')).toBe('/add-money')
  })

  it('has no Add money item for a connected wallet alone', async () => {
    state.external = EXTERNAL
    renderControl()
    await openMenu('0x1111...1111')
    expect(screen.queryByRole('menuitem', { name: 'Add money' })).toBeNull()
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

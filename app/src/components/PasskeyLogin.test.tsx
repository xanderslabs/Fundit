import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { type Address, RpcRequestError, UnknownRpcError } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StoredPasskey } from '../lib/passkey'
import { AccountControl } from './AccountMenu'

const PASSKEY = '0x00000000000000000000000000000000000000cc' as Address

const state: { session: StoredPasskey | null } = { session: null }
const disconnect = vi.fn()
const logoutPasskey = vi.fn()
const openWallet = vi.fn()
const registerPasskey = vi.fn()
const loginPasskey = vi.fn()
const dismissBackupPrompt = vi.fn()
const prompt = { value: false }

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
afterEach(() => {
  cleanup()
  state.session = null
  disconnect.mockReset()
  logoutPasskey.mockReset()
  openWallet.mockReset()
  registerPasskey.mockReset()
  loginPasskey.mockReset()
  dismissBackupPrompt.mockReset()
  prompt.value = false
  vi.restoreAllMocks()
})

function Where() {
  const l = useLocation()
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>
}

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

describe('Sign in', () => {
  async function openSignIn() {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    return user
  }

  async function openCreate() {
    const user = await openSignIn()
    await user.click(screen.getByRole('button', { name: 'Create one now' }))
    return user
  }

  function renderWithRecover() {
    render(
      <MemoryRouter>
        <AccountControl />
        <Routes>
          <Route path="/" element={<p>Home page</p>} />
          <Route path="/recover" element={<p>Recover page</p>} />
        </Routes>
      </MemoryRouter>,
    )
  }

  // One step: the dialog opens straight on the passkey sign-in, with no wallet option and no extra Continue step.
  it('opens on Sign in with one passkey button, no wallet option and no Continue step', async () => {
    renderControl()
    await openSignIn()
    const dialog = screen.getByRole('dialog', { name: 'Sign in' })
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy()
    const main = within(dialog).getByRole('button', { name: 'Sign in with your passkey' })
    expect(document.activeElement).toBe(main)
    expect(within(dialog).queryByRole('button', { name: /Continue/ })).toBeNull()
    expect(dialog.textContent).toContain("Don't have an account? Create one now")
    expect(dialog.textContent).toContain('Lost access to your account? Recover it now')
    expect(dialog.textContent).not.toMatch(/wallet/i)
    expect(openWallet).not.toHaveBeenCalled()
  })

  it('signs in with the existing login and closes', async () => {
    loginPasskey.mockResolvedValue({ address: PASSKEY })
    renderControl()
    const user = await openSignIn()
    await user.click(screen.getByRole('button', { name: 'Sign in with your passkey' }))
    expect(loginPasskey).toHaveBeenCalledTimes(1)
    expect(registerPasskey).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // The two views are one dialog: switching changes the heading and moves focus to the new view's first control.
  it('switches to Create your account and back, moving focus each time', async () => {
    renderControl()
    const user = await openCreate()
    const dialog = screen.getByRole('dialog', { name: 'Create your account' })
    const field = within(dialog).getByLabelText('Username')
    expect(document.activeElement).toBe(field)
    expect(dialog.textContent).toContain('5 to 50 characters, no spaces')
    expect(within(dialog).getByRole('button', { name: 'Create account' })).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Sign in with your passkey' })).toBeNull()
    expect(dialog.textContent).toContain('Already have an account? Sign in now')
    expect(dialog.textContent).toContain('Lost access to your account? Recover it now')

    await user.click(within(dialog).getByRole('button', { name: 'Sign in now' }))
    const back = screen.getByRole('dialog', { name: 'Sign in' })
    expect(document.activeElement).toBe(within(back).getByRole('button', { name: 'Sign in with your passkey' }))
    expect(within(back).queryByLabelText('Username')).toBeNull()
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

  it('reopens on Sign in after it was closed on Create your account', async () => {
    renderControl()
    const user = await openCreate()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeTruthy()
  })

  // Someone who lost every passkey needs a way back in from the place they would look for it, in both views.
  it.each([
    ['Sign in', openSignIn],
    ['Create your account', openCreate],
  ])('links to recovery from %s, and the link closes the dialog', async (_view, open) => {
    renderWithRecover()
    const user = await open()
    await user.click(screen.getByRole('link', { name: 'Recover it now' }))
    expect(screen.getByText('Recover page')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // The name is stored with the passkey, so stray spaces and empty or very long names are stopped here.
  it('creates the account with the trimmed username', async () => {
    registerPasskey.mockResolvedValue({ address: PASSKEY })
    renderControl()
    const user = await openCreate()
    await user.type(screen.getByLabelText('Username'), '  ana.phone  ')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(registerPasskey).toHaveBeenCalledWith('ana.phone')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // A new account holds nothing, so sign-up lands on My page with the Add money panel open.
  it('lands on My page with Add money open after creating the account', async () => {
    registerPasskey.mockResolvedValue({ address: PASSKEY })
    render(
      <MemoryRouter initialEntries={['/']}>
        <AccountControl />
        <Where />
      </MemoryRouter>,
    )
    const user = await openCreate()
    await user.type(screen.getByLabelText('Username'), 'ana.phone')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByTestId('where').textContent).toBe('/me?add=1')
  })

  it('refuses an empty username with a plain message', async () => {
    renderControl()
    const user = await openCreate()
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByRole('alert').textContent).toBe('Enter a name for your account.')
    expect(registerPasskey).not.toHaveBeenCalled()
  })

  // Circle takes 5 to 50 characters from A-Z, a-z, 0-9 and _@.:+- only, and refuses anything else with an
  // RPC error the person cannot read. On Arc testnet "e2e 2026-10-18T16:50" failed that way.
  it.each([
    ['a space', 'Jane Doe'],
    ['too short', 'ana'],
    ['too long', 'a'.repeat(51)],
    ['an accent', 'Zoë-phone'],
  ])("refuses a name with %s before Circle sees it", async (_why, name) => {
    renderControl()
    const user = await openCreate()
    await user.type(screen.getByLabelText('Username'), name)
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByRole('alert').textContent).toBe('Use 5 to 50 letters, numbers or _ @ . : + - (no spaces).')
    expect(registerPasskey).not.toHaveBeenCalled()
  })

  it('takes every character Circle allows', async () => {
    registerPasskey.mockResolvedValue({ address: PASSKEY })
    renderControl()
    const user = await openCreate()
    await user.type(screen.getByLabelText('Username'), 'Ana_9@home.pc:1+2-3')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(registerPasskey).toHaveBeenCalledWith('Ana_9@home.pc:1+2-3')
  })

  // If Circle still refuses the name, the person reads the rule, not "An unknown RPC error occurred.", and is not
  // told to sign in with a passkey that was never made.
  it("maps Circle's invalid-username error to the rule", async () => {
    const circle = new RpcRequestError({
      body: { method: 'rp_getRegistrationOptions' },
      error: {
        code: -32025,
        message: 'The username is invalid. It should be 5 to 50 characters and contain only alphanumeric and _@.:+- characters.',
      },
      url: 'https://modular-sdk.circle.com/v1/rpc/w3s/buidl',
    })
    registerPasskey.mockRejectedValue(new UnknownRpcError(circle))
    renderControl()
    const user = await openCreate()
    await user.type(screen.getByLabelText('Username'), 'ana-phone')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Use 5 to 50 letters, numbers or _ @ . : + - (no spaces).')
  })

  // Sign-up can fail after the browser already saved the passkey. The person must be able to use it.
  it('login works after an interrupted register', async () => {
    registerPasskey.mockRejectedValue(new Error('network down'))
    loginPasskey.mockResolvedValue({ address: PASSKEY })
    renderControl()
    const user = await openCreate()
    await user.type(screen.getByLabelText('Username'), 'ana-phone')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByRole('alert').textContent).toMatch(/If your browser saved a passkey, sign in with it\./)
    await user.click(screen.getByRole('button', { name: 'Sign in now' }))
    await user.click(screen.getByRole('button', { name: 'Sign in with your passkey' }))
    expect(loginPasskey).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // While the browser shows its passkey steps, nothing else in the dialog may start a second request.
  it('disables every control while busy', async () => {
    loginPasskey.mockReturnValue(new Promise(() => {}))
    renderControl()
    const user = await openSignIn()
    await user.click(screen.getByRole('button', { name: 'Sign in with your passkey' }))
    expect(screen.getByText('Follow the steps your browser shows.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in with your passkey' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Create one now' })).toHaveProperty('disabled', true)
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
  it('has no wallet switch, and keeps the spec order around the Add money link', async () => {
    state.session = { address: PASSKEY, credentialId: 'cred-1' }
    renderControl()
    await openMenu('0x0000...00cc')
    expect(screen.queryByText(/Using your/)).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /connected wallet|Use Fundit account/ })).toBeNull()
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Start a Fundit',
      'My page',
      'Add money',
      'Sign out',
    ])
    expect(screen.getByRole('menuitem', { name: 'Add money' }).getAttribute('href')).toBe('/me?add=1')
  })
})

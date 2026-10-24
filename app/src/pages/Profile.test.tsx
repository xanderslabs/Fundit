import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, useLocation } from 'react-router'
import type { Address } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXPLORER_URL, TOKENS } from '../config'
import type { CampaignView } from '../lib/campaigns'
import type { StoredPasskey } from '../lib/passkey'
import type { Sender, TxResult } from '../lib/sender'
import { Profile } from './Profile'

const ME = '0x00000000000000000000000000000000000000cC' as Address
const FUNDIT = '0x00000000000000000000000000000000000000a1' as Address

// VITE_CROSSCHAIN now means Add money from another chain. Gifts never come from another chain.
const flags = vi.hoisted(() => ({ crosschain: false }))
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  get CROSSCHAIN_ENABLED() {
    return flags.crosschain
  },
  REOWN_PROJECT_ID: 'test-project',
}))

const state: { sender: Sender | null; mine: Promise<CampaignView[]> | null; gifts: unknown[] | null; username: string | null } = {
  sender: null,
  mine: null,
  gifts: null,
  username: null,
}
vi.mock('../hooks/useSender', () => ({ useSender: () => state.sender }))
// Nothing here connects a wallet: the wallet setup loads only inside Add money, so importing it fails the test.
vi.mock('../wagmi', () => {
  throw new Error('Profile loaded the wallet setup')
})
const disconnect = vi.hoisted(() => vi.fn())
vi.mock('../lib/walletSession', () => ({ disconnectWallet: disconnect }))
vi.mock('wagmi', () => ({
  useConfig: () => ({}),
  useConnection: () => ({ isConnected: false }),
}))
// The lists load from Arc; lib/activity.test.ts and lib/campaigns.test.ts cover the reads.
vi.mock('../lib/clients', () => ({ arcClient: {} }))
vi.mock('../lib/activity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/activity')>()),
  recentDonationsBy: () => (state.gifts ? Promise.resolve(state.gifts) : new Promise(() => {})),
}))
vi.mock('../lib/campaigns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/campaigns')>()),
  myCampaigns: () => state.mine ?? new Promise(() => {}),
}))
vi.mock('../lib/deposit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/deposit')>()),
  fetchAccountBalances: async () => ({ usdc: 12_500000n, eurc: 3_000000n }),
}))
vi.mock('../hooks/useActivity', () => ({ blockTimes: async () => new Map([[1n, 1760000000n]]) }))
vi.mock('../hooks/useName', () => ({ useName: () => ({ data: undefined }) }))
vi.mock('../hooks/useCampaigns', () => ({ useCampaign: () => ({ data: view() }) }))
const backup = vi.hoisted(() => ({ needed: false, chain: (): Promise<boolean> => Promise.resolve(false) }))
const logoutPasskey = vi.hoisted(() => vi.fn())
vi.mock('../lib/passkey', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/passkey')>()),
  usePasskeySession: (): StoredPasskey | null => (state.sender?.kind === 'passkey' ? { address: state.sender.address, credentialId: 'c' } : null),
  useBackupNeeded: () => backup.needed,
  useBackupPending: () => false,
  syncBackupFromChain: () => backup.chain(),
  canPayBackupGas: async () => true,
  passkeyReserve: async () => 50_000n,
  readPasskeyUsername: () => state.username,
  logoutPasskey: () => logoutPasskey(),
}))
vi.mock('../lib/account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/account')>()),
  useAccount: () => (state.sender ? { kind: state.sender.kind, address: state.sender.address } : null),
}))
const confirmLeave = vi.hoisted(() => vi.fn(() => true))
vi.mock('../components/AddBackupPasskey', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/AddBackupPasskey')>()),
  confirmLeave: () => confirmLeave(),
}))

afterEach(() => {
  cleanup()
  state.sender = null
  state.mine = null
  state.gifts = null
  state.username = null
  backup.needed = false
  backup.chain = () => Promise.resolve(false)
  flags.crosschain = false
  vi.clearAllMocks()
  confirmLeave.mockReturnValue(true)
  localStorage.clear()
})

function view(): CampaignView {
  return {
    address: FUNDIT,
    symbol: 'USDC',
    summary: {
      creator: ME,
      token: TOKENS.USDC.address,
      goal: 1000_000000n,
      raised: 250_000000n,
      available: 0n,
      withdrawn: 0n,
      closed: false,
      donationFeeBps: 100,
      withdrawFeeBps: 100,
      createdAt: 1760000000n,
      createdAtBlock: 1n,
      backup: '0x0000000000000000000000000000000000000000',
      recoveryReadyAt: 0n,
      meta: { title: 'Clean water', description: '', imageUrl: '', links: [] },
    },
  }
}

function signIn(kind: Sender['kind'] = 'passkey') {
  state.sender = { kind, address: ME, send: vi.fn() }
}

function Where() {
  const l = useLocation()
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>
}

function renderProfile(path = '/me') {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Profile />
        <Link to="/me?add=1">Elsewhere Add money link</Link>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const where = () => screen.getByTestId('where').textContent
const addPanel = () => screen.queryByRole('region', { name: 'Add money' })
const sendPanel = () => screen.queryByRole('region', { name: 'Send money out' })
// The two main buttons sit in the balance card. The Send form has its own Send button, so look only there.
const toggle = (name: 'Add money' | 'Send') => within(screen.getByRole('region', { name: 'Your Fundit account' })).getByRole('button', { name })

describe('My page signed out', () => {
  // Signed out there is no address to look up, so the page asks to sign in with a passkey instead of loading forever.
  it('asks to sign in and opens the passkey sign-in dialog', async () => {
    const user = renderProfile()
    expect(screen.getByText('Sign in to see your Fundits and the donations you made.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Start a Fundit' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(within(screen.getByRole('dialog', { name: 'Sign in' })).getByRole('button', { name: 'Sign in with your passkey' })).toBeTruthy()
  })
})

describe('My page balance card', () => {
  it('shows the username, the short address with Copy, both balances and the two main buttons', async () => {
    signIn()
    state.username = 'ana.phone'
    const user = renderProfile()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const card = screen.getByRole('region', { name: 'Your Fundit account' })
    expect(within(card).getByText('ana.phone')).toBeTruthy()
    expect(within(card).getByText('0x0000...00cC')).toBeTruthy()
    expect(await within(card).findByText('12.50')).toBeTruthy()
    expect(within(card).getByText('3.00')).toBeTruthy()
    expect(within(card).getAllByRole('term').map((t) => t.textContent)).toEqual(['USDC', 'EURC'])
    // AddressChip names its button "Copy address"; only the word Copy shows.
    await user.click(within(card).getByRole('button', { name: 'Copy address' }))
    expect(writeText).toHaveBeenCalledWith(ME)
    expect(within(card).getByRole('button', { name: 'Add money' }).getAttribute('aria-expanded')).toBe('false')
    expect(within(card).getByRole('button', { name: 'Send' }).getAttribute('aria-expanded')).toBe('false')
  })

  // The old card was a dark gradient with heavy figures that ran together. The card is now a plain raised Card, and
  // each balance is a large Stat figure in tabular digits, so the numbers line up and stay apart.
  it('account card shows balances as Stat figures with no gradient class', async () => {
    signIn()
    renderProfile()
    const card = screen.getByRole('region', { name: 'Your Fundit account' })
    expect(card.classList.contains('ui-card-raised')).toBe(true)
    expect(card.className).not.toMatch(/gradient|dash-card/)
    for (const path of ['./Profile.css', '../components/ui/Card.css']) {
      expect(readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')).not.toMatch(/gradient/)
    }
    expect(await within(card).findByText('12.50')).toBeTruthy()
    const stats = [...card.querySelectorAll('.ui-stat')]
    expect(stats).toHaveLength(2)
    for (const stat of stats) expect(stat.classList.contains('ui-stat-lg')).toBe(true)
    expect(stats.map((s) => s.querySelector('.ui-stat-value')?.textContent)).toEqual(['12.50', '3.00'])
    expect(stats.map((s) => s.querySelector('.ui-stat-label')?.textContent)).toEqual(['USDC', 'EURC'])
  })

  it('names the card Your Fundit account when the username is not known on this browser', () => {
    signIn()
    renderProfile()
    expect(within(screen.getByRole('region', { name: 'Your Fundit account' })).getByText('Fundit account')).toBeTruthy()
  })
})

describe('My page Add money and Send panels', () => {
  // The panel opens in place, under the buttons, and the address bar says so, so the state survives a reload.
  it('opens and closes the Add money panel from its button', async () => {
    signIn()
    const user = renderProfile()
    expect(addPanel()).toBeNull()
    await user.click(toggle('Add money'))
    expect(toggle('Add money').getAttribute('aria-expanded')).toBe('true')
    const panel = addPanel()!
    expect(document.getElementById(toggle('Add money').getAttribute('aria-controls')!)!.contains(panel)).toBe(true)
    expect(within(panel).queryAllByRole('tab')).toEqual([])
    expect(within(panel).getByText('Card and bank coming soon.')).toBeTruthy()
    expect(where()).toBe('/me?add=1')
    await user.click(screen.getByRole('button', { name: 'Close Add money' }))
    expect(addPanel()).toBeNull()
    expect(toggle('Add money').getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle('Add money'))
    expect(where()).toBe('/me')
  })

  // Every Add money link in the app points here: low balance prompts, the fee errors and the account menu.
  it('opens the Add money panel from /me?add=1', () => {
    signIn()
    renderProfile('/me?add=1')
    expect(addPanel()).toBeTruthy()
    expect(sendPanel()).toBeNull()
  })

  it('opens the Send panel from /me?send=1 with the Send money out form', () => {
    signIn()
    renderProfile('/me?send=1')
    expect(sendPanel()).toBeTruthy()
    expect(within(sendPanel()!).getByLabelText('Recipient')).toBeTruthy()
    expect(addPanel()).toBeNull()
  })

  // The Send form's own "Add money" link goes to /me?add=1 while the dashboard is open: the panel switches.
  it('switches to Add money when a link to /me?add=1 is followed on the dashboard', async () => {
    signIn()
    const user = renderProfile('/me?send=1')
    await user.click(screen.getByRole('link', { name: 'Elsewhere Add money link' }))
    expect(addPanel()).toBeTruthy()
    expect(sendPanel()).toBeNull()
  })

  // Closing must not reset a send: a transfer in flight keeps its status and lock until it settles.
  it('keeps the Send form state when the panel is closed and opened again', async () => {
    signIn()
    const user = renderProfile()
    await user.click(toggle('Send'))
    await user.type(within(sendPanel()!).getByLabelText('Amount'), '4')
    await user.click(toggle('Send'))
    expect(sendPanel()).toBeNull()
    await user.click(toggle('Send'))
    expect((within(sendPanel()!).getByLabelText('Amount') as HTMLInputElement).value).toBe('4')
  })

  // The real guarantee: a send that is still going keeps its Sending state and lock after the panel closes, so
  // reopening it can never start the same send again.
  it('keeps a send in flight locked after the panel is closed and opened again', async () => {
    const send = vi.fn((): Promise<TxResult> => new Promise(() => {}))
    state.sender = { kind: 'passkey', address: ME, send }
    const user = renderProfile()
    await user.click(toggle('Send'))
    const panel = sendPanel()!
    await within(panel).findByText(/You have 12.50 USDC/)
    await user.type(within(panel).getByLabelText('Amount'), '1')
    await user.type(within(panel).getByLabelText('Recipient'), '0x2222222222222222222222222222222222222222')
    await user.click(within(panel).getByRole('button', { name: 'Send' }))
    await within(panel).findByRole('button', { name: 'Sending...' })
    expect(send).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Close Send' }))
    expect(sendPanel()).toBeNull()
    await user.click(toggle('Send'))
    const again = sendPanel()!
    expect((within(again).getByRole('button', { name: 'Sending...' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(again).getByLabelText('Amount').closest('fieldset')!.disabled).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
  })

  // The close button is drawn at the top right, so it comes first in the Tab order too. Escape closes as well.
  it('puts Close first in the panel and closes on Escape, returning focus to the button', async () => {
    signIn()
    const user = renderProfile()
    await user.click(toggle('Add money'))
    const close = screen.getByRole('button', { name: 'Close Add money' })
    const firstTab = within(addPanel()!).getByRole('button', { name: 'Copy address' })
    expect(close.compareDocumentPosition(firstTab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    firstTab.focus()
    await user.keyboard('{Escape}')
    expect(addPanel()).toBeNull()
    expect(document.activeElement).toBe(toggle('Add money'))
  })

  it('shows one panel at a time', async () => {
    signIn()
    const user = renderProfile()
    await user.click(toggle('Add money'))
    await user.click(toggle('Send'))
    expect(addPanel()).toBeNull()
    expect(sendPanel()).toBeTruthy()
    expect(where()).toBe('/me?send=1')
  })
})

describe('My page recovery key banner', () => {
  const BANNER = 'Save a recovery key so you never lose this account'

  it('shows the banner while no recovery key is saved, and Save now opens the recovery key flow with no Later', async () => {
    signIn()
    backup.needed = true
    const user = renderProfile()
    expect(await screen.findByText(BANNER)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Save now' }))
    expect(screen.getByRole('heading', { name: 'Add a recovery key' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Show my recovery key' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Later' })).toBeNull()
  })

  // On a new browser there is no flag yet. The chain decides: a second owner on the account is the recovery key.
  it('shows no banner when the chain shows a second owner, and none while the read runs', async () => {
    signIn()
    backup.needed = true
    let answer: (v: boolean) => void = () => {}
    backup.chain = () => new Promise((r) => (answer = r))
    renderProfile()
    await screen.findByText('12.50')
    expect(screen.queryByText(BANNER)).toBeNull()
    answer(true)
    await screen.findByText('12.50')
    expect(screen.queryByText(BANNER)).toBeNull()
  })

  // A failed read must never hide the prompt or block the page. The browser's flag decides then.
  it('shows the banner when the chain read fails', async () => {
    signIn()
    backup.needed = true
    backup.chain = () => Promise.reject(new Error('rpc down'))
    renderProfile()
    expect(await screen.findByText(BANNER)).toBeTruthy()
  })

  // A wallet account has the wallet's own backup. A recovery key belongs to passkey accounts only.
  it('a wallet account shows no recovery key banner or row', async () => {
    signIn('wallet')
    backup.needed = true
    const user = renderProfile()
    expect(screen.queryByRole('region', { name: 'Recovery key' })).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Account' }))
    const panel = screen.getByRole('tabpanel', { name: 'Account' })
    expect(within(panel).queryByRole('heading', { name: 'Recovery key' })).toBeNull()
    expect(within(panel).queryByText('Not saved yet')).toBeNull()
  })

  it('shows no banner once a recovery key is saved', () => {
    signIn()
    renderProfile()
    expect(screen.queryByText(BANNER)).toBeNull()
  })
})

describe('My page tabs', () => {
  it('has Your Fundits, Your gifts and Account tabs, starting on Your Fundits', () => {
    signIn()
    renderProfile()
    const list = screen.getByRole('tablist', { name: 'My page' })
    expect(within(list).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Your Fundits', 'Your gifts', 'Account'])
    expect(within(list).getByRole('tab', { name: 'Your Fundits' }).getAttribute('aria-selected')).toBe('true')
  })

  it('moves between the tabs with the arrow keys', async () => {
    signIn()
    const user = renderProfile()
    screen.getByRole('tab', { name: 'Your Fundits' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Your gifts' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel', { name: 'Your gifts' })).toBeTruthy()
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Account' }))
  })

  // Each Fundit card shows its progress, with Manage and Share outside the card's own link.
  it('lists Your Fundits with a Manage link, a Share button and Start a Fundit', async () => {
    signIn()
    state.mine = Promise.resolve([view()])
    const user = renderProfile()
    const panel = screen.getByRole('tabpanel', { name: 'Your Fundits' })
    const manage = await within(panel).findByRole('link', { name: 'Manage Clean water' })
    expect(manage.getAttribute('href')).toBe(`/manage/${FUNDIT}`)
    expect(within(panel).getByText('250.00 USDC')).toBeTruthy()
    expect(within(panel).getByRole('link', { name: 'Start a Fundit' }).getAttribute('href')).toBe('/create')
    const share = within(panel).getByRole('button', { name: 'Share Clean water' })
    expect(share.closest('a')).toBeNull()
    await user.click(share)
    expect(screen.getByRole('dialog', { name: 'Share this Fundit' })).toBeTruthy()
  })

  // "Hide my name" gifts are public on chain, so the label says the name was hidden, not that the gift is anonymous.
  it('labels a gift made with Hide my name as Given with name hidden, without the marker', async () => {
    signIn()
    state.gifts = [
      {
        kind: 'donation',
        campaign: FUNDIT,
        blockNumber: 1n,
        txHash: `0x${'ab'.repeat(32)}`,
        logIndex: 0,
        data: { donor: ME, amount: 5_000000n, tip: 0n, message: '[anon]good luck' },
      },
    ]
    const user = renderProfile()
    await user.click(screen.getByRole('tab', { name: 'Your gifts' }))
    const panel = screen.getByRole('tabpanel', { name: 'Your gifts' })
    expect(await within(panel).findByText('Given with name hidden')).toBeTruthy()
    expect(within(panel).getByText('5.00 USDC')).toBeTruthy()
    expect(within(panel).getByRole('link', { name: 'Clean water' }).getAttribute('href')).toBe(`/c/${FUNDIT}`)
    expect(within(panel).getByText(new Date(1760000000 * 1000).toLocaleString())).toBeTruthy()
    expect(within(panel).getByText('good luck')).toBeTruthy()
    expect(document.body.textContent).not.toContain('[anon]')
    expect(document.body.textContent).not.toContain('Given anonymously')
  })

  // Gifts come only from the Fundit account on Arc, so the list must not say they can come from other chains.
  it('describes the gifts window in time, never blocks or other chains', async () => {
    signIn()
    flags.crosschain = true
    const user = renderProfile()
    await user.click(screen.getByRole('tab', { name: 'Your gifts' }))
    expect(screen.getByText(/This list covers about the last day on Arc\./)).toBeTruthy()
    expect(screen.queryByText(/blocks|other chains/)).toBeNull()
  })
})

describe('My page Account tab', () => {
  async function openAccount() {
    const user = renderProfile()
    await user.click(screen.getByRole('tab', { name: 'Account' }))
    return { user, panel: screen.getByRole('tabpanel', { name: 'Account' }) }
  }

  it('says Not saved yet with Save now while no recovery key is saved', async () => {
    signIn()
    backup.needed = true
    const { user, panel } = await openAccount()
    expect(await within(panel).findByText('Not saved yet')).toBeTruthy()
    await user.click(within(panel).getByRole('button', { name: 'Save now' }))
    expect(screen.getByRole('heading', { name: 'Add a recovery key' })).toBeTruthy()
  })

  it('says Recovery key saved once one is saved', async () => {
    signIn()
    const { panel } = await openAccount()
    expect(within(panel).getByText('Recovery key saved')).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'Save now' })).toBeNull()
  })

  it('shows the passkey username and the full account address with Copy and an explorer link', async () => {
    signIn()
    state.username = 'ana.phone'
    const { panel } = await openAccount()
    expect(within(panel).getByText('ana.phone')).toBeTruthy()
    expect(within(panel).getByText(ME)).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'Copy address' })).toBeTruthy()
    expect(within(panel).getByRole('link', { name: 'View on the Arc explorer' }).getAttribute('href')).toBe(`${EXPLORER_URL}/address/${ME}`)
  })

  // The section says how the person signs in, whatever the kind of account.
  it('the Account tab heading is Sign-in and shows the short wallet address', async () => {
    signIn('wallet')
    const { panel } = await openAccount()
    expect(within(panel).getByRole('heading', { name: 'Sign-in' })).toBeTruthy()
    expect(within(panel).queryByRole('heading', { name: 'Passkey' })).toBeNull()
    expect(within(panel).getByText('0x0000...00cC').closest('p')?.textContent).toBe('Wallet: 0x0000...00cC')
  })

  // A transfer started before the cross-chain flag went off may still arrive. Its row stays in view.
  it('tracks a transfer on its way to the account, even with cross-chain off', async () => {
    signIn()
    localStorage.setItem(
      'fundit.pendingBridges',
      JSON.stringify([{ kind: 'submitted', id: 's-1', campaign: ME.toLowerCase(), srcDomain: 6, amount: '25', createdAt: Date.now() }]),
    )
    const { panel } = await openAccount()
    expect(within(panel).getByText(/25 USDC from Base: Submitted/)).toBeTruthy()
    expect(within(panel).queryByText('No transfers on their way.')).toBeNull()
  })

  it('says when no transfers are on their way', async () => {
    signIn()
    const { panel } = await openAccount()
    expect(within(panel).getByText('No transfers on their way.')).toBeTruthy()
  })

  // Sign out ends the session and drops a wallet connected for Add money, after the same leave question as the menu.
  it('signs out through the leave guard', async () => {
    signIn()
    const { user, panel } = await openAccount()
    confirmLeave.mockReturnValueOnce(false)
    await user.click(within(panel).getByRole('button', { name: 'Sign out' }))
    expect(confirmLeave).toHaveBeenCalledTimes(1)
    expect(logoutPasskey).not.toHaveBeenCalled()
    expect(disconnect).not.toHaveBeenCalled()
    await user.click(within(panel).getByRole('button', { name: 'Sign out' }))
    expect(logoutPasskey).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})

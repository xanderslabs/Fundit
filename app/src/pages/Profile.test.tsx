import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOKENS } from '../config'
import type { CampaignView } from '../lib/campaigns'
import type { Sender } from '../lib/sender'
import { Profile } from './Profile'

// VITE_CROSSCHAIN now means Add money from another chain. Gifts never come from another chain.
const flags = vi.hoisted(() => ({ crosschain: false }))
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  get CROSSCHAIN_ENABLED() {
    return flags.crosschain
  },
}))

const state: { sender: Sender | null; mine: Promise<CampaignView[]> | null; gifts: unknown[] | null } = { sender: null, mine: null, gifts: null }
vi.mock('../hooks/useSender', () => ({ useSender: () => state.sender }))
// AppKit is mocked only to prove My page never opens it. It opens only inside Add money.
const openWallet = vi.hoisted(() => vi.fn())
vi.mock('@reown/appkit/react', () => ({ useAppKit: () => ({ open: openWallet }) }))
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
vi.mock('../hooks/useActivity', () => ({ blockTimes: async () => new Map() }))
vi.mock('../hooks/useName', () => ({ useName: () => ({ data: undefined }) }))
const backup = vi.hoisted(() => ({ needed: false, chain: (): Promise<boolean> => Promise.resolve(false) }))
vi.mock('../lib/passkey', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/passkey')>()),
  usePasskeySession: () => (backup.needed ? { address: '0x00000000000000000000000000000000000000cC', credentialId: 'c' } : null),
  useBackupNeeded: () => backup.needed,
  useBackupPending: () => false,
  syncBackupFromChain: () => backup.chain(),
  canPayBackupGas: async () => true,
}))

afterEach(() => {
  cleanup()
  state.sender = null
  state.mine = null
  state.gifts = null
  backup.needed = false
  backup.chain = () => Promise.resolve(false)
  flags.crosschain = false
})

function renderProfile() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Profile />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Profile', () => {
  // Later only puts off the prompt after sign-up. My page keeps asking until a recovery key is saved.
  it('shows the backup prompt for a passkey account without a backup, with no Later', async () => {
    backup.needed = true
    state.sender = { kind: 'passkey', address: '0x00000000000000000000000000000000000000cC', send: vi.fn() }
    renderProfile()
    expect(await screen.findByRole('heading', { name: 'Add a recovery key' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show my recovery key' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Later' })).toBeNull()
  })

  // On a new browser there is no flag yet. The chain decides: a second owner on the account is the recovery key.
  it('shows no backup prompt when the chain shows a second owner', async () => {
    backup.needed = true
    let answer: (v: boolean) => void = () => {}
    backup.chain = () => new Promise((r) => (answer = r))
    state.sender = { kind: 'passkey', address: '0x00000000000000000000000000000000000000cC', send: vi.fn() }
    renderProfile()
    await screen.findByRole('heading', { name: 'Send money out' })
    // While the read runs, the prompt waits rather than flashing up and away.
    expect(screen.queryByRole('heading', { name: 'Add a recovery key' })).toBeNull()
    answer(true)
    await screen.findByText('12.50 USDC and 3.00 EURC')
    expect(screen.queryByRole('heading', { name: 'Add a recovery key' })).toBeNull()
  })

  // A failed read must never hide the prompt or block the page. The browser's flag decides then.
  it('shows the backup prompt when the chain read fails', async () => {
    backup.needed = true
    backup.chain = () => Promise.reject(new Error('rpc down'))
    state.sender = { kind: 'passkey', address: '0x00000000000000000000000000000000000000cC', send: vi.fn() }
    renderProfile()
    expect(await screen.findByRole('heading', { name: 'Add a recovery key' })).toBeTruthy()
  })

  it('shows no backup prompt once a backup exists', () => {
    state.sender = { kind: 'passkey', address: '0x00000000000000000000000000000000000000cC', send: vi.fn() }
    renderProfile()
    expect(screen.queryByRole('heading', { name: 'Add a recovery key' })).toBeNull()
  })

  // Signed out there is no address to look up, so the page asks to sign in with a passkey instead of loading forever.
  it('signed out, asks to sign in and opens the passkey sign-in dialog', async () => {
    renderProfile()
    expect(screen.getByText('Sign in to see your Fundits and the donations you made.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Start a Fundit' })).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }))
    expect(within(screen.getByRole('dialog', { name: 'Sign in' })).getByRole('button', { name: 'Sign in with your passkey' })).toBeTruthy()
    expect(openWallet).not.toHaveBeenCalled()
  })

  // My page is where a signed-in person starts a new fundraiser, so the button sits at the top.
  it('shows Start a Fundit near the top when signed in', () => {
    state.sender = { kind: 'eoa', address: '0x1111111111111111111111111111111111111111', send: vi.fn() }
    renderProfile()
    const head = screen.getByRole('heading', { level: 1 }).closest('section')!
    const start = head.querySelector('a[href="/create"]')
    expect(start?.textContent).toBe('Start a Fundit')
  })

  // A block count means nothing to most people. The window is about a day of Arc blocks.
  it('describes the donations window in time, not blocks', () => {
    state.sender = { kind: 'eoa', address: '0x1111111111111111111111111111111111111111', send: vi.fn() }
    renderProfile()
    expect(screen.getByText(/This list covers about the last day on Arc\./)).toBeTruthy()
    expect(screen.queryByText(/200,000 blocks/)).toBeNull()
  })

  // Gifts come only from the Fundit account on Arc, so My page must not say they can come from other chains.
  it('does not say gifts can come from other chains, even with cross-chain Add money on', () => {
    flags.crosschain = true
    state.sender = { kind: 'passkey', address: '0x1111111111111111111111111111111111111111', send: vi.fn() }
    renderProfile()
    expect(screen.getByText(/This list covers about the last day on Arc\./)).toBeTruthy()
    expect(screen.queryByText(/other chains/)).toBeNull()
  })

  // The organiser shares from My page too, so each of their Fundits has its own Share button, outside the
  // card's link so it does not open the Fundit page.
  it('has a Share button for each Fundit that opens the share dialog', async () => {
    const me = '0x1111111111111111111111111111111111111111'
    state.sender = { kind: 'eoa', address: me, send: vi.fn() }
    const view: CampaignView = {
      address: '0x00000000000000000000000000000000000000a1',
      symbol: 'USDC',
      summary: {
        creator: me,
        token: TOKENS.USDC.address,
        goal: 1000000000n,
        raised: 0n,
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
    state.mine = Promise.resolve([view])
    renderProfile()
    const share = await screen.findByRole('button', { name: 'Share Clean water' })
    expect(share.closest('a')).toBeNull()
    await userEvent.click(share)
    const dialog = screen.getByRole('dialog', { name: 'Share this Fundit' })
    expect(within(dialog).getByText(/^I started a Fundit for Clean water\. Every gift helps: /)).toBeTruthy()
  })

  it('labels the signed-in donor\'s own anonymous gift as Given anonymously, without the marker', async () => {
    state.sender = { kind: 'eoa', address: '0x1111111111111111111111111111111111111111', send: vi.fn() }
    state.gifts = [
      {
        kind: 'donation',
        campaign: '0x00000000000000000000000000000000000000a1',
        blockNumber: 1n,
        txHash: `0x${'ab'.repeat(32)}`,
        logIndex: 0,
        data: { donor: state.sender.address, amount: 5_000000n, tip: 0n, message: '[anon]good luck' },
      },
    ]
    renderProfile()
    expect(await screen.findByText('Given anonymously')).toBeTruthy()
    expect(screen.getByText('good luck')).toBeTruthy()
    expect(document.body.textContent).not.toContain('[anon]')
  })

  // A passkey account only has the money that was added to it, so My page shows what is there and how to add more.
  it('shows the Fundit account balance and an Add money button for a passkey account', async () => {
    state.sender = { kind: 'passkey', address: '0x00000000000000000000000000000000000000cC', send: vi.fn() }
    renderProfile()
    expect(await screen.findByText('12.50 USDC and 3.00 EURC')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Add money' }).getAttribute('href')).toBe('/add-money')
  })

  it('shows no Add money button for a regular wallet', () => {
    state.sender = { kind: 'eoa', address: '0x1111111111111111111111111111111111111111', send: vi.fn() }
    renderProfile()
    expect(screen.queryByRole('link', { name: 'Add money' })).toBeNull()
  })

  // Money in a Fundit account can only leave through Fundit, so a passkey account needs a way out.
  it('shows Send money out for a passkey account only', () => {
    state.sender = { kind: 'passkey', address: '0x00000000000000000000000000000000000000cC', send: vi.fn() }
    renderProfile()
    expect(screen.getByRole('heading', { name: 'Send money out' })).toBeTruthy()
    cleanup()
    state.sender = { kind: 'eoa', address: '0x1111111111111111111111111111111111111111', send: vi.fn() }
    renderProfile()
    expect(screen.queryByRole('heading', { name: 'Send money out' })).toBeNull()
  })
})

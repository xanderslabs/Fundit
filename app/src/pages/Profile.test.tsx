import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOKENS } from '../config'
import type { CampaignView } from '../lib/campaigns'
import type { Sender } from '../lib/sender'
import { Profile } from './Profile'

const state: { sender: Sender | null; mine: Promise<CampaignView[]> | null; gifts: unknown[] | null } = { sender: null, mine: null, gifts: null }
vi.mock('../hooks/useSender', () => ({ useSender: () => state.sender }))
vi.mock('@reown/appkit/react', () => ({ useAppKit: () => ({ open: () => {} }) }))
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
vi.mock('../hooks/useActivity', () => ({ blockTimes: async () => new Map() }))
vi.mock('../hooks/useName', () => ({ useName: () => ({ data: undefined }) }))
const backup = vi.hoisted(() => ({ needed: false }))
vi.mock('../lib/passkey', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/passkey')>()),
  usePasskeySession: () => (backup.needed ? { address: '0x00000000000000000000000000000000000000cC', credentialId: 'c' } : null),
  useBackupNeeded: () => backup.needed,
}))

afterEach(() => {
  cleanup()
  state.sender = null
  state.mine = null
  state.gifts = null
  backup.needed = false
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
  it('shows the backup prompt for a passkey account without a backup, with no Later', () => {
    backup.needed = true
    state.sender = { kind: 'passkey', address: '0x00000000000000000000000000000000000000cC', send: vi.fn() }
    renderProfile()
    expect(screen.getByRole('heading', { name: 'Add a backup' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add a backup' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Later' })).toBeNull()
  })

  it('shows no backup prompt once a backup exists', () => {
    state.sender = { kind: 'passkey', address: '0x00000000000000000000000000000000000000cC', send: vi.fn() }
    renderProfile()
    expect(screen.queryByRole('heading', { name: 'Add a backup' })).toBeNull()
  })

  // With no wallet there is no address to look up, so the page asks to connect instead of loading forever.
  it('asks to sign in when no wallet is connected', () => {
    renderProfile()
    expect(screen.getByText('Sign in to see your Fundits and the donations you made.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Start a Fundit' })).toBeNull()
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
})

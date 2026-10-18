import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type Address, getAddress, type Hex, type TransactionReceipt } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOKENS } from '../config'
import type { CampaignView } from '../lib/campaigns'
import type { TxResult } from '../lib/sender'
import { UnifiedSpendError } from '../lib/unified'
import { UnifiedDonate } from './UnifiedDonate'

const ME = '0x1111111111111111111111111111111111111111' as Address
const CAMPAIGN = getAddress('0x00000000000000000000000000000000000000a1')
const ARC_TX = `0x${'ef'.repeat(32)}` as Hex

const m = vi.hoisted(() => ({
  balance: { total: 0n, byChain: [] as { chain: string; amount: bigint }[] },
  // Circle's fee on every chain, as the estimate would report it.
  fee: 50_000n,
  estimates: 0,
  donate: vi.fn(),
  transfer: vi.fn(),
  receipt: async (): Promise<TxResult> => {
    throw new Error('no receipt wait planned')
  },
}))

vi.mock('wagmi', () => ({
  useConnection: () => ({ isConnected: true, address: ME, connector: { getProvider: async () => ({ request: async () => [] }) } }),
}))
vi.mock('../lib/unified', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/unified')>()),
  fetchUnifiedBalance: async () => m.balance,
  estimateReserves: async (p: { byChain: { chain: string }[] }) => {
    m.estimates++
    return new Map(p.byChain.map((c) => [c.chain, m.fee]))
  },
  // The real allocation logic, with the estimated reserves standing in for Circle's per-allocation estimate.
  planSpend: async (p: { byChain: { chain: string; amount: bigint }[]; amount: bigint; reserves: Map<string, bigint> }) => {
    const { pickAllocations } = await importOriginal<typeof import('../lib/unified')>()
    return { allocations: pickAllocations(p.byChain, p.amount, p.reserves), reserves: p.reserves }
  },
  donateFromUnified: (p: unknown) => m.donate(p),
  fetchGatewayTransfer: (id: string) => m.transfer(id),
}))
vi.mock('../lib/sender', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/sender')>()),
  waitForResult: () => m.receipt(),
}))

const view: CampaignView = {
  address: CAMPAIGN,
  symbol: 'USDC',
  summary: {
    creator: '0x2222222222222222222222222222222222222222',
    token: TOKENS.USDC.address,
    goal: 1000_000000n,
    raised: 0n,
    available: 0n,
    withdrawn: 0n,
    closed: false,
    donationFeeBps: 250,
    withdrawFeeBps: 250,
    createdAt: 1760000000n,
    createdAtBlock: 1n,
    backup: '0x0000000000000000000000000000000000000000',
    recoveryReadyAt: 0n,
    meta: { title: 'Clean water', description: '', imageUrl: '', links: [] },
  },
}

function renderIt() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UnifiedDonate view={view} />
    </QueryClientProvider>,
  )
}

const donateButton = () => screen.getByRole('button', { name: 'Give' }) as HTMLButtonElement

async function typeAndDonate(amount: string) {
  const user = userEvent.setup()
  const input = await screen.findByLabelText('Amount')
  await waitFor(() => expect(input.matches(':disabled')).toBe(false))
  await user.type(input, amount)
  await waitFor(() => expect(donateButton().disabled).toBe(false))
  await user.click(donateButton())
  return user
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
  m.fee = 50_000n
  m.estimates = 0
  m.balance = { total: 0n, byChain: [] }
  m.donate.mockReset()
  m.transfer.mockReset()
  m.receipt = async () => {
    throw new Error('no receipt wait planned')
  }
})

describe('UnifiedDonate', () => {
  it('says there is no unified balance yet and links to the Gateway docs', async () => {
    renderIt()
    expect(await screen.findByText('No unified balance yet.')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Circle Gateway/ }).getAttribute('href')).toBe('https://developers.circle.com/gateway')
    expect(donateButton().disabled).toBe(true)
  })

  // Each chain keeps its fee back, the rest is split largest first, and success waits for the Arc receipt.
  it('spends the amount from the largest balances, leaving each chain its fee, and confirms the Arc mint', async () => {
    m.balance = {
      total: 40_000000n,
      byChain: [
        { chain: 'Base', amount: 10_000000n },
        { chain: 'Arbitrum', amount: 30_000000n },
      ],
    }
    m.donate.mockResolvedValue({ txHash: ARC_TX })
    m.receipt = async () => ({ status: 'success', hash: ARC_TX, receipt: { status: 'success' } as TransactionReceipt })
    renderIt()
    await typeAndDonate('35')
    expect(await screen.findByText(/Thank you/)).toBeTruthy()
    expect(m.donate).toHaveBeenCalledTimes(1)
    expect(m.donate.mock.calls[0]![0]).toMatchObject({
      campaign: CAMPAIGN,
      amount: '35',
      allocations: [
        { chain: 'Arbitrum', amount: '29.95' },
        { chain: 'Base', amount: '5.05' },
      ],
      account: ME,
    })
    expect(screen.getByRole('link', { name: /explorer/i }).getAttribute('href')).toBe(`https://explorer.arc.io/tx/${ARC_TX}`)
    expect(localStorage.getItem('fundit.pendingBridges')).toBeNull()
  })

  // Asking Circle for more than the balance minus fees only fails after the donor signed.
  it('blocks an amount the fees would push over the balance, and says how much can be sent', async () => {
    m.balance = { total: 40_000000n, byChain: [{ chain: 'Base', amount: 40_000000n }] }
    renderIt()
    // Before an amount, the static fee table sets the limit (Base: 0.01 gas, 0.201 forwarder, 0.5 bps), shown
    // to the unit.
    expect(await screen.findByText(/Up to 39\.787 USDC can be sent after fees/)).toBeTruthy()
    const user = userEvent.setup()
    const input = screen.getByLabelText('Amount')
    await waitFor(() => expect(input.matches(':disabled')).toBe(false))
    await user.type(input, '40')
    // Once an amount is typed, Circle's estimate (0.05 here) replaces it.
    expect(await screen.findByText(/Up to 39\.95 USDC can be sent after fees/)).toBeTruthy()
    expect(screen.getByText(/more than can be sent from your unified balance after Circle's fees/)).toBeTruthy()
    expect(donateButton().disabled).toBe(true)
    await user.clear(input)
    await user.type(input, '39.95')
    await waitFor(() => expect(donateButton().disabled).toBe(false))
  })

  // Circle accepted the transfer but the kit stopped waiting. The mint may still land, so a second donation
  // must wait for a check, and the check only reads Circle's transfer status.
  it('blocks a new donation when the kit stops waiting, and Check again reads the transfer', async () => {
    m.balance = { total: 40_000000n, byChain: [{ chain: 'Base', amount: 40_000000n }] }
    m.donate.mockRejectedValue(
      new UnifiedSpendError(
        true,
        Object.assign(new Error('Forwarder polling timed out'), { name: 'NETWORK_TIMEOUT', cause: { trace: { transferId: 't-9' } } }),
      ),
    )
    m.transfer.mockResolvedValue({ status: 'pending' })
    renderIt()
    const user = await typeAndDonate('5')
    expect(await screen.findByText(/not confirmed yet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Give' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(m.transfer).toHaveBeenCalledWith('t-9'))
    expect(await screen.findByText(/not confirmed yet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Give' })).toBeNull()
    expect(m.donate).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem('fundit.pendingBridges')!)[0]).toMatchObject({ kind: 'unified', amount: '5', transferId: 't-9' })
  })

  // A Gateway API error while polling says nothing about whether Circle holds the transfer. It must not
  // re-open the form, and with no transfer id there is nothing to check, only a confirmed Start over.
  it('stays blocked on a Gateway error after signing, with no transfer id', async () => {
    m.balance = { total: 40_000000n, byChain: [{ chain: 'Base', amount: 40_000000n }] }
    m.donate.mockRejectedValue(
      new UnifiedSpendError(true, Object.assign(new Error('Gateway API error: busy'), { name: 'NETWORK_GATEWAY_API_ERROR' })),
    )
    renderIt()
    await typeAndDonate('5')
    expect(await screen.findByText(/not confirmed yet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Give' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
    expect(screen.getByText(/raised amount and your unified balance/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start over' })).toBeTruthy()
  })

  // estimateSpend can make the wallet ask for account access, so Circle's fee estimate waits until the donor
  // has opened this option and typed an amount. The static fee table covers the limit until then.
  it('does not ask Circle for fees on balance load, only once an amount is entered', async () => {
    m.balance = { total: 40_000000n, byChain: [{ chain: 'Base', amount: 40_000000n }] }
    renderIt()
    expect(await screen.findByText(/can be sent after fees/)).toBeTruthy()
    await new Promise((r) => setTimeout(r, 20))
    expect(m.estimates).toBe(0)
    const user = userEvent.setup()
    const input = screen.getByLabelText('Amount')
    await waitFor(() => expect(input.matches(':disabled')).toBe(false))
    await user.type(input, '5')
    await waitFor(() => expect(m.estimates).toBe(1))
  })

  describe('a donation started in another tab', () => {
    const silently = (entry: Record<string, unknown>) =>
      localStorage.setItem('fundit.pendingBridges', JSON.stringify([{ campaign: CAMPAIGN, createdAt: Date.now(), ...entry }]))

    it('blocks at submit when another tab left a unified spend unconfirmed, and sends nothing', async () => {
      m.balance = { total: 40_000000n, byChain: [{ chain: 'Base', amount: 40_000000n }] }
      renderIt()
      const user = userEvent.setup()
      const input = await screen.findByLabelText('Amount')
      await waitFor(() => expect(input.matches(':disabled')).toBe(false))
      await user.type(input, '5')
      await waitFor(() => expect(donateButton().disabled).toBe(false))
      silently({ kind: 'unified', amount: '9', transferId: 't-7' })
      await user.click(donateButton())
      expect(await screen.findByText(/unified balance donation is not confirmed yet/)).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy()
      expect(m.donate).not.toHaveBeenCalled()
    })

    it('blocks at submit when another source is unconfirmed, and sends nothing', async () => {
      m.balance = { total: 40_000000n, byChain: [{ chain: 'Base', amount: 40_000000n }] }
      renderIt()
      const user = userEvent.setup()
      const input = await screen.findByLabelText('Amount')
      await waitFor(() => expect(input.matches(':disabled')).toBe(false))
      await user.type(input, '5')
      await waitFor(() => expect(donateButton().disabled).toBe(false))
      silently({ kind: 'arc', hash: ARC_TX, approve: false })
      await user.click(donateButton())
      expect(await screen.findByText(/Another donation to this Fundit is not confirmed yet/)).toBeTruthy()
      expect(m.donate).not.toHaveBeenCalled()
    })

    it('shows the block live when another tab saves a unified spend', async () => {
      m.balance = { total: 40_000000n, byChain: [{ chain: 'Base', amount: 40_000000n }] }
      renderIt()
      await screen.findByLabelText('Amount')
      silently({ kind: 'unified', amount: '9', transferId: 't-7' })
      window.dispatchEvent(new StorageEvent('storage', { key: 'fundit.pendingBridges' }))
      expect(await screen.findByText(/unified balance donation is not confirmed yet/)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Give' })).toBeNull()
    })
  })

  describe('after a reload', () => {
    const save = (extra: Record<string, unknown>) =>
      localStorage.setItem(
        'fundit.pendingBridges',
        JSON.stringify([{ kind: 'unified', campaign: CAMPAIGN, amount: '5', createdAt: Date.now(), ...extra }]),
      )

    it('restores the block with Check again when Circle gave a transfer id', async () => {
      save({ transferId: 't-3' })
      m.balance = { total: 40_000000n, byChain: [{ chain: 'Base', amount: 40_000000n }] }
      m.transfer.mockResolvedValue({ status: 'failed' })
      renderIt()
      expect(screen.getByText(/not confirmed yet/)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Give' })).toBeNull()
      await userEvent.setup().click(screen.getByRole('button', { name: 'Check again' }))
      expect(await screen.findByText(/Circle could not finish this transfer/)).toBeTruthy()
      expect(m.transfer).toHaveBeenCalledWith('t-3')
      expect(localStorage.getItem('fundit.pendingBridges')).toBeNull()
    })

    it('restores the block with the note and Start over when there is no reference', async () => {
      save({})
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      renderIt()
      expect(screen.getByText(/raised amount and your unified balance/)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
      await userEvent.setup().click(screen.getByRole('button', { name: 'Start over' }))
      expect(screen.getByRole('button', { name: 'Give' })).toBeTruthy()
      expect(localStorage.getItem('fundit.pendingBridges')).toBeNull()
    })
  })

  it("explains a Gateway balance shortfall in plain words", async () => {
    m.balance = { total: 40_000000n, byChain: [{ chain: 'Base', amount: 40_000000n }] }
    m.donate.mockRejectedValue(
      new UnifiedSpendError(true, Object.assign(new Error('Insufficient USDC balance on Base. Available: 40'), { name: 'BALANCE_INSUFFICIENT_TOKEN' })),
    )
    renderIt()
    await typeAndDonate('39')
    expect(await screen.findByText(/does not cover this amount plus Circle's fees/)).toBeTruthy()
    // Refused before Circle accepted anything, so the form opens again.
    expect(screen.getByRole('button', { name: 'Give' })).toBeTruthy()
    expect(localStorage.getItem('fundit.pendingBridges')).toBeNull()
  })
})

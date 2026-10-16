import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type Address, getAddress, type Hex, type TransactionReceipt } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOKENS } from '../config'
import type { CampaignView } from '../lib/campaigns'
import type { TxResult } from '../lib/sender'
import { UnifiedDonate } from './UnifiedDonate'

const ME = '0x1111111111111111111111111111111111111111' as Address
const CAMPAIGN = getAddress('0x00000000000000000000000000000000000000a1')
const ARC_TX = `0x${'ef'.repeat(32)}` as Hex

const m = vi.hoisted(() => ({
  balance: { total: 0n, byChain: [] as { chain: string; amount: bigint }[] },
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

const donateButton = () => screen.getByRole('button', { name: 'Donate' }) as HTMLButtonElement

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

  // The amount is split across chains largest first, and success waits for the Arc receipt of the mint.
  it('spends the amount from the largest balances and confirms the Arc mint before saying thank you', async () => {
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
        { chain: 'Arbitrum', amount: '30' },
        { chain: 'Base', amount: '5' },
      ],
      account: ME,
    })
    expect(screen.getByRole('link', { name: /explorer/i }).getAttribute('href')).toBe(`https://explorer.arc.io/tx/${ARC_TX}`)
  })

  // Circle accepted the transfer but the kit stopped waiting. The mint may still land, so a second donation
  // must wait for a check, and the check only reads Circle's transfer status.
  it('blocks a new donation when the kit stops waiting, and Check again reads the transfer', async () => {
    m.balance = { total: 40_000000n, byChain: [{ chain: 'Base', amount: 40_000000n }] }
    m.donate.mockRejectedValue(Object.assign(new Error('Forwarder polling timed out'), { cause: { trace: { transferId: 't-9' } } }))
    m.transfer.mockResolvedValue({ status: 'pending' })
    renderIt()
    const user = await typeAndDonate('5')
    expect(await screen.findByText(/not confirmed yet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Donate' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(m.transfer).toHaveBeenCalledWith('t-9'))
    expect(await screen.findByText(/not confirmed yet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Donate' })).toBeNull()
    expect(m.donate).toHaveBeenCalledTimes(1)
  })

  it("explains a Gateway balance shortfall in plain words", async () => {
    m.balance = { total: 40_000000n, byChain: [{ chain: 'Base', amount: 40_000000n }] }
    m.donate.mockRejectedValue(Object.assign(new Error('Insufficient USDC balance on Base. Available: 40'), { name: 'BALANCE_INSUFFICIENT_TOKEN' }))
    renderIt()
    await typeAndDonate('40')
    expect(await screen.findByText(/does not cover this amount plus Circle's fees/)).toBeTruthy()
  })
})

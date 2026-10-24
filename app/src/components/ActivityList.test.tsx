import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type Address, decodeFunctionData, getAddress, type Hex, type TransactionReceipt } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { campaignAbi } from '../abi/campaign'
import type { Call, Sender, TxResult } from '../lib/sender'
import { ActivityList } from './ActivityList'

const CAMPAIGN = getAddress('0x00000000000000000000000000000000000000a1')
const ME = '0x1111111111111111111111111111111111111111' as Address
const HASH = `0x${'ab'.repeat(32)}` as Hex

const state: { sender: Sender | null; unaccounted: bigint; items: unknown[] } = { sender: null, unaccounted: 0n, items: [] }

vi.mock('../hooks/useSender', () => ({ useSender: () => state.sender }))
vi.mock('../hooks/useActivity', () => ({
  useActivity: () => ({ isPending: false, isError: false, isSuccess: true, hasNextPage: false, data: { pages: [{ items: state.items, times: new Map() }] } }),
}))
vi.mock('../lib/clients', () => ({
  arcClient: {
    readContract: async (p: { address: Address; functionName: string }) => {
      if (p.functionName === 'unaccounted' && p.address === CAMPAIGN) return state.unaccounted
      throw new Error(`unexpected read ${p.functionName}`)
    },
  },
}))

afterEach(() => {
  cleanup()
  state.sender = null
  state.unaccounted = 0n
  state.items = []
})

const success: TxResult = { status: 'success', hash: HASH, receipt: { status: 'success' } as TransactionReceipt }

function renderList() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ActivityList campaign={CAMPAIGN} createdAtBlock={1n} symbol="USDC" />
    </QueryClientProvider>,
  )
}

// USDC that reaches the campaign without donate() counts in raised() at once, but the activity list only shows it
// after settle() books it. Without this row the money looks missing from the list.
describe('ActivityList cross-chain inflows not counted yet', () => {
  it('shows the amount and a Count it now button that sends settle() through the sender', async () => {
    state.unaccounted = 5_000000n
    const send = vi.fn(async (_calls: Call[]) => success)
    state.sender = { kind: 'wallet', address: ME, send }
    renderList()
    expect(await screen.findByText('5.00 USDC from other chains, not counted yet')).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Count it now' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    const [calls] = send.mock.calls[0]!
    expect(calls).toHaveLength(1)
    expect(calls[0]!.to).toBe(CAMPAIGN)
    expect(decodeFunctionData({ abi: campaignAbi, data: calls[0]!.data }).functionName).toBe('settle')
    expect(await screen.findByText('Counted. It now shows in the list.')).toBeTruthy()
  })

  it('is hidden when nothing is waiting', async () => {
    state.sender = { kind: 'wallet', address: ME, send: vi.fn() }
    renderList()
    expect(await screen.findByText('No activity yet.')).toBeTruthy()
    // Let the unaccounted read settle before checking.
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText(/not counted yet/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Count it now' })).toBeNull()
  })

  it('asks to sign in when signed out', async () => {
    state.unaccounted = 5_000000n
    renderList()
    expect(await screen.findByText('5.00 USDC from other chains, not counted yet')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Count it now' })).toBeNull()
    expect(screen.getByText('Sign in with any Fundit account to count it.')).toBeTruthy()
  })
})

const DONOR = '0x3333333333333333333333333333333333333333'
function donation(message: string) {
  return { kind: 'donation', blockNumber: 1n, txHash: HASH, logIndex: 0, data: { donor: DONOR, amount: 5_000000n, tip: 0n, message } }
}

describe('ActivityList anonymous gifts', () => {
  it('shows Anonymous, no name or address, and the message without the marker', async () => {
    state.items = [donation('[anon]good luck')]
    renderList()
    expect(await screen.findByText('Anonymous')).toBeTruthy()
    expect(screen.getByText('good luck')).toBeTruthy()
    expect(screen.queryByText(/0x3333/)).toBeNull()
    expect(document.body.innerHTML).not.toContain(DONOR.slice(2, 8))
  })

  // The marker is the record, so a donor who typed it by hand is anonymous too. The literal text never shows.
  it('strips the marker and shows Anonymous for a typed prefix', async () => {
    state.items = [donation('[anon]')]
    renderList()
    expect(await screen.findByText('Anonymous')).toBeTruthy()
    expect(document.body.textContent).not.toContain('[anon]')
    expect(document.querySelector('.activity-message')).toBeNull()
  })

  it('shows the donor as usual without the marker', async () => {
    state.items = [donation('hi')]
    renderList()
    expect(await screen.findByText('hi')).toBeTruthy()
    expect(screen.queryByText('Anonymous')).toBeNull()
  })
})

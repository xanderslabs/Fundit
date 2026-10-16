import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { type Address, decodeFunctionData, getAddress, type Hex, pad, type TransactionReceipt } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { campaignAbi } from '../abi/campaign'
import { TOKENS } from '../config'
import type { CampaignView } from '../lib/campaigns'
import type { Call, Sender, TxResult } from '../lib/sender'
import { Manage } from './Manage'

const CAMPAIGN = getAddress('0x00000000000000000000000000000000000000a1')
const CREATOR = getAddress('0x1111111111111111111111111111111111111111') as Address
const STRANGER = getAddress('0x3333333333333333333333333333333333333333') as Address
const HASH = `0x${'ab'.repeat(32)}` as Hex

const state: { view: CampaignView | undefined; sender: Sender | null } = { view: undefined, sender: null }

vi.mock('../hooks/useCampaigns', () => ({
  useCampaign: () => ({ data: state.view, isPending: state.view === undefined, isError: false, refetch: () => {} }),
}))
vi.mock('../hooks/useSender', () => ({ useSender: () => state.sender }))
vi.mock('@reown/appkit/react', () => ({ useAppKit: () => ({ open: () => {} }) }))
vi.mock('../lib/clients', () => ({ arcClient: { readContract: async () => true } }))

function view(over: Partial<CampaignView['summary']> = {}): CampaignView {
  return {
    address: CAMPAIGN,
    symbol: 'USDC',
    summary: {
      creator: CREATOR,
      token: TOKENS.USDC.address,
      goal: 1000_000000n,
      raised: 100_000000n,
      available: 97_500000n,
      withdrawn: 0n,
      closed: false,
      donationFeeBps: 250,
      withdrawFeeBps: 100,
      createdAt: 1760000000n,
      createdAtBlock: 1n,
      backup: '0x0000000000000000000000000000000000000000',
      recoveryReadyAt: 0n,
      meta: { title: 'Clean water', description: 'Wells.', imageUrl: '', links: [] },
      ...over,
    },
  }
}

const success: TxResult = { status: 'success', hash: HASH, receipt: { status: 'success' } as TransactionReceipt }

function fakeSender(kind: Sender['kind'] = 'eoa', address = CREATOR, ...results: TxResult[]) {
  const send = vi.fn(async (_calls: Call[]) => results.shift() ?? success)
  state.sender = { kind, address, send }
  return send
}

function renderPage(client = new QueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/manage/${CAMPAIGN}`]}>
        <Routes>
          <Route path="/manage/:address" element={<Manage />} />
          <Route path="/c/:address" element={<p>Campaign page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return client
}

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
const decode = (data: Hex) => decodeFunctionData({ abi: campaignAbi, data })

afterEach(() => {
  cleanup()
  state.view = undefined
  state.sender = null
  vi.restoreAllMocks()
})

describe('Manage', () => {
  // Only the organiser can sign these calls. Anyone else would only meet reverts, so they go to the public page.
  it('sends a connected non-creator to the campaign page', async () => {
    state.view = view()
    fakeSender('eoa', STRANGER)
    renderPage()
    expect(await screen.findByText('Campaign page')).toBeTruthy()
  })

  it('shows the manage page to the creator', () => {
    state.view = view()
    fakeSender()
    renderPage()
    expect(screen.getByRole('heading', { name: 'Manage fundraiser' })).toBeTruthy()
  })

  // withdraw(0) reverts ZeroAmount. With nothing to take out, the button must not invite a wasted fee.
  it('disables withdraw when nothing is available', () => {
    state.view = view({ available: 0n })
    fakeSender()
    renderPage()
    expect(button('Withdraw').disabled).toBe(true)
    expect(screen.getByText('There is nothing to withdraw yet.')).toBeTruthy()
  })

  it('withdraws to the connected address on Arc by default', async () => {
    state.view = view()
    const send = fakeSender()
    renderPage()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Amount'), '50')
    expect(screen.getByText('49.50 USDC')).toBeTruthy()
    await user.click(button('Withdraw'))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    const [calls] = send.mock.calls[0]!
    expect(decode(calls[0]!.data).args).toEqual([50_000000n, 26, pad(CREATOR, { size: 32 }), 0n, 0, '0x'])
  })

  it('blocks an amount above what is available', async () => {
    state.view = view()
    fakeSender()
    renderPage()
    await userEvent.setup().type(screen.getByLabelText('Amount'), '98')
    expect(screen.getByText(/more than the 97.50 USDC available/)).toBeTruthy()
    expect(button('Withdraw').disabled).toBe(true)
  })

  // A passkey account is a contract at an address on Arc. Nothing promises the same address exists on Base.
  it('warns a passkey sender who pays out to another chain', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
    state.view = view()
    fakeSender('passkey')
    renderPage()
    const warning = 'Your passkey wallet may not exist on that chain. Send to an address you control there.'
    expect(screen.queryByText(warning)).toBeNull()
    await screen.findByRole('option', { name: 'Base' })
    await userEvent.setup().selectOptions(screen.getByLabelText('Send to'), 'Base')
    expect(screen.getByText(warning)).toBeTruthy()
    expect(screen.getByText('Cross-chain payouts are new. Try a small amount first.')).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it('does not warn an ordinary wallet about Base', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
    state.view = view()
    fakeSender('eoa')
    renderPage()
    await screen.findByRole('option', { name: 'Base' })
    await userEvent.setup().selectOptions(screen.getByLabelText('Send to'), 'Base')
    expect(screen.queryByText(/passkey wallet may not exist/)).toBeNull()
    vi.unstubAllGlobals()
  })

  // A withdrawal that timed out may still be mined. Sending again could pay out twice.
  it('blocks a second withdrawal while the first is not confirmed', async () => {
    state.view = view()
    fakeSender('eoa', CREATOR, { status: 'timeout', hash: HASH, completed: 0 })
    renderPage()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Amount'), '10')
    await user.click(button('Withdraw'))
    expect(await screen.findByText(/withdrawal is not confirmed yet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull()
    expect(screen.getByLabelText('Amount').matches(':disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy()
  })

  // After a payout the campaign balance, the activity list and the wallet balance are all stale.
  it('refreshes the campaign, activity and balances after a withdrawal', async () => {
    state.view = view()
    fakeSender()
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    renderPage(client)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Amount'), '10')
    await user.click(button('Withdraw'))
    expect(await screen.findByText(/withdrawal went through/)).toBeTruthy()
    const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey))
    expect(keys).toContain(JSON.stringify(['campaign', CAMPAIGN.toLowerCase()]))
    expect(keys).toContain(JSON.stringify(['activity', CAMPAIGN.toLowerCase()]))
    expect(keys).toContain(JSON.stringify(['donor-funds']))
  })

  // close() is one-way. A slip of the finger must not end the fundraiser.
  it('explains that closing is permanent and asks before closing', async () => {
    state.view = view()
    const send = fakeSender()
    renderPage()
    const text = 'Closing is permanent. Funds that arrive later can still be withdrawn.'
    expect(screen.getByText(text)).toBeTruthy()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    await user.click(button('Close fundraiser'))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(text))
    expect(send).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    await user.click(button('Close fundraiser'))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(decode(send.mock.calls[0]![0][0]!.data).functionName).toBe('close')
  })

  it('saves edits with the validated goal and metadata', async () => {
    state.view = view()
    const send = fakeSender()
    renderPage()
    const user = userEvent.setup()
    const title = screen.getByLabelText('Title') as HTMLInputElement
    expect(title.value).toBe('Clean water')
    expect((screen.getByLabelText('Goal') as HTMLInputElement).value).toBe('1000')
    await user.clear(title)
    await user.type(title, 'Clean water now')
    await user.click(button('Save changes'))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    const { functionName, args } = decode(send.mock.calls[0]![0][0]!.data)
    expect(functionName).toBe('edit')
    expect(args).toEqual([1000_000000n, { title: 'Clean water now', description: 'Wells.', imageUrl: '', links: [] }])
  })

  it('shows a pending recovery with a cancel button', async () => {
    const readyAt = BigInt(Math.floor(Date.now() / 1000) + 3 * 86400)
    state.view = view({ backup: STRANGER, recoveryReadyAt: readyAt })
    const send = fakeSender()
    renderPage()
    expect(screen.getByText(/Your backup started a recovery/)).toBeTruthy()
    await userEvent.setup().click(button('Cancel recovery'))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(decode(send.mock.calls[0]![0][0]!.data).functionName).toBe('cancelRecovery')
  })

  // setBackup(creator) reverts InvalidBackup, so the form catches it first.
  it('refuses the organiser address as the backup', async () => {
    state.view = view()
    fakeSender()
    renderPage()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('New backup address'), CREATOR)
    expect(screen.getByText('Use a different address from the wallet you are connected with.')).toBeTruthy()
    expect(button('Save backup').disabled).toBe(true)
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type Address, decodeFunctionData, getAddress, type Hex, type TransactionReceipt } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { erc20Abi } from '../abi/erc20'
import { memoAbi } from '../abi/memo'
import { MEMO_ADDRESS, TOKENS, type TokenSymbol } from '../config'
import type { CampaignView } from '../lib/campaigns'
import type { Call, Sender, TxResult } from '../lib/sender'
import { DonatePanel } from './DonatePanel'

const ME = '0x1111111111111111111111111111111111111111' as Address
const CAMPAIGN = getAddress('0x00000000000000000000000000000000000000a1')
const HASH = `0x${'ab'.repeat(32)}` as Hex

const state: { sender: Sender | null; balance: bigint; allowance: bigint } = { sender: null, balance: 0n, allowance: 0n }
const open = vi.fn()
const reads: { address: Address; functionName: string; args: readonly unknown[] }[] = []

// What "Check again" gets back. Each test sets it; the default throws so an unplanned re-check is loud.
const recheck: { next: () => Promise<TxResult> } = { next: async () => { throw new Error('no re-check planned') } }

vi.mock('../hooks/useSender', () => ({ useSender: () => state.sender }))
vi.mock('../lib/sender', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/sender')>()),
  waitForResult: () => recheck.next(),
}))
vi.mock('@reown/appkit/react', () => ({ useAppKit: () => ({ open }) }))
vi.mock('../lib/clients', () => ({
  arcClient: {
    readContract: async (p: { address: Address; functionName: string; args: readonly unknown[] }) => {
      reads.push(p)
      if (p.functionName === 'balanceOf') return state.balance
      if (p.functionName === 'allowance') return state.allowance
      throw new Error(`unexpected read ${p.functionName}`)
    },
  },
}))

function view(symbol: TokenSymbol, closed = false): CampaignView {
  return {
    address: CAMPAIGN,
    symbol,
    summary: {
      creator: '0x2222222222222222222222222222222222222222',
      token: TOKENS[symbol].address,
      goal: 1000_000000n,
      raised: 0n,
      available: 0n,
      withdrawn: 0n,
      closed,
      donationFeeBps: 250,
      withdrawFeeBps: 250,
      createdAt: 1760000000n,
      createdAtBlock: 1n,
      backup: '0x0000000000000000000000000000000000000000',
      recoveryReadyAt: 0n,
      meta: { title: 'Clean water', description: '', imageUrl: '', links: [] },
    },
  }
}

const success: TxResult = { status: 'success', hash: HASH, receipt: { status: 'success' } as TransactionReceipt }

function fakeSender(...results: TxResult[]) {
  const send = vi.fn(async (_calls: Call[]) => results.shift() ?? success)
  state.sender = { kind: 'eoa', address: ME, send }
  return send
}

function renderPanel(v: CampaignView, client = new QueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <DonatePanel view={v} />
    </QueryClientProvider>,
  )
  return client
}

const donateButton = () => screen.getByRole('button', { name: 'Donate' }) as HTMLButtonElement

afterEach(() => {
  cleanup()
  state.sender = null
  state.balance = 0n
  state.allowance = 0n
  reads.length = 0
  localStorage.clear()
  open.mockClear()
  recheck.next = async () => {
    throw new Error('no re-check planned')
  }
  vi.restoreAllMocks()
})

async function fillAndDonate(amount = '10') {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Amount'), amount)
  await waitFor(() => expect(donateButton().disabled).toBe(false))
  await user.click(donateButton())
  return user
}

// Nothing in the panel may start a second donation while one may still be mined.
function expectBlocked() {
  expect(screen.queryByRole('button', { name: 'Donate' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Finish donation' })).toBeNull()
  expect(screen.getByLabelText('Amount').matches(':disabled')).toBe(true)
  expect(screen.getByRole('link', { name: /explorer/i }).getAttribute('href')).toBe(`https://explorer.arc.io/tx/${HASH}`)
}

describe('DonatePanel', () => {
  // The transfer would revert on chain, after the donor already paid gas for an approval.
  it('blocks submit when amount plus tip is over the balance, and says why', async () => {
    fakeSender()
    state.balance = 104_000000n
    renderPanel(view('USDC'))
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Amount'), '100')
    await user.click(screen.getByLabelText('5%'))
    expect(await screen.findByText(/not enough USDC/)).toBeTruthy()
    expect(donateButton().disabled).toBe(true)

    await user.click(screen.getByLabelText('No tip'))
    await waitFor(() => expect(donateButton().disabled).toBe(false))
  })

  // The donor must see where every unit goes before the wallet asks them to confirm.
  it('shows the breakdown before submit', async () => {
    fakeSender()
    state.balance = 1000_000000n
    renderPanel(view('USDC'))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '100' }))
    await user.click(screen.getByLabelText('5%'))
    expect(screen.getByText('97.50 USDC')).toBeTruthy()
    expect(screen.getByText('2.50 USDC')).toBeTruthy()
    expect(screen.getByText('5.00 USDC')).toBeTruthy()
    expect(screen.getByText('105.00 USDC')).toBeTruthy()
  })

  it('is disabled with "This campaign is closed." when the campaign is closed', () => {
    fakeSender()
    renderPanel(view('USDC', true))
    expect(screen.getByText('This campaign is closed.')).toBeTruthy()
    expect(screen.getByLabelText('Amount').matches(':disabled')).toBe(true)
    expect(donateButton().disabled).toBe(true)
  })

  // An EURC campaign only accepts EURC. Approving or reading USDC would leave the donation stuck.
  it('works for an EURC campaign: EURC symbol and EURC token address', async () => {
    const send = fakeSender()
    state.balance = 1000_000000n
    renderPanel(view('EURC'))
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Amount'), '10')
    expect(screen.getByText('10.00 EURC')).toBeTruthy()
    await waitFor(() => expect(donateButton().disabled).toBe(false))
    await user.click(donateButton())
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    const [calls] = send.mock.calls[0]!
    expect(calls[0]!.to).toBe(TOKENS.EURC.address)
    expect(decodeFunctionData({ abi: erc20Abi, data: calls[0]!.data }).args).toEqual([CAMPAIGN, 10_000000n])
    expect(calls[1]!.to).toBe(MEMO_ADDRESS)
    for (const r of reads) expect(r.address).toBe(TOKENS.EURC.address)
    expect(reads.some((r) => r.functionName === 'allowance' && r.args[1] === CAMPAIGN)).toBe(true)
  })

  it('shows a connect prompt instead of the submit button when no wallet is connected', async () => {
    renderPanel(view('USDC'))
    expect(screen.queryByRole('button', { name: 'Donate' })).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Connect wallet to donate' }))
    expect(open).toHaveBeenCalled()
  })

  // After a success the campaign total and the activity list are stale, so both are reloaded.
  it('refreshes the campaign and activity after a successful donation', async () => {
    fakeSender(success)
    state.balance = 1000_000000n
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    renderPanel(view('USDC'), client)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Amount'), '10')
    await waitFor(() => expect(donateButton().disabled).toBe(false))
    await user.click(donateButton())
    expect(await screen.findByText(/Thank you/)).toBeTruthy()
    const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey))
    expect(keys).toContain(JSON.stringify(['campaign', CAMPAIGN.toLowerCase()]))
    expect(keys).toContain(JSON.stringify(['activity', CAMPAIGN.toLowerCase()]))
  })

  // Approve mined, donate was cancelled. Sending both again would ask for a second, useless approval.
  it('after an approval-only partial send, "Finish donation" sends only the donate call', async () => {
    const send = fakeSender({ status: 'rejected', completed: 1 }, success)
    state.balance = 1000_000000n
    renderPanel(view('USDC'))
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Amount'), '10')
    await waitFor(() => expect(donateButton().disabled).toBe(false))
    await user.click(donateButton())
    expect(await screen.findByText('Your approval went through, but the donation was not sent.')).toBeTruthy()
    expect(send.mock.calls[0]![0]).toHaveLength(2)

    // The approval is now on chain, and the panel must read it again rather than trust what it had.
    state.allowance = 10_000000n
    await user.click(screen.getByRole('button', { name: 'Finish donation' }))
    expect(await screen.findByText(/Thank you/)).toBeTruthy()
    const finish = send.mock.calls[1]![0]
    expect(finish).toHaveLength(1)
    expect(finish[0]!.to).toBe(MEMO_ADDRESS)
    expect(decodeFunctionData({ abi: memoAbi, data: finish[0]!.data }).functionName).toBe('memo')
  })

  // A donate call that timed out may still be mined. Calling it "not sent" could make the donor give twice.
  it('treats a timed-out donate call as not confirmed yet, not as unsent', async () => {
    fakeSender({ status: 'timeout', hash: HASH, completed: 1 })
    state.balance = 1000_000000n
    renderPanel(view('USDC'))
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Amount'), '10')
    await waitFor(() => expect(donateButton().disabled).toBe(false))
    await user.click(donateButton())
    expect(await screen.findByText(/not confirmed yet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Finish donation' })).toBeNull()
  })

  it('blocks a new donation after the donate call times out', async () => {
    fakeSender({ status: 'timeout', hash: HASH, completed: 1 })
    state.balance = 1000_000000n
    renderPanel(view('USDC'))
    await fillAndDonate()
    expect(await screen.findByText(/donation is not confirmed yet/)).toBeTruthy()
    expectBlocked()
  })

  it('blocks a new donation after the approval times out', async () => {
    fakeSender({ status: 'timeout', hash: HASH, completed: 0 })
    state.balance = 1000_000000n
    renderPanel(view('USDC'))
    await fillAndDonate()
    expect(await screen.findByText(/approval is not confirmed yet/)).toBeTruthy()
    expectBlocked()
  })

  it('stays blocked when Check again still cannot confirm', async () => {
    fakeSender({ status: 'timeout', hash: HASH, completed: 1 })
    state.balance = 1000_000000n
    renderPanel(view('USDC'))
    const user = await fillAndDonate()
    recheck.next = async () => ({ status: 'timeout', hash: HASH, completed: 0 })
    await user.click(await screen.findByRole('button', { name: 'Check again' }))
    expect(await screen.findByRole('button', { name: 'Check again' })).toBeTruthy()
    expectBlocked()
  })

  // A failed check is not an answer. It must never leave the panel stuck in "Checking" or unblock it.
  it('stays blocked, not stuck checking, when the re-check throws', async () => {
    fakeSender({ status: 'timeout', hash: HASH, completed: 1 })
    state.balance = 1000_000000n
    renderPanel(view('USDC'))
    const user = await fillAndDonate()
    recheck.next = async () => {
      throw new Error('rpc down')
    }
    await user.click(await screen.findByRole('button', { name: 'Check again' }))
    expect(await screen.findByText(/We could not check it/)).toBeTruthy()
    expect(screen.queryByText(/Checking the transaction again/)).toBeNull()
    expectBlocked()
  })

  // A reverted transaction moved nothing, so donating again is safe.
  it('allows a new donation once Check again finds the donation reverted', async () => {
    fakeSender({ status: 'timeout', hash: HASH, completed: 1 })
    state.balance = 1000_000000n
    renderPanel(view('USDC'))
    const user = await fillAndDonate()
    recheck.next = async () => ({ status: 'reverted', hash: HASH, error: 'The transaction failed on chain.', completed: 0 })
    await user.click(await screen.findByRole('button', { name: 'Check again' }))
    expect(await screen.findByText('The transaction failed on chain.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Donate' })).toBeTruthy()
  })

  it('moves to Finish donation once Check again finds the approval mined', async () => {
    fakeSender({ status: 'timeout', hash: HASH, completed: 0 })
    state.balance = 1000_000000n
    renderPanel(view('USDC'))
    const user = await fillAndDonate()
    recheck.next = async () => success
    await user.click(await screen.findByRole('button', { name: 'Check again' }))
    expect(await screen.findByRole('button', { name: 'Finish donation' })).toBeTruthy()
  })

  // Start over is the donor's own choice, and only after they confirm the risk of giving twice.
  it('Start over needs a confirm, then clears the form', async () => {
    fakeSender({ status: 'timeout', hash: HASH, completed: 1 })
    state.balance = 1000_000000n
    renderPanel(view('USDC'))
    const user = await fillAndDonate()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    await user.click(await screen.findByRole('button', { name: 'Start over' }))
    expect(confirm.mock.calls[0]![0]).toMatch(/may still go through/)
    expectBlocked()
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    expect(donateButton()).toBeTruthy()
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('')
  })

  // A reload must not reopen the door to a second donation while the first may still be mined.
  it('restores the not-confirmed block after a reload', async () => {
    fakeSender({ status: 'timeout', hash: HASH, completed: 1 })
    state.balance = 1000_000000n
    renderPanel(view('USDC'))
    await fillAndDonate()
    expect(await screen.findByText(/donation is not confirmed yet/)).toBeTruthy()

    cleanup()
    renderPanel(view('USDC'))
    expect(screen.getByText(/donation is not confirmed yet/)).toBeTruthy()
    expectBlocked()
  })

  // A day-old unknown transaction is probably settled one way or the other. Say so, and keep Start over open.
  it('restores a day-old block with a check-the-explorer note', async () => {
    localStorage.setItem(
      'fundit.pendingBridges',
      JSON.stringify([{ kind: 'arc', campaign: CAMPAIGN, hash: HASH, approve: false, createdAt: Date.now() - 25 * 60 * 60 * 1000 }]),
    )
    fakeSender()
    renderPanel(view('USDC'))
    expect(screen.getByText('This was more than a day ago. Check the explorer before donating again.')).toBeTruthy()
    expectBlocked()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start over' }))
    expect(donateButton()).toBeTruthy()
  })

  it('does not restore the block on another campaign', () => {
    localStorage.setItem(
      'fundit.pendingBridges',
      JSON.stringify([{ kind: 'arc', campaign: '0x00000000000000000000000000000000000000b2', hash: HASH, approve: false, createdAt: 1 }]),
    )
    fakeSender()
    renderPanel(view('USDC'))
    expect(screen.queryByText(/not confirmed yet/)).toBeNull()
  })

  it('forgets the saved block once Check again settles it', async () => {
    fakeSender({ status: 'timeout', hash: HASH, completed: 1 })
    state.balance = 1000_000000n
    renderPanel(view('USDC'))
    const user = await fillAndDonate()
    recheck.next = async () => success
    await user.click(await screen.findByRole('button', { name: 'Check again' }))
    expect(await screen.findByText(/Thank you/)).toBeTruthy()

    cleanup()
    renderPanel(view('USDC'))
    expect(screen.queryByText(/not confirmed yet/)).toBeNull()
  })

  it('forgets the saved block after a confirmed Start over', async () => {
    fakeSender({ status: 'timeout', hash: HASH, completed: 1 })
    state.balance = 1000_000000n
    renderPanel(view('USDC'))
    const user = await fillAndDonate()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await user.click(await screen.findByRole('button', { name: 'Start over' }))

    cleanup()
    renderPanel(view('USDC'))
    expect(screen.queryByText(/not confirmed yet/)).toBeNull()
  })

  it('sends only once on a double submit', async () => {
    const send = fakeSender(success)
    state.balance = 1000_000000n
    renderPanel(view('USDC'))
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Amount'), '10')
    await waitFor(() => expect(donateButton().disabled).toBe(false))
    const form = donateButton().closest('form')!
    // One act, so both submits run against the same render, before the busy state can disable anything.
    act(() => {
      fireEvent.submit(form)
      fireEvent.submit(form)
    })
    expect(await screen.findByText(/Thank you/)).toBeTruthy()
    expect(send).toHaveBeenCalledTimes(1)
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type Address, decodeFunctionData, getAddress, type Hex, type TransactionReceipt } from 'viem'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { campaignAbi } from '../abi/campaign'
import { erc20Abi } from '../abi/erc20'
import { TOKENS, type TokenSymbol } from '../config'
import type { CampaignView } from '../lib/campaigns'
import type { Call, Sender, SendOptions, TxResult } from '../lib/sender'
import { DonatePanel } from './DonatePanel'
import { PASSKEY_PROCESSING } from './TxStatus'

const ME = '0x1111111111111111111111111111111111111111' as Address
const CAMPAIGN = getAddress('0x00000000000000000000000000000000000000a1')
const HASH = `0x${'ab'.repeat(32)}` as Hex

// usdc, when set, is the USDC balance for a campaign in another token (the Fundit account's gas money).
const state: { sender: Sender | null; balance: bigint; usdc?: bigint; allowance: bigint } = {
  sender: null,
  balance: 0n,
  allowance: 0n,
}
// AppKit is mocked only to prove the donate panel never opens it. It opens only inside Add money.
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
// What the Fundit account keeps for the network fee: the form's estimate, and the exact prefund at send time.
const reserve = vi.hoisted(() => ({ form: 300_000n, send: 300_000n }))
const passkeyReserve = vi.hoisted(() =>
  vi.fn(async (_address: unknown, _calls?: unknown, opts?: { feeMargin?: boolean }) => (opts?.feeMargin === false ? reserve.send : reserve.form)),
)
vi.mock('../lib/passkey', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/passkey')>()),
  passkeyReserve,
}))
vi.mock('../lib/clients', () => ({
  arcClient: {
    readContract: async (p: { address: Address; functionName: string; args: readonly unknown[] }) => {
      reads.push(p)
      if (p.functionName === 'balanceOf') return p.address === TOKENS.USDC.address && state.usdc !== undefined ? state.usdc : state.balance
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

// A Fundit account, the only sender useSender returns. Its re-check of a user operation goes through the same
// planned answer as a transaction re-check. Results without hashKind stand for a transaction hash: the panel is
// typed on Sender and still handles that shape.
function passkeyShaped(send: Sender['send']): Sender {
  return { kind: 'passkey', address: ME, send, recheck: () => recheck.next() }
}

function fakeSender(...results: TxResult[]) {
  const send = vi.fn(async (_calls: Call[]) => results.shift() ?? success)
  state.sender = passkeyShaped(send)
  return send
}

function renderPanel(v: CampaignView, client = new QueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DonatePanel view={v} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return client
}

const donateButton = () => screen.getByRole('button', { name: 'Give' }) as HTMLButtonElement

afterEach(() => {
  cleanup()
  reserve.form = 300_000n
  reserve.send = 300_000n
  state.sender = null
  state.balance = 0n
  state.usdc = undefined
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
  expect(screen.queryByRole('button', { name: 'Give' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Finish donation' })).toBeNull()
  expect(screen.getByLabelText('Amount').matches(':disabled')).toBe(true)
}

// A timed-out transaction hash can be looked up on the explorer.
function expectExplorerLink() {
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
    expect(await screen.findByText(/Your balance is 104.00 USDC\. Keep about 0.30 USDC more/)).toBeTruthy()
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

  // The donor confirms this total in the wallet. Cutting it to 2 decimals would show less than they pay.
  it('shows exact 6-decimal amounts in the breakdown', async () => {
    fakeSender()
    state.balance = 1000_000000n
    renderPanel(view('USDC'))
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Amount'), '10.333333')
    await user.click(screen.getByLabelText('5%'))
    const breakdown = within(screen.getByLabelText('Breakdown'))
    expect(breakdown.getByText('10.075 USDC')).toBeTruthy()
    expect(breakdown.getByText('0.258333 USDC')).toBeTruthy()
    expect(breakdown.getByText('0.516666 USDC')).toBeTruthy()
    expect(breakdown.getByText('10.849999 USDC')).toBeTruthy()
  })

  // Memo only accepts an EOA caller, and a Fundit account is a smart account. Every gift calls donate on the
  // Fundit itself, after an approval when the allowance is short.
  it('gives by calling donate on the Fundit directly, never through Memo', async () => {
    const send = fakeSender()
    state.balance = 1000_000000n
    renderPanel(view('USDC'))
    await fillAndDonate()
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    const calls = send.mock.calls[0]![0]
    expect(calls.map((c) => c.to)).toEqual([TOKENS.USDC.address, CAMPAIGN])
    expect(decodeFunctionData({ abi: campaignAbi, data: calls[1]!.data }).functionName).toBe('donate')
  })

  // One way to pay: the Fundit account balance. No other chain, no unified balance and no wallet choice.
  it('offers no other way to pay', () => {
    fakeSender()
    renderPanel(view('USDC'))
    expect(screen.queryByRole('group', { name: 'Pay with' })).toBeNull()
    expect(screen.queryByRole('radio', { name: /another chain|Unified|Arc wallet/ })).toBeNull()
  })

  // Too little in the account is fixed by adding money, so the panel points there.
  it('a low balance shows Add money, linking to /add-money', async () => {
    fakeSender()
    state.balance = 5_000000n
    renderPanel(view('USDC'))
    await userEvent.setup().type(screen.getByLabelText('Amount'), '10')
    expect(await screen.findByText(/Your balance is 5.00 USDC/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Add money' }).getAttribute('href')).toBe('/add-money')
    expect(donateButton().disabled).toBe(true)
  })

  describe('Give anonymously', () => {
    const HELP = "Your name won't show on Fundit. The gift is still recorded on the public blockchain from your wallet address."

    it('has an unticked checkbox with the help text', () => {
      fakeSender()
      renderPanel(view('USDC'))
      expect((screen.getByLabelText('Give anonymously') as HTMLInputElement).checked).toBe(false)
      expect(screen.getByText(HELP)).toBeTruthy()
    })

    it('sends the marked message in the donate call', async () => {
      const send = fakeSender()
      state.balance = 1000_000000n
      renderPanel(view('USDC'))
      const user = userEvent.setup()
      await user.click(screen.getByLabelText('Give anonymously'))
      await user.type(screen.getByLabelText('Message (optional)'), 'hello')
      await user.type(screen.getByLabelText('Amount'), '10')
      await waitFor(() => expect(donateButton().disabled).toBe(false))
      await user.click(donateButton())
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
      const donate = decodeFunctionData({ abi: campaignAbi, data: send.mock.calls[0]![0][1]!.data })
      expect(donate.args![2]).toBe('[anon]hello')
    })

    it('sends no marker when the box is unticked', async () => {
      const send = fakeSender()
      state.balance = 1000_000000n
      renderPanel(view('USDC'))
      const user = userEvent.setup()
      await user.type(screen.getByLabelText('Message (optional)'), 'hello')
      await user.type(screen.getByLabelText('Amount'), '10')
      await waitFor(() => expect(donateButton().disabled).toBe(false))
      await user.click(donateButton())
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
      expect(decodeFunctionData({ abi: campaignAbi, data: send.mock.calls[0]![0][1]!.data }).args![2]).toBe('hello')
    })

    // 275 bytes plus the 6 byte marker is 281, which the contract would revert after the donor paid for approval.
    it('rejects a 275-byte message when anonymous', async () => {
      fakeSender()
      state.balance = 1000_000000n
      renderPanel(view('USDC'))
      const user = userEvent.setup()
      fireEvent.change(screen.getByLabelText('Message (optional)'), { target: { value: 'a'.repeat(275) } })
      await user.type(screen.getByLabelText('Amount'), '10')
      await waitFor(() => expect(donateButton().disabled).toBe(false))
      await user.click(screen.getByLabelText('Give anonymously'))
      await waitFor(() => expect(donateButton().disabled).toBe(true))
      expect(screen.getByText('275 of 274 bytes')).toBeTruthy()
    })
  })

  // A reload while the wallet waits for the receipt must not reopen the form: the donation is already out.
  it('restores the not-confirmed block after a reload during sending, once the donate hash is known', async () => {
    const send = vi.fn((calls: Call[], opts?: SendOptions) => {
      opts?.onHash?.(HASH, calls.length - 1)
      return new Promise<TxResult>(() => {})
    })
    state.sender = passkeyShaped(send)
    state.balance = 1000_000000n
    renderPanel(view('USDC'))
    await fillAndDonate()
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    cleanup()
    renderPanel(view('USDC'))
    expect(screen.getByText(/donation is not confirmed yet/)).toBeTruthy()
    // A user operation hash is not on the explorer. The passkey sender checks it.
    expect(screen.getByText(PASSKEY_PROCESSING)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy()
    expectBlocked()
  })

  // The approval alone moves nothing to the campaign, so its hash does not block a new donation.
  it('saves only the donate hash, not the approval hash, while sending', async () => {
    const saved: unknown[] = []
    const send = vi.fn(async (calls: Call[], opts?: SendOptions) => {
      opts?.onHash?.(`0x${'01'.repeat(32)}`, 0)
      saved.push(localStorage.getItem('fundit.pendingBridges'))
      opts?.onHash?.(HASH, calls.length - 1)
      saved.push(JSON.parse(localStorage.getItem('fundit.pendingBridges') ?? '[]'))
      return success
    })
    state.sender = passkeyShaped(send)
    state.balance = 1000_000000n
    renderPanel(view('USDC'))
    await fillAndDonate()
    expect(await screen.findByText(/Thank you/)).toBeTruthy()
    expect(saved[0]).toBeNull()
    expect(saved[1]).toMatchObject([{ kind: 'arc', campaign: CAMPAIGN, hash: HASH, approve: false }])
    // A known outcome clears it.
    expect(localStorage.getItem('fundit.pendingBridges')).toBeNull()
  })

  it('is disabled with "This Fundit is closed." when the Fundit is closed', () => {
    fakeSender()
    renderPanel(view('USDC', true))
    expect(screen.getByText('This Fundit is closed.')).toBeTruthy()
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
    expect(calls[1]!.to).toBe(CAMPAIGN)
    // The donor's funds are read in EURC. The only USDC read is the Fundit account's gas money.
    for (const r of reads.filter((r) => r.functionName === 'allowance')) expect(r.address).toBe(TOKENS.EURC.address)
    expect(reads.some((r) => r.functionName === 'balanceOf' && r.address === TOKENS.EURC.address)).toBe(true)
    expect(reads.some((r) => r.functionName === 'allowance' && r.args[1] === CAMPAIGN)).toBe(true)
  })

  // Signed out, giving starts with the passkey sign-in. The wallet modal never opens from here.
  it('signed out, Sign in to give opens the passkey sign-in dialog, never the wallet modal', async () => {
    renderPanel(view('USDC'))
    expect(screen.queryByRole('button', { name: 'Give' })).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in to give' }))
    expect(within(screen.getByRole('dialog', { name: 'Sign in' })).getByRole('button', { name: 'Continue with passkey' })).toBeTruthy()
    expect(open).not.toHaveBeenCalled()
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
    // My page, Add money and Send money out share this balance, so a gift from a Fundit account updates them too.
    expect(keys).toContain(JSON.stringify(['account-balances']))
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
    expect(finish[0]!.to).toBe(CAMPAIGN)
    expect(decodeFunctionData({ abi: campaignAbi, data: finish[0]!.data }).functionName).toBe('donate')
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
    expectExplorerLink()
  })

  it('blocks a new donation after the approval times out', async () => {
    fakeSender({ status: 'timeout', hash: HASH, completed: 0 })
    state.balance = 1000_000000n
    renderPanel(view('USDC'))
    await fillAndDonate()
    expect(await screen.findByText(/approval is not confirmed yet/)).toBeTruthy()
    expectBlocked()
    expectExplorerLink()
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
    expectExplorerLink()
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
    expectExplorerLink()
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
    expect(screen.getByRole('button', { name: 'Give' })).toBeTruthy()
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
    expectExplorerLink()
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
    expectExplorerLink()
  })

  // A day-old unknown transaction is probably settled one way or the other. Say so, and keep Start over open.
  it('restores a day-old block with a check-the-explorer note', async () => {
    localStorage.setItem(
      'fundit.pendingBridges',
      JSON.stringify([{ kind: 'arc', campaign: CAMPAIGN, hash: HASH, approve: false, createdAt: Date.now() - 25 * 60 * 60 * 1000 }]),
    )
    fakeSender()
    renderPanel(view('USDC'))
    expect(screen.getByText('This was more than a day ago. Check the explorer before giving again.')).toBeTruthy()
    expectBlocked()
    expectExplorerLink()
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
  // An unconfirmed donation to this Fundit, from this tab or another, blocks a new one so nobody gives twice.
  describe('one unconfirmed donation at a time', () => {
    const KEY = 'fundit.pendingBridges'
    const BURN = `0x${'cd'.repeat(32)}` as Hex
    const store = (...entries: Record<string, unknown>[]) =>
      localStorage.setItem(KEY, JSON.stringify(entries.map((e) => ({ campaign: CAMPAIGN, createdAt: Date.now(), ...e }))))
    const unsubmittable = () => expect(screen.queryByRole('button', { name: 'Give' })).toBeNull()

    // Another tab wrote the entry after this form loaded and this tab heard nothing. Submit reads the store again.
    it('re-reads the store at submit and sends nothing while another donation is unconfirmed', async () => {
      const send = fakeSender()
      state.balance = 1000_000000n
      renderPanel(view('USDC'))
      const user = userEvent.setup()
      await user.type(screen.getByLabelText('Amount'), '10')
      await waitFor(() => expect(donateButton().disabled).toBe(false))
      store({ kind: 'arc', hash: HASH, approve: false })
      await user.click(donateButton())
      expect(await screen.findByText(/donation is not confirmed yet/)).toBeTruthy()
      expect(send).not.toHaveBeenCalled()
      unsubmittable()
    })

    // The browser tells other tabs of a localStorage change with a storage event.
    it('picks up a donation another tab left unconfirmed, on the storage event', async () => {
      fakeSender()
      state.balance = 1000_000000n
      renderPanel(view('USDC'))
      expect(screen.queryByText(/not confirmed yet/)).toBeNull()
      store({ kind: 'arc', hash: HASH, approve: false })
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
      })
      expect(await screen.findByText(/donation is not confirmed yet/)).toBeTruthy()
      unsubmittable()
    })

    // The organiser's own payout to another chain is money leaving the Fundit, not a donation on its way.
    it('a payout to another chain does not block and does not show in the donate panel', async () => {
      store({ kind: 'payout', burnTx: BURN, srcDomain: 26, destDomain: 6, amount: '9.9' })
      fakeSender()
      state.balance = 1000_000000n
      renderPanel(view('USDC'))
      expect(screen.queryByText(/9.9 USDC/)).toBeNull()
      await fillAndDonate()
    })

    // Gifts no longer arrive from other chains. A transfer saved by an older build, keyed by this Fundit, is not a
    // gift that could land twice, so it must not disable Give with no reason shown.
    it('ignores a transfer from another chain left in the store', async () => {
      store({ kind: 'bridge', burnTx: BURN, srcDomain: 6, amount: '25' }, { kind: 'submitted', id: 's-1', srcDomain: 6, amount: '25' })
      const send = fakeSender()
      state.balance = 1000_000000n
      renderPanel(view('USDC'))
      await fillAndDonate()
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    })
  })

  describe('passkey wallet', () => {
    const TX = `0x${'cd'.repeat(32)}` as Hex
    const PROCESSING = 'Your passkey transaction is still processing.'

    function passkeySender(...results: TxResult[]) {
      const send = vi.fn(async (_calls: Call[]) => results.shift() ?? success)
      const recheckFn = vi.fn(async (_hash: Hex): Promise<TxResult> => ({
        status: 'success',
        hash: TX,
        receipt: { status: 'success' } as TransactionReceipt,
      }))
      state.sender = { kind: 'passkey', address: ME, send, recheck: recheckFn }
      return { send, recheck: recheckFn }
    }

    // A user operation hash is unknown to the explorer and to eth_getTransactionReceipt. Only the bundler can find it.
    it('rechecks a timed-out user operation through the sender and then links the real transaction', async () => {
      const { recheck: recheckFn } = passkeySender({ status: 'timeout', hash: HASH, completed: 0, hashKind: 'userop' })
      state.balance = 1000_000000n
      renderPanel(view('USDC'))
      const user = await fillAndDonate()
      // The approval and the donation are one user operation, so this is the donation, not a lone approval.
      expect(await screen.findByText(/donation is not confirmed yet/)).toBeTruthy()
      expect(screen.getByText(PROCESSING)).toBeTruthy()
      expect(screen.queryByRole('link', { name: /explorer/i })).toBeNull()
      await user.click(screen.getByRole('button', { name: 'Check again' }))
      expect(await screen.findByText(/Thank you/)).toBeTruthy()
      expect(recheckFn).toHaveBeenCalledWith(HASH)
      expect(screen.getByRole('link', { name: /explorer/i }).getAttribute('href')).toBe(`https://explorer.arc.io/tx/${TX}`)
    })

    // A passkey wallet pays its gas in USDC from the same balance, and the EntryPoint takes the whole prefund
    // before the gift runs. Leaving less than that, the gift would revert after the donor confirmed it.
    it('keeps the estimated reserve: amount plus tip must leave the prefund', async () => {
      passkeySender()
      state.balance = 10_000000n
      renderPanel(view('USDC'))
      const user = userEvent.setup()
      await user.type(screen.getByLabelText('Amount'), '9.8')
      expect(await screen.findByText(/Keep about 0.30 USDC more for the network fee/)).toBeTruthy()
      expect(donateButton().disabled).toBe(true)

      await user.clear(screen.getByLabelText('Amount'))
      await user.type(screen.getByLabelText('Amount'), '9.7')
      await waitFor(() => expect(donateButton().disabled).toBe(false))
    })

    // The prefund for the real calls (approve and donate) at the fee now decides, before anything is sent.
    it('checks the exact prefund for the gift right before sending', async () => {
      const { send } = passkeySender()
      state.balance = 10_000000n
      reserve.send = 400_000n
      renderPanel(view('USDC'))
      await fillAndDonate('9.7')
      expect(await screen.findByText(/Keep about 0.40 USDC more for the network fee/)).toBeTruthy()
      expect(send).not.toHaveBeenCalled()
      const [, calls, opts] = passkeyReserve.mock.calls.at(-1)!
      expect(opts).toEqual({ feeMargin: false })
      expect(calls).toHaveLength(2)
    })

    // Arc gas is paid in USDC. A Fundit account with EURC and no USDC would fail at gas estimation after the tap.
    it('asks for USDC gas before an EURC gift', async () => {
      const { send } = passkeySender()
      state.balance = 100_000000n
      state.usdc = 10_000n
      renderPanel(view('EURC'))
      const user = userEvent.setup()
      await user.type(screen.getByLabelText('Amount'), '10')
      expect(await screen.findByText(/Add at least 0.30 USDC to your Fundit account first. It pays the network fee./)).toBeTruthy()
      expect(screen.getByRole('link', { name: 'Add money' }).getAttribute('href')).toBe('/add-money')
      expect(donateButton().disabled).toBe(true)
      await user.click(donateButton())
      expect(send).not.toHaveBeenCalled()
    })

    it('lets an EURC gift go when the account has USDC for gas', async () => {
      const { send } = passkeySender()
      state.balance = 100_000000n
      state.usdc = 300_000n
      renderPanel(view('EURC'))
      await fillAndDonate()
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    })

    // After a reload the saved entry must say which kind of hash it holds, or the wrong check runs.
    it('saves the hash kind with the pending donation', async () => {
      passkeySender({ status: 'timeout', hash: HASH, completed: 0, hashKind: 'userop' })
      state.balance = 1000_000000n
      renderPanel(view('USDC'))
      await fillAndDonate()
      await screen.findByText(PROCESSING)
      const saved = JSON.parse(localStorage.getItem('fundit.pendingBridges')!)
      expect(saved[0]).toMatchObject({ kind: 'arc', hash: HASH, hashKind: 'userop' })
    })

    it('asks to log in with the passkey when a saved user operation has no passkey session', () => {
      localStorage.setItem(
        'fundit.pendingBridges',
        JSON.stringify([{ kind: 'arc', campaign: CAMPAIGN, hash: HASH, approve: false, hashKind: 'userop', createdAt: Date.now() }]),
      )
      renderPanel(view('USDC'))
      expect(screen.getByText('Log in with your passkey to check this transaction.')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
      expect(screen.queryByRole('link', { name: /explorer/i })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Give' })).toBeNull()
    })
  })
})

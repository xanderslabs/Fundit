import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type Address, decodeFunctionData, getAddress, type Hex, type TransactionReceipt } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { erc20Abi } from '../abi/erc20'
import { memoAbi } from '../abi/memo'
import { MEMO_ADDRESS, TOKENS, type TokenSymbol } from '../config'
import type { CampaignView } from '../lib/campaigns'
import type { Call, Sender, SendOptions, TxResult } from '../lib/sender'
import { DonatePanel } from './DonatePanel'

const ME = '0x1111111111111111111111111111111111111111' as Address
const CAMPAIGN = getAddress('0x00000000000000000000000000000000000000a1')
const HASH = `0x${'ab'.repeat(32)}` as Hex

// code is what getCode returns for the donor address: undefined for an EOA, bytes for a smart wallet.
const state: { sender: Sender | null; balance: bigint; allowance: bigint; wallet: boolean; code: Hex | undefined } = {
  sender: null,
  balance: 0n,
  allowance: 0n,
  wallet: false,
  code: undefined,
}
const codeReads: Address[] = []
const open = vi.fn()
const reads: { address: Address; functionName: string; args: readonly unknown[] }[] = []

// What "Check again" gets back. Each test sets it; the default throws so an unplanned re-check is loud.
const recheck: { next: () => Promise<TxResult> } = { next: async () => { throw new Error('no re-check planned') } }

// Cross-chain sources ship behind VITE_CROSSCHAIN. Most tests here cover how sources block each other, so the
// flag is on unless a test turns it off.
const flags = vi.hoisted(() => ({ crosschain: true }))
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  get CROSSCHAIN_ENABLED() {
    return flags.crosschain
  },
}))
vi.mock('../hooks/useSender', () => ({ useSender: () => state.sender }))
vi.mock('../lib/sender', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/sender')>()),
  waitForResult: () => recheck.next(),
}))
vi.mock('@reown/appkit/react', () => ({ useAppKit: () => ({ open }) }))
// What Iris says about a cross-chain burn. Each test sets it.
const iris: { status: 'pending' | 'attested' | 'minted' | 'unknown' } = { status: 'pending' }
vi.mock('../lib/iris', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/iris')>()),
  fetchTransferStatus: async () => iris.status,
}))
// No test here may reach Circle. The unified balance flow itself is covered in UnifiedDonate.test.tsx.
vi.mock('../lib/unified', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/unified')>()),
  fetchUnifiedBalance: async () => ({ total: 0n, byChain: [] }),
}))
// The unified balance option signs with the connected external wallet, so it reads wagmi directly.
vi.mock('wagmi', () => ({
  useConnection: () =>
    state.wallet ? { isConnected: true, address: ME, connector: { getProvider: async () => ({}) } } : { isConnected: false },
}))
vi.mock('../lib/clients', () => ({
  arcClient: {
    readContract: async (p: { address: Address; functionName: string; args: readonly unknown[] }) => {
      reads.push(p)
      if (p.functionName === 'balanceOf') return state.balance
      if (p.functionName === 'allowance') return state.allowance
      throw new Error(`unexpected read ${p.functionName}`)
    },
    getCode: async ({ address }: { address: Address }) => {
      codeReads.push(address)
      return state.code
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

const donateButton = () => screen.getByRole('button', { name: 'Give' }) as HTMLButtonElement

afterEach(() => {
  cleanup()
  state.sender = null
  state.balance = 0n
  state.allowance = 0n
  state.wallet = false
  state.code = undefined
  flags.crosschain = true
  iris.status = 'pending'
  reads.length = 0
  codeReads.length = 0
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

  // Memo reverts for any caller with code. A smart wallet or an EIP-7702 delegated address connects as an
  // ordinary wallet, so the panel reads the code on Arc before building.
  it('donates through Memo from an address with no code', async () => {
    const send = fakeSender()
    state.balance = 1000_000000n
    renderPanel(view('USDC'))
    await fillAndDonate()
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(codeReads).toEqual([ME])
    expect(send.mock.calls[0]![0].at(-1)!.to).toBe(MEMO_ADDRESS)
  })

  it('calls the campaign directly from an address with code', async () => {
    const send = fakeSender()
    state.balance = 1000_000000n
    state.code = `0xef0100${'5a'.repeat(20)}`
    renderPanel(view('USDC'))
    await fillAndDonate()
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    const calls = send.mock.calls[0]![0]
    expect(calls[0]!.to).toBe(TOKENS.USDC.address)
    expect(calls[1]!.to).toBe(CAMPAIGN)
  })

  // A reload while the wallet waits for the receipt must not reopen the form: the donation is already out.
  it('restores the not-confirmed block after a reload during sending, once the donate hash is known', async () => {
    const send = vi.fn((calls: Call[], opts?: SendOptions) => {
      opts?.onHash?.(HASH, calls.length - 1)
      return new Promise<TxResult>(() => {})
    })
    state.sender = { kind: 'eoa', address: ME, send }
    state.balance = 1000_000000n
    renderPanel(view('USDC'))
    await fillAndDonate()
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    cleanup()
    renderPanel(view('USDC'))
    expect(screen.getByText(/donation is not confirmed yet/)).toBeTruthy()
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
    state.sender = { kind: 'eoa', address: ME, send }
    state.balance = 1000_000000n
    renderPanel(view('USDC'))
    await fillAndDonate()
    expect(await screen.findByText(/Thank you/)).toBeTruthy()
    expect(saved[0]).toBeNull()
    expect(saved[1]).toMatchObject([{ kind: 'arc', campaign: CAMPAIGN, hash: HASH, approve: false }])
    // A known outcome clears it.
    expect(localStorage.getItem('fundit.pendingBridges')).toBeNull()
  })

  it('is disabled with "This fundraiser is closed." when the fundraiser is closed', () => {
    fakeSender()
    renderPanel(view('USDC', true))
    expect(screen.getByText('This fundraiser is closed.')).toBeTruthy()
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
    expect(screen.queryByRole('button', { name: 'Give' })).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in to give' }))
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
    expect(screen.getByText('This was more than a day ago. Check the explorer before giving again.')).toBeTruthy()
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
  describe('VITE_CROSSCHAIN flag', () => {
    const radios = () => screen.getAllByRole('radio', { name: /Arc wallet|USDC on another chain|Unified USDC balance/ })

    it('off: a USDC campaign offers only the Arc wallet, even with a wallet connected', () => {
      flags.crosschain = false
      state.wallet = true
      fakeSender()
      renderPanel(view('USDC'))
      expect(radios().map((r) => r.closest('label')!.textContent)).toEqual([expect.stringMatching(/^Arc wallet/)])
    })

    it('on: a USDC campaign offers all three sources to a connected wallet', () => {
      state.wallet = true
      fakeSender()
      renderPanel(view('USDC'))
      expect(radios()).toHaveLength(3)
    })

    // Entries saved before the flag went off still describe money that may move. They must still block and be
    // checkable, or the donor could give twice.
    it('off: a stored unified spend still shows its status and blocks the Arc wallet', () => {
      flags.crosschain = false
      localStorage.setItem(
        'fundit.pendingBridges',
        JSON.stringify([{ kind: 'unified', campaign: CAMPAIGN, amount: '5', transferId: 't-1', createdAt: Date.now() }]),
      )
      state.wallet = true
      fakeSender()
      state.balance = 1000_000000n
      renderPanel(view('USDC'))
      expect((screen.getByRole('radio', { name: /Unified USDC balance/ }) as HTMLInputElement).checked).toBe(true)
      expect(screen.getByText(/unified balance donation is not confirmed yet/)).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy()
      expect(screen.getByRole('radio', { name: /Arc wallet/ }).matches(':disabled')).toBe(true)
      expect(screen.queryByRole('button', { name: 'Give' })).toBeNull()
    })

    it('off: a stored cross-chain transfer still shows and blocks', () => {
      flags.crosschain = false
      localStorage.setItem(
        'fundit.pendingBridges',
        JSON.stringify([{ kind: 'bridge', campaign: CAMPAIGN, burnTx: `0x${'cd'.repeat(32)}`, srcDomain: 6, amount: '25', createdAt: Date.now() }]),
      )
      fakeSender()
      renderPanel(view('USDC'))
      expect(screen.getByText(/cross-chain donation of 25 USDC is still on its way/)).toBeTruthy()
      expect(screen.getByRole('radio', { name: /Arc wallet/ }).matches(':disabled')).toBe(true)
      expect(screen.queryByRole('button', { name: 'Give' })).toBeNull()
    })
  })

  describe('unified balance option', () => {
    const option = () => screen.queryByRole('radio', { name: /Unified USDC balance/ })

    // Gateway spends USDC only. Offering it on an EURC campaign would mint the wrong token to the campaign.
    it('is hidden for EURC campaigns, even with a wallet connected', () => {
      state.wallet = true
      fakeSender()
      renderPanel(view('EURC'))
      expect(option()).toBeNull()
    })

    it('is offered for USDC campaigns when a wallet is connected', () => {
      state.wallet = true
      fakeSender()
      renderPanel(view('USDC'))
      expect(option()).toBeTruthy()
    })

    // The spend is signed by the external wallet. Without one there is nothing to sign with.
    it('is hidden when no wallet is connected', () => {
      renderPanel(view('USDC'))
      expect(option()).toBeNull()
    })

    // After a reload the unconfirmed spend must be in view, or the donor could give again from Arc unaware.
    it('opens the unified option after a reload when a spend there is unconfirmed', () => {
      localStorage.setItem(
        'fundit.pendingBridges',
        JSON.stringify([{ kind: 'unified', campaign: CAMPAIGN, amount: '5', transferId: 't-1', createdAt: Date.now() }]),
      )
      state.wallet = true
      fakeSender()
      renderPanel(view('USDC'))
      expect((option() as HTMLInputElement).checked).toBe(true)
      expect(screen.getByText(/not confirmed yet/)).toBeTruthy()
    })
  })

  // Any unconfirmed donation to this campaign, from any source, blocks every source. A second donation from
  // another source while the first may still land would make the donor give twice.
  describe('one unconfirmed donation blocks every source', () => {
    const KEY = 'fundit.pendingBridges'
    const BURN = `0x${'cd'.repeat(32)}` as Hex
    const store = (...entries: Record<string, unknown>[]) =>
      localStorage.setItem(KEY, JSON.stringify(entries.map((e) => ({ campaign: CAMPAIGN, createdAt: Date.now(), ...e }))))
    // A disabled fieldset disables its inputs without setting their own disabled property.
    const radio = (name: RegExp) => {
      const el = screen.getByRole('radio', { name }) as HTMLInputElement
      return { disabled: el.matches(':disabled') }
    }
    const unsubmittable = () => expect(screen.queryByRole('button', { name: 'Give' })).toBeNull()

    // The wallet that signed the unified spend is not connected after the reload, which used to drop the
    // panel back to an open Arc wallet form.
    it('a pending unified entry blocks the Arc wallet form', () => {
      store({ kind: 'unified', amount: '5', transferId: 't-1' })
      fakeSender()
      state.balance = 1000_000000n
      renderPanel(view('USDC'))
      expect(screen.getByText(/unified balance donation is not confirmed yet/)).toBeTruthy()
      expect(radio(/Arc wallet/).disabled).toBe(true)
      unsubmittable()
    })

    it('a pending Arc timeout blocks the unified and cross-chain options', () => {
      store({ kind: 'arc', hash: HASH, approve: false })
      state.wallet = true
      fakeSender()
      renderPanel(view('USDC'))
      expect(screen.getByText(/Arc wallet donation is not confirmed yet/)).toBeTruthy()
      expect(radio(/Unified USDC balance/).disabled).toBe(true)
      expect(radio(/USDC on another chain/).disabled).toBe(true)
      unsubmittable()
    })

    it('a cross-chain transfer on its way blocks the Arc wallet form, and Start over clears only it', async () => {
      const OTHER_BURN = `0x${'ee'.repeat(32)}` as Hex
      store(
        { kind: 'bridge', burnTx: BURN, srcDomain: 6, amount: '25' },
        { kind: 'bridge', burnTx: OTHER_BURN, srcDomain: 6, amount: '7', minted: true },
      )
      fakeSender()
      state.balance = 1000_000000n
      renderPanel(view('USDC'))
      expect(screen.getByText(/cross-chain donation of 25 USDC is still on its way/)).toBeTruthy()
      expect(radio(/Arc wallet/).disabled).toBe(true)
      unsubmittable()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      await userEvent.setup().click(screen.getByRole('button', { name: 'Start over' }))
      const left = JSON.parse(localStorage.getItem(KEY)!) as { burnTx: string }[]
      expect(left.map((e) => e.burnTx)).toEqual([OTHER_BURN])
      expect(radio(/Arc wallet/).disabled).toBe(false)
    })

    // Another tab wrote the entry after this form loaded and this tab heard nothing. Submit reads the store again.
    it('re-reads the store at Arc wallet submit and sends nothing while another donation is unconfirmed', async () => {
      const send = fakeSender()
      state.balance = 1000_000000n
      renderPanel(view('USDC'))
      const user = userEvent.setup()
      await user.type(screen.getByLabelText('Amount'), '10')
      await waitFor(() => expect(donateButton().disabled).toBe(false))
      localStorage.setItem(KEY, JSON.stringify([{ kind: 'unified', campaign: CAMPAIGN, amount: '5', createdAt: Date.now() }]))
      await user.click(donateButton())
      expect(await screen.findByText(/unified balance donation is not confirmed yet/)).toBeTruthy()
      expect(send).not.toHaveBeenCalled()
      expect(radio(/Arc wallet/).disabled).toBe(true)
    })

    // The browser tells other tabs of a localStorage change with a storage event.
    it('picks up an Arc donation another tab left unconfirmed, on the storage event', async () => {
      fakeSender()
      state.balance = 1000_000000n
      renderPanel(view('USDC'))
      expect(screen.queryByText(/not confirmed yet/)).toBeNull()
      localStorage.setItem(KEY, JSON.stringify([{ kind: 'arc', campaign: CAMPAIGN, hash: HASH, approve: false, createdAt: Date.now() }]))
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
      })
      expect(await screen.findByText(/Arc wallet donation is not confirmed yet/)).toBeTruthy()
      unsubmittable()
    })

    it('a submitted cross-chain entry with no burn hash yet also blocks', () => {
      store({ kind: 'submitted', id: 's-1', srcDomain: 6, amount: '25' })
      fakeSender()
      renderPanel(view('USDC'))
      expect(radio(/Arc wallet/).disabled).toBe(true)
      unsubmittable()
    })

    // The organiser's own payout to another chain is money leaving the campaign, not a donation on its way.
    it('a payout to another chain does not block and does not show in the donate panel', async () => {
      store({ kind: 'payout', burnTx: BURN, srcDomain: 26, destDomain: 6, amount: '9.9' })
      fakeSender()
      state.balance = 1000_000000n
      renderPanel(view('USDC'))
      expect(screen.queryByText(/9.9 USDC/)).toBeNull()
      expect(radio(/Arc wallet/).disabled).toBe(false)
      await fillAndDonate()
    })

    it('a minted cross-chain entry does not block', async () => {
      store({ kind: 'bridge', burnTx: BURN, srcDomain: 6, amount: '25', minted: true })
      fakeSender()
      state.balance = 1000_000000n
      renderPanel(view('USDC'))
      expect(radio(/Arc wallet/).disabled).toBe(false)
      await fillAndDonate()
    })

    // The tracker learns of the mint from Iris. From then on the transfer is done and must stop blocking.
    it('stops blocking once Iris reports the mint', async () => {
      store({ kind: 'bridge', burnTx: BURN, srcDomain: 6, amount: '25' })
      iris.status = 'minted'
      fakeSender()
      state.balance = 1000_000000n
      renderPanel(view('USDC'))
      expect(await screen.findByText(/reached the fundraiser/)).toBeTruthy()
      await waitFor(() => expect(radio(/Arc wallet/).disabled).toBe(false))
      expect(screen.getByRole('button', { name: 'Give' })).toBeTruthy()
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

    // A passkey wallet pays its gas in USDC from the same balance. Amount plus tip equal to the balance would
    // leave nothing for gas, and the user operation would fail after the donor confirmed it.
    it('keeps a gas buffer: amount plus tip must leave about 0.05 USDC', async () => {
      passkeySender()
      state.balance = 10_000000n
      renderPanel(view('USDC'))
      const user = userEvent.setup()
      await user.type(screen.getByLabelText('Amount'), '10')
      expect(await screen.findByText(/Keep about 0.05 USDC more for the network fee/)).toBeTruthy()
      expect(donateButton().disabled).toBe(true)

      await user.clear(screen.getByLabelText('Amount'))
      await user.type(screen.getByLabelText('Amount'), '9.95')
      await waitFor(() => expect(donateButton().disabled).toBe(false))
      expect(codeReads).toEqual([])
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
      fakeSender()
      renderPanel(view('USDC'))
      expect(screen.getByText('Log in with your passkey to check this transaction.')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
      expect(screen.queryByRole('link', { name: /explorer/i })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Give' })).toBeNull()
    })
  })
})

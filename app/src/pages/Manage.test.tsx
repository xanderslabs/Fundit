import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { type Address, decodeFunctionData, getAddress, type Hex, pad, type TransactionReceipt } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { campaignAbi } from '../abi/campaign'
import { TOKENS } from '../config'
import type { CampaignView } from '../lib/campaigns'
import { NeedsNetworkFee } from '../lib/errors'
import type { Call, Sender, TxResult } from '../lib/sender'
import { Manage } from './Manage'

const CAMPAIGN = getAddress('0x00000000000000000000000000000000000000a1')
const CREATOR = getAddress('0x1111111111111111111111111111111111111111') as Address
const STRANGER = getAddress('0x3333333333333333333333333333333333333333') as Address
const HASH = `0x${'ab'.repeat(32)}` as Hex

const state: { view: CampaignView | undefined; sender: Sender | null; stray: bigint } = {
  view: undefined,
  sender: null,
  // The Fundit's balance of the other known token (EURC on a USDC Fundit, USDC on a EURC Fundit).
  stray: 0n,
}

vi.mock('../hooks/useCampaigns', () => ({
  useCampaign: () => ({ data: state.view, isPending: state.view === undefined, isError: false, refetch: () => {} }),
}))
vi.mock('../hooks/useSender', () => ({ useSender: () => state.sender }))
const reads: { functionName: string; address: Address; args?: readonly unknown[] }[] = []
vi.mock('../lib/clients', () => ({
  arcClient: {
    readContract: async (p: { functionName: string; address: Address; args?: readonly unknown[] }) => {
      reads.push(p)
      return p.functionName === 'balanceOf' ? state.stray : true
    },
  },
}))

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

function fakeSender(kind: Sender['kind'] = 'wallet', address = CREATOR, ...results: TxResult[]) {
  const send = vi.fn(async (_calls: Call[]) => results.shift() ?? success)
  state.sender = { kind, address, send }
  return send
}

function renderPage(client = new QueryClient(), path = `/manage/${CAMPAIGN}`) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/manage/:address" element={<Manage />} />
          <Route path="/c/:address" element={<p>Campaign page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return client
}

// Iris fee quotes with no protocol fee, so maxFee is forwardFee.high. Change high to move the quote.
function stubFees(high: number) {
  const fees = { high }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json([
        { finalityThreshold: 1000, minimumFee: 0, forwardFee: { low: 1, med: 1, high: fees.high } },
        { finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: 1, med: 1, high: fees.high } },
      ]),
    ),
  )
  return fees
}

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
const decode = (data: Hex) => decodeFunctionData({ abi: campaignAbi, data })

afterEach(() => {
  cleanup()
  state.view = undefined
  state.sender = null
  state.stray = 0n
  reads.length = 0
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('Manage', () => {
  // A bad Manage link looks the same as a bad Fundit link: the Fundit 404, with ways back into the app.
  it('shows the Fundit 404 for an address the factory did not create', async () => {
    state.view = 'not-a-campaign' as unknown as CampaignView
    renderPage()
    expect(await screen.findByRole('heading', { name: "This Fundit doesn't exist or the link is wrong." })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Explore Fundits' })).toBeTruthy()
    expect(screen.queryByText('Not a Fundit')).toBeNull()
  })

  it('shows the Fundit 404 for a path that is not an address', () => {
    renderPage(new QueryClient(), '/manage/not-an-address')
    expect(screen.getByRole('heading', { name: "This Fundit doesn't exist or the link is wrong." })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go home' })).toBeTruthy()
  })

  // Only the organiser can sign these calls. Anyone else would only meet reverts, so they go to the public page.
  it('sends a connected non-creator to the campaign page', async () => {
    state.view = view()
    fakeSender('wallet', STRANGER)
    renderPage()
    expect(await screen.findByText('Campaign page')).toBeTruthy()
  })

  // A wallet connected for Add money is never a way to manage. Only the organiser's Fundit account is.
  it('sends a Fundit account that is not the organiser to the campaign page', async () => {
    state.view = view()
    fakeSender('passkey', STRANGER)
    renderPage()
    expect(await screen.findByText('Campaign page')).toBeTruthy()
  })

  it('shows the manage page to the creator', () => {
    state.view = view()
    fakeSender()
    renderPage()
    expect(screen.getByRole('heading', { name: 'Manage this Fundit' })).toBeTruthy()
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

  // A withdrawal moves no USDC out of the account but pays the prefund. The sender's refusal shows plainly.
  it("shows the sender's network fee refusal on a withdrawal, with an Add money link", async () => {
    state.view = view()
    const send = fakeSender('passkey')
    send.mockRejectedValueOnce(new NeedsNetworkFee(250_000n))
    renderPage()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Amount'), '50')
    await user.click(button('Withdraw'))
    expect(await screen.findByText(/Your Fundit account needs at least 0.25 USDC for the network fee\. Add money and try again\./)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Add money' }).getAttribute('href')).toBe('/me?add=1')
    expect((send.mock.calls[0] as unknown[])[1]).toMatchObject({ label: 'Withdraw' })
  })

  // A cross-chain payout pads the recipient without checking it, so a typo would mint to the wrong address.
  it('refuses a payout recipient with a bad checksum', async () => {
    state.view = view()
    const send = fakeSender()
    renderPage()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Amount'), '50')
    await user.clear(screen.getByLabelText('Recipient'))
    await user.type(screen.getByLabelText('Recipient'), '0xaBcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD')
    expect(screen.getByText('This address has a typo. Check it and paste it again.')).toBeTruthy()
    expect(button('Withdraw').disabled).toBe(true)
    await user.click(button('Withdraw'))
    expect(send).not.toHaveBeenCalled()

    // All lowercase has no checksum, so it is accepted.
    await user.clear(screen.getByLabelText('Recipient'))
    await user.type(screen.getByLabelText('Recipient'), '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')
    await user.click(button('Withdraw'))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(decode(send.mock.calls[0]![0][0]!.data).args[2]).toBe(pad('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd', { size: 32 }))
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
    const warning = 'Your Fundit account may not exist on that chain. Send to an address you control there.'
    expect(screen.queryByText(warning)).toBeNull()
    await screen.findByRole('option', { name: 'Base' })
    await userEvent.setup().selectOptions(screen.getByLabelText('Send to'), 'Base')
    expect(screen.getByText(warning)).toBeTruthy()
    expect(screen.getByText('Cross-chain payouts are new. Try a small amount first.')).toBeTruthy()
  })

  it('does not warn an ordinary wallet about Base', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
    state.view = view()
    fakeSender('wallet')
    renderPage()
    await screen.findByRole('option', { name: 'Base' })
    await userEvent.setup().selectOptions(screen.getByLabelText('Send to'), 'Base')
    expect(screen.queryByText(/Fundit account may not exist/)).toBeNull()
  })

  // Optimism's own name for its chain is OP Mainnet. Every chain label in the app uses it.
  it('labels the Optimism destination OP Mainnet', async () => {
    state.view = view()
    fakeSender()
    renderPage()
    expect(await screen.findByRole('option', { name: 'OP Mainnet' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Optimism' })).toBeNull()
  })

  // The organiser approved the fee shown. A higher fee at send time would take more than they agreed to.
  it('does not send when the fee rose since the preview, and shows the new fee', async () => {
    const fees = stubFees(200000)
    state.view = view()
    const send = fakeSender()
    renderPage()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Amount'), '10')
    await user.selectOptions(screen.getByLabelText('Send to'), 'Base')
    expect(await screen.findByText('0.20 USDC')).toBeTruthy()
    fees.high = 300000
    await user.click(button('Withdraw'))
    expect(await screen.findByText('The transfer fee changed. Check the new amount and confirm again.')).toBeTruthy()
    expect(send).not.toHaveBeenCalled()
    expect(screen.getByText('0.30 USDC')).toBeTruthy()
  })

  // A lower fee at send time is in the organiser's favour, and the cap must be the fresh one Circle quotes now.
  it('sends with the fresh fee cap when the fee dropped since the preview', async () => {
    const fees = stubFees(300000)
    state.view = view()
    const send = fakeSender()
    renderPage()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Amount'), '10')
    await user.selectOptions(screen.getByLabelText('Send to'), 'Base')
    expect(await screen.findByText('0.30 USDC')).toBeTruthy()
    fees.high = 200000
    await user.click(button('Withdraw'))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(decode(send.mock.calls[0]![0][0]!.data).args[3]).toBe(200000n)
  })

  // This refusal is the organiser's to fix, so it reads as plain advice, not as an unexpected failure.
  it('refuses an amount that no longer covers the fee with a plain message', async () => {
    const fees = stubFees(200000)
    state.view = view()
    const send = fakeSender()
    renderPage()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Amount'), '10')
    await user.selectOptions(screen.getByLabelText('Send to'), 'Base')
    expect(await screen.findByText('0.20 USDC')).toBeTruthy()
    fees.high = 20_000000
    await user.click(button('Withdraw'))
    const alert = await screen.findByText('This amount is too small to cover the transfer fee. Try a larger amount.', { selector: '.ui-status p' })
    expect(alert.textContent).not.toMatch(/Something went wrong/)
    expect(send).not.toHaveBeenCalled()
  })

  // The Arc receipt only proves the burn. The organiser must not read it as money already on Base.
  it('says a payout to another chain is sent from Arc and still arriving, and tracks it to the mint', async () => {
    stubFees(200000)
    state.view = view()
    fakeSender()
    renderPage()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Amount'), '10')
    await user.selectOptions(screen.getByLabelText('Send to'), 'Base')
    expect(await screen.findByText('0.20 USDC')).toBeTruthy()
    await user.click(button('Withdraw'))
    expect(await screen.findByText('Sent from Arc. It arrives on Base in about a minute.')).toBeTruthy()
    expect(screen.queryByText(/withdrawal went through/)).toBeNull()
    // 10 less the 1% fee is burned on Arc. Iris reports it by the Arc burn hash, from domain 26.
    expect(await screen.findByText(/9.9 USDC to Base is on its way/)).toBeTruthy()
    const saved = JSON.parse(localStorage.getItem('fundit.pendingBridges')!)
    expect(saved).toMatchObject([{ kind: 'payout', campaign: CAMPAIGN, burnTx: HASH, srcDomain: 26, destDomain: 6, amount: '9.9' }])
    const irisCalls = (fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map(([u]) => u).filter((u) => u.includes('/v2/messages/'))
    expect(irisCalls[0]).toBe(`https://iris-api.circle.com/v2/messages/26?transactionHash=${HASH}`)
  })

  it('keeps the plain success text for a payout on Arc, and tracks nothing', async () => {
    state.view = view()
    fakeSender()
    renderPage()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Amount'), '10')
    await user.click(button('Withdraw'))
    expect(await screen.findByText('Your withdrawal went through.')).toBeTruthy()
    expect(localStorage.getItem('fundit.pendingBridges')).toBeNull()
  })

  // A withdrawal that timed out may still be mined. Sending again could pay out twice.
  it('blocks a second withdrawal while the first is not confirmed', async () => {
    state.view = view()
    fakeSender('wallet', CREATOR, { status: 'timeout', hash: HASH, completed: 0 })
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
    // A payout into a Fundit account changes the balance My page and Send money out show.
    expect(keys).toContain(JSON.stringify(['account-balances']))
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
    await user.click(button('Close this Fundit'))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(text))
    expect(send).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    await user.click(button('Close this Fundit'))
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

  // A screen reader user on a bad link must hear which link is wrong and why, as on Create.
  it('ties a bad link to its error', async () => {
    state.view = view()
    const send = fakeSender()
    renderPage()
    const user = userEvent.setup()
    const link = screen.getByLabelText('Link 1')
    expect(link.getAttribute('aria-invalid')).toBeNull()
    await user.type(link, 'http://example.com')
    await user.click(button('Save changes'))
    const error = await screen.findByText('Use a full link that starts with https://')
    expect(link.getAttribute('aria-invalid')).toBe('true')
    expect(link.getAttribute('aria-describedby')).toBe(error.id)
    expect(send).not.toHaveBeenCalled()
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

  // Recovery goes to the backup, so a mistyped backup could take the Fundit away from its organiser.
  it('refuses a backup address with a bad checksum', async () => {
    state.view = view()
    fakeSender()
    renderPage()
    await userEvent.setup().type(screen.getByLabelText('New backup address'), '0xaBcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD')
    expect(screen.getByText('This address has a typo. Check it and paste it again.')).toBeTruthy()
    expect(button('Save backup').disabled).toBe(true)
  })

  // setBackup(creator) reverts InvalidBackup, so the form catches it first.
  it('refuses the organiser address as the backup', async () => {
    state.view = view()
    fakeSender()
    renderPage()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('New backup address'), CREATOR)
    expect(screen.getByText('Use a different address from your Fundit account.')).toBeTruthy()
    expect(button('Save backup').disabled).toBe(true)
  })
  describe('rescue tokens sent by mistake', () => {
    const OTHER = getAddress('0x4444444444444444444444444444444444444444')
    const rescue = () => screen.queryByRole('heading', { name: 'Rescue tokens sent by mistake' })
    const sendTo = () => screen.getByRole('textbox', { name: 'Send to' })

    // Nothing to rescue means nothing to show, so organisers are not asked about a balance they do not have.
    it('is hidden when the Fundit holds none of the other token', async () => {
      state.view = view()
      fakeSender('passkey')
      renderPage()
      await waitFor(() => expect(reads.some((r) => r.functionName === 'balanceOf')).toBe(true))
      expect(rescue()).toBeNull()
    })

    // A USDC Fundit can only be sent EURC by mistake, and the line must name what is really there.
    it('shows EURC sent to a USDC Fundit, with the amount and symbol', async () => {
      state.view = view()
      state.stray = 100000n
      fakeSender('passkey')
      renderPage()
      expect(await screen.findByRole('heading', { name: 'Rescue tokens sent by mistake' })).toBeTruthy()
      const read = reads.find((r) => r.functionName === 'balanceOf')!
      expect(read.address).toBe(TOKENS.EURC.address)
      expect(read.args).toEqual([CAMPAIGN])
      expect(
        screen.getByText(
          'Someone sent 0.10 EURC to this Fundit. It only accepts USDC, so this money is not part of what was raised. You can send it to any address on Arc.',
        ),
      ).toBeTruthy()
      expect(button('Rescue 0.10 EURC')).toBeTruthy()
    })

    it('shows USDC sent to a EURC Fundit, with the amount and symbol', async () => {
      state.view = { ...view({ token: TOKENS.EURC.address }), symbol: 'EURC' }
      state.stray = 2_500000n
      fakeSender('passkey')
      renderPage()
      expect(await screen.findByText(/^Someone sent 2.50 USDC to this Fundit\. It only accepts EURC,/)).toBeTruthy()
      expect(reads.find((r) => r.functionName === 'balanceOf')!.address).toBe(TOKENS.USDC.address)
      expect(button('Rescue 2.50 USDC')).toBeTruthy()
    })

    // sweep(other, to) moves the whole balance of other. A wrong token or recipient sends money astray.
    it('sends sweep(other token, recipient), to the organiser by default', async () => {
      state.view = view()
      state.stray = 100000n
      const send = fakeSender('passkey')
      renderPage()
      const user = userEvent.setup()
      await screen.findByRole('heading', { name: 'Rescue tokens sent by mistake' })
      expect((sendTo() as HTMLInputElement).value).toBe(CREATOR)
      await user.click(button('Rescue 0.10 EURC'))
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
      const [calls, opts] = send.mock.calls[0]! as unknown as [Call[], { label: string }]
      expect(calls[0]!.to).toBe(CAMPAIGN)
      expect(decode(calls[0]!.data)).toMatchObject({ functionName: 'sweep', args: [TOKENS.EURC.address, CREATOR] })
      expect(opts.label).toBe('Rescue')

      // Another recipient is sent as typed.
      cleanup()
      const send2 = fakeSender('passkey')
      renderPage()
      await screen.findByRole('heading', { name: 'Rescue tokens sent by mistake' })
      await user.clear(sendTo())
      await user.type(sendTo(), OTHER)
      await user.click(button('Rescue 0.10 EURC'))
      await waitFor(() => expect(send2).toHaveBeenCalledTimes(1))
      expect(decode(send2.mock.calls[0]![0][0]!.data).args).toEqual([TOKENS.EURC.address, OTHER])
    })

    // sweep(other, 0x0) reverts, and a typo would send the money to an address nobody holds.
    it('refuses a bad, mistyped or zero recipient', async () => {
      state.view = view()
      state.stray = 100000n
      const send = fakeSender('passkey')
      renderPage()
      const user = userEvent.setup()
      await screen.findByRole('heading', { name: 'Rescue tokens sent by mistake' })
      await user.clear(sendTo())
      await user.type(sendTo(), '0x1234')
      expect(screen.getByText('Enter a valid address: 0x and 40 characters.')).toBeTruthy()
      expect(button('Rescue 0.10 EURC').disabled).toBe(true)

      await user.clear(sendTo())
      await user.type(sendTo(), '0xaBcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD')
      expect(screen.getByText('This address has a typo. Check it and paste it again.')).toBeTruthy()
      expect(button('Rescue 0.10 EURC').disabled).toBe(true)

      await user.clear(sendTo())
      await user.type(sendTo(), '0x0000000000000000000000000000000000000000')
      expect(screen.getByText('Enter a recipient address.')).toBeTruthy()
      expect(button('Rescue 0.10 EURC').disabled).toBe(true)
      await user.click(button('Rescue 0.10 EURC'))
      expect(send).not.toHaveBeenCalled()
    })

    // After the sweep the balance is 0, so a fresh read must drop the form instead of offering a second rescue.
    it('says what was sent and reads the balance again after success', async () => {
      state.view = view()
      state.stray = 100000n
      fakeSender('passkey')
      renderPage()
      const user = userEvent.setup()
      await screen.findByRole('heading', { name: 'Rescue tokens sent by mistake' })
      const before = reads.filter((r) => r.functionName === 'balanceOf').length
      state.stray = 0n
      await user.click(button('Rescue 0.10 EURC'))
      expect(await screen.findByText('Sent 0.10 EURC.')).toBeTruthy()
      expect(screen.getByRole('link', { name: 'View it on the Arc explorer' }).getAttribute('href')).toContain(HASH)
      await waitFor(() => expect(reads.filter((r) => r.functionName === 'balanceOf').length).toBeGreaterThan(before))
      await waitFor(() => expect(screen.queryByRole('button', { name: /^Rescue/ })).toBeNull())
      expect(screen.queryByText(/^Someone sent/)).toBeNull()
    })

    // A rescue sends from the Fundit account, so the sender's network fee refusal must show here too.
    it("shows the sender's network fee refusal on a rescue", async () => {
      state.view = view()
      state.stray = 100000n
      const send = fakeSender('passkey')
      send.mockRejectedValueOnce(new NeedsNetworkFee(250_000n))
      renderPage()
      await screen.findByRole('heading', { name: 'Rescue tokens sent by mistake' })
      await userEvent.setup().click(button('Rescue 0.10 EURC'))
      expect(await screen.findByText(/Your Fundit account needs at least 0.25 USDC for the network fee\./)).toBeTruthy()
    })
  })
})

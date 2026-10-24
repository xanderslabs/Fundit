import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import {
  type Address,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  type Hex,
  type TransactionReceipt,
} from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { factoryAbi } from '../abi/factory'
import { FACTORY_ADDRESS, TOKENS } from '../config'
import type { Sender, TxResult } from '../lib/sender'
import { Create } from './Create'

const ME = '0x1111111111111111111111111111111111111111' as Address
const NEW_CAMPAIGN = '0x00000000000000000000000000000000000000c7' as Address
const HASH = `0x${'ab'.repeat(32)}` as Hex

const state: { sender: Sender | null } = { sender: null }
vi.mock('../hooks/useSender', () => ({ useSender: () => state.sender }))
// Nothing here connects a wallet: the wallet setup loads only inside Add money, so importing it fails the test.
vi.mock('../wagmi', () => {
  throw new Error('Create loaded the wallet setup')
})
// What "Check again" gets back on the wallet path. The default throws so an unplanned re-check is loud.
const recheck: { next: () => Promise<TxResult> } = { next: async () => { throw new Error('no re-check planned') } }
vi.mock('../lib/sender', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/sender')>()),
  waitForResult: () => recheck.next(),
}))
vi.mock('../hooks/useCampaigns', () => ({
  useFactoryFees: () => ({ data: { donationFeeBps: 0, withdrawFeeBps: 250 }, isPending: false, isError: false }),
}))

function fakeSender(result: TxResult) {
  const send = vi.fn(async () => result)
  state.sender = { kind: 'wallet', address: ME, send }
  return send
}

// The receipt the wallet returns: one CampaignCreated log from the factory, as the RPC encodes it.
function createdReceipt(): TransactionReceipt {
  const topics = encodeEventTopics({
    abi: factoryAbi,
    eventName: 'CampaignCreated',
    args: { campaign: NEW_CAMPAIGN, creator: ME, token: TOKENS.USDC.address },
  }) as Hex[]
  const data = encodeAbiParameters([{ type: 'uint256' }, { type: 'uint16' }, { type: 'uint16' }], [5_000_000n, 0, 250])
  return {
    status: 'success',
    transactionHash: HASH,
    logs: [{ address: FACTORY_ADDRESS, topics, data, blockNumber: 1n, logIndex: 0, transactionHash: HASH }],
  } as unknown as TransactionReceipt
}

function CampaignStub() {
  return <p>Campaign {useParams().address?.toLowerCase()}</p>
}

function renderCreate() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/create']}>
        <Routes>
          <Route path="/create" element={<Create />} />
          <Route path="/c/:address" element={<CampaignStub />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function fillValid() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Title'), 'Clean water')
  await user.type(screen.getByLabelText(/^Goal/), '5')
  return user
}

// After a create, the page stays here with the new Fundit's link and share options, then opens the Fundit.
async function expectCreated(user: ReturnType<typeof userEvent.setup>) {
  expect(await screen.findByRole('heading', { level: 1, name: 'Your Fundit is live' })).toBeTruthy()
  const go = screen.getByRole('link', { name: 'Go to your Fundit' })
  expect(go.getAttribute('href')?.toLowerCase()).toBe(`/c/${NEW_CAMPAIGN}`)
  await user.click(go)
  expect(await screen.findByText(`Campaign ${NEW_CAMPAIGN}`)).toBeTruthy()
}

const submitButton = () => screen.getByRole('button', { name: 'Create a Fundit' })

afterEach(() => {
  cleanup()
  state.sender = null
  recheck.next = async () => {
    throw new Error('no re-check planned')
  }
})

describe('Create signed out', () => {
  // Signed out, /create stays put and asks to sign in, so the form appears here once a wallet connects.
  it('shows the sign-in screen and no form', () => {
    renderCreate()
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to continue' })).toBeTruthy()
    expect(screen.getByText('Start a Fundit here: tell your story and set your goal.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go home' }).getAttribute('href')).toBe('/')
    expect(screen.queryByLabelText('Title')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create a Fundit' })).toBeNull()
  })

  it('Sign in opens the sign-in dialog, never a separate wallet modal', async () => {
    renderCreate()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }))
    expect(within(screen.getByRole('dialog', { name: 'Sign in' })).getByRole('button', { name: 'Connect a wallet' })).toBeTruthy()
  })

  it('shows the form once signed in, without leaving /create', () => {
    const view = renderCreate()
    expect(screen.queryByLabelText('Title')).toBeNull()
    fakeSender({ status: 'rejected', completed: 0 })
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/create']}>
          <Routes>
            <Route path="/create" element={<Create />} />
            <Route path="/c/:address" element={<CampaignStub />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Start a Fundit' })).toBeTruthy()
    expect(screen.getByLabelText('Title')).toBeTruthy()
  })
})

describe('Create', () => {
  // The contract would revert anyway, but a person should never pay gas to learn the form was wrong.
  it('keeps submit disabled while the form is invalid', async () => {
    fakeSender({ status: 'rejected', completed: 0 })
    renderCreate()
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true)
    const user = await fillValid()
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false)
    await user.type(screen.getByLabelText(/^Backup address/), ME)
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/different address/)).toBeTruthy()
  })

  it('shows the factory fees before submit', () => {
    fakeSender({ status: 'rejected', completed: 0 })
    renderCreate()
    expect(screen.getByText(/2\.5% of each withdrawal/)).toBeTruthy()
  })

  // The new address only exists in the receipt log, so the page must read it there, not guess it.
  it('sends createCampaign and opens the new campaign from the receipt log', async () => {
    const send = fakeSender({ status: 'success', hash: HASH, receipt: createdReceipt() })
    renderCreate()
    const user = await fillValid()
    await user.click(submitButton())
    await expectCreated(user)

    const [calls] = send.mock.calls[0]! as unknown as [{ to: Address; data: Hex }[]]
    expect(calls).toHaveLength(1)
    expect(calls[0]!.to).toBe(FACTORY_ADDRESS)
    const decoded = decodeFunctionData({ abi: factoryAbi, data: calls[0]!.data })
    expect(decoded.functionName).toBe('createCampaign')
    expect(decoded.args?.[0]).toBe(TOKENS.USDC.address)
    expect(decoded.args?.[1]).toBe(5_000_000n)
  })

  // The moment after creating is when the organiser is most likely to share, so the share options show here,
  // written in the organiser's voice.
  it('shows the share panel with the creator message after a create', async () => {
    fakeSender({ status: 'success', hash: HASH, receipt: createdReceipt() })
    renderCreate()
    const user = await fillValid()
    await user.click(submitButton())
    expect(await screen.findByRole('heading', { name: 'Share this Fundit' })).toBeTruthy()
    expect(screen.getByText(/^I started a Fundit for Clean water\. Every gift helps: /)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
  })

  // A dropped or slow transaction must never look like success.
  // Creating spends no USDC in its calls but still pays the network fee. A short account is refused by the wallet
  // or the node for insufficient funds, and the page shows that with a way to add money.
  it("shows the sender's network fee refusal with an Add money link", async () => {
    const send = vi.fn(async () => {
      throw new Error('insufficient funds for gas * price + value')
    })
    state.sender = { kind: 'wallet', address: ME, send }
    renderCreate()
    const user = await fillValid()
    await user.click(submitButton())
    expect(await screen.findByText(/Your Fundit account does not have enough USDC for the network fee\. Add money and try again\./)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Add money' }).getAttribute('href')).toBe('/me?add=1')
  })

  it('shows not confirmed yet with an explorer link on timeout', async () => {
    fakeSender({ status: 'timeout', hash: HASH, completed: 0 })
    renderCreate()
    const user = await fillValid()
    await user.click(submitButton())
    expect(await screen.findByText(/not confirmed yet/)).toBeTruthy()
    const link = screen.getByRole('link', { name: /explorer/i })
    expect(link.getAttribute('href')).toBe(`https://explorer.arc.io/tx/${HASH}`)
    expect(screen.queryByText(/^Campaign /)).toBeNull()
  })

  describe('Check again', () => {
    it('rechecks on the Arc RPC, with the explorer link, and opens the new campaign from the receipt', async () => {
      fakeSender({ status: 'timeout', hash: HASH, completed: 0 })
      recheck.next = async () => ({ status: 'success', hash: HASH, receipt: createdReceipt() })
      renderCreate()
      const user = await fillValid()
      await user.click(submitButton())
      expect(await screen.findByText(/not confirmed yet/)).toBeTruthy()
      expect(screen.getByRole('link', { name: /explorer/i }).getAttribute('href')).toBe(`https://explorer.arc.io/tx/${HASH}`)
      await user.click(screen.getByRole('button', { name: 'Check again' }))
      await expectCreated(user)
    })

    // A check that throws must not leave the page on "Checking..." forever, and must not invite a second create.
    it('falls back to not confirmed yet with a note when the check throws', async () => {
      fakeSender({ status: 'timeout', hash: HASH, completed: 0 })
      recheck.next = async () => {
        throw new Error('RPC down')
      }
      renderCreate()
      const user = await fillValid()
      await user.click(submitButton())
      await user.click(await screen.findByRole('button', { name: 'Check again' }))
      // A failed check must not read as "send again": the transaction may still go through.
    expect(await screen.findByText('We could not check it. Check again in a minute.')).toBeTruthy()
      expect(screen.getByText(/not confirmed yet/)).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy()
    })

    // A second click while the first create may still be mined would make two fundraisers.
    it('blocks a new create during a timeout until a confirmed Start over', async () => {
      const send = fakeSender({ status: 'timeout', hash: HASH, completed: 0 })
      renderCreate()
      const user = await fillValid()
      await user.click(submitButton())
      await screen.findByText(/not confirmed yet/)
      expect((submitButton() as HTMLButtonElement).disabled).toBe(true)
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      await user.click(screen.getByRole('button', { name: 'Start over' }))
      expect((submitButton() as HTMLButtonElement).disabled).toBe(true)
      confirm.mockReturnValue(true)
      await user.click(screen.getByRole('button', { name: 'Start over' }))
      expect((submitButton() as HTMLButtonElement).disabled).toBe(false)
      expect(send).toHaveBeenCalledTimes(1)
      confirm.mockRestore()
    })
  })
})

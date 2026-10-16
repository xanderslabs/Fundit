import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
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
vi.mock('../hooks/useCampaigns', () => ({
  useFactoryFees: () => ({ data: { donationFeeBps: 0, withdrawFeeBps: 250 }, isPending: false, isError: false }),
}))

function fakeSender(result: TxResult) {
  const send = vi.fn(async () => result)
  state.sender = { kind: 'eoa', address: ME, send }
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

const submitButton = () => screen.getByRole('button', { name: 'Create fundraiser' })

afterEach(() => {
  cleanup()
  state.sender = null
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
    expect(await screen.findByText(`Campaign ${NEW_CAMPAIGN}`)).toBeTruthy()

    const [calls] = send.mock.calls[0]! as unknown as [{ to: Address; data: Hex }[]]
    expect(calls).toHaveLength(1)
    expect(calls[0]!.to).toBe(FACTORY_ADDRESS)
    const decoded = decodeFunctionData({ abi: factoryAbi, data: calls[0]!.data })
    expect(decoded.functionName).toBe('createCampaign')
    expect(decoded.args?.[0]).toBe(TOKENS.USDC.address)
    expect(decoded.args?.[1]).toBe(5_000_000n)
  })

  // A dropped or slow transaction must never look like success.
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
})

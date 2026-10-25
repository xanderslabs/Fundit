// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type Address, encodeAbiParameters, encodeErrorResult, encodeEventTopics, zeroAddress } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { factoryAbi } from '../../src/abi/factory'
import { ARC_CHAIN_ID } from '../../src/config'
import { CANCELLED } from '../../src/lib/errors'
import type { AdminSession } from './lib/api'
import type { FactoryState } from './lib/factoryState'
import { fetchSnapshot } from './lib/snapshot'
import { OwnerControls } from './OwnerControls'

const OWNER = '0x3552E9c14C7b6050839009A5B160A4446a1e916D' as Address
const FACTORY = '0x6890D40a9A472D0d05aDb5938D85B07059ad54ab' as Address
const HASH = `0x${'ab'.repeat(32)}` as const

const wagmi = vi.hoisted(() => ({
  getAccount: vi.fn(),
  watchAccount: vi.fn(() => () => {}),
  simulateContract: vi.fn(),
  writeContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}))
vi.mock('@wagmi/core', () => wagmi)
vi.mock('../../src/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/config')>()),
  FACTORY_ADDRESS: '0x6890D40a9A472D0d05aDb5938D85B07059ad54ab',
}))
vi.mock('./wagmi', () => ({ adminWagmiConfig: {} }))
vi.mock('../../src/components/ConnectWallet', () => ({ ConnectWallet: () => <p>connect</p> }))
vi.mock('../../src/lib/clients', () => ({ arcClient: { readContract: vi.fn(async () => true) } }))
const state = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('./lib/factoryState', () => ({ readFactoryState: state.read }))
vi.mock('./lib/snapshot', () => ({ fetchSnapshot: vi.fn(async () => []) }))

const session: AdminSession = { address: OWNER, network: 'testnet', chainId: ARC_CHAIN_ID, factory: FACTORY }
const factoryState: FactoryState = {
  owner: OWNER,
  pendingOwner: zeroAddress,
  donationFeeBps: 250,
  withdrawFeeBps: 50,
  treasury: '0x4444444444444444444444444444444444444444',
  featured: zeroAddress,
  paused: false,
  treasuryBalance: { USDC: 0n, EURC: 0n },
}

function feesReceipt() {
  const topics = encodeEventTopics({ abi: factoryAbi, eventName: 'FeesUpdated' })
  const data = encodeAbiParameters([{ type: 'uint16' }, { type: 'uint16' }], [100, 50])
  return { status: 'success', logs: [{ address: FACTORY, topics, data, blockNumber: 1n, logIndex: 0, transactionIndex: 0, transactionHash: HASH, blockHash: HASH, removed: false }] }
}

async function submitFees(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('button', { name: 'Review fee change' })
  await user.type(screen.getByLabelText('Donation fee (bps)'), '100')
  await user.type(screen.getByLabelText('Withdraw fee (bps)'), '50')
  await user.click(screen.getByRole('button', { name: 'Review fee change' }))
}

beforeEach(() => {
  state.read.mockResolvedValue(factoryState)
  wagmi.getAccount.mockReturnValue({ address: OWNER, chainId: ARC_CHAIN_ID })
  wagmi.simulateContract.mockResolvedValue({ request: {} })
  wagmi.writeContract.mockResolvedValue(HASH)
  wagmi.waitForTransactionReceipt.mockResolvedValue(feesReceipt())
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OwnerControls session={session} />
    </QueryClientProvider>,
  )
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('OwnerControls', () => {
  it('a simulate revert shows revertText and sends nothing', async () => {
    const data = encodeErrorResult({ abi: factoryAbi, errorName: 'OwnableUnauthorizedAccount', args: [OWNER] })
    wagmi.simulateContract.mockRejectedValue({ name: 'ContractFunctionExecutionError', data })
    const user = userEvent.setup()
    await submitFees(user)
    expect(await screen.findByText('Only the Fundit owner can do this.')).toBeTruthy()
    expect(wagmi.writeContract).not.toHaveBeenCalled()
  })

  it('a wallet cancel shows CANCELLED', async () => {
    wagmi.writeContract.mockRejectedValue({ name: 'UserRejectedRequestError', code: 4001 })
    const user = userEvent.setup()
    await submitFees(user)
    await user.click(await screen.findByRole('button', { name: 'Confirm and sign' }))
    expect(await screen.findByText(CANCELLED)).toBeTruthy()
  })

  it('sends nothing until Confirm is pressed', async () => {
    const user = userEvent.setup()
    await submitFees(user)
    await screen.findByRole('button', { name: 'Confirm and sign' })
    expect(wagmi.simulateContract).toHaveBeenCalledTimes(1)
    expect(wagmi.writeContract).not.toHaveBeenCalled()
  })

  it('shows the emitted event after the receipt', async () => {
    const user = userEvent.setup()
    await submitFees(user)
    await user.click(await screen.findByRole('button', { name: 'Confirm and sign' }))
    const done = await screen.findByRole('status')
    expect(done.textContent).toContain('FeesUpdated')
    expect(done.textContent).toContain('100 bps')
    expect(done.textContent).toContain('50 bps')
    // The factory state is read again after the confirmed write.
    await waitFor(() => expect(state.read.mock.calls.length).toBeGreaterThan(1))
  })

  it('has no button for renounceOwnership or transferOwnership', async () => {
    await screen.findByRole('button', { name: 'Review fee change' })
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/renounce|transfer ownership|transferOwnership/i)
    expect(within(document.body).queryByRole('button', { name: /owner/i })).toBeNull()
  })

  it('the featured picker starts on the current featured Fundit', async () => {
    cleanup()
    const current = '0x5555555555555555555555555555555555555555' as Address
    const other = '0x6666666666666666666666666666666666666666' as Address
    vi.mocked(fetchSnapshot).mockResolvedValue([{ address: current, isTest: false }, { address: other, isTest: false }] as never)
    state.read.mockResolvedValue({ ...factoryState, featured: current })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <OwnerControls session={session} />
      </QueryClientProvider>,
    )
    const radios = await screen.findAllByRole('radio')
    await waitFor(() => expect(radios).toHaveLength(3))
    const picker = within(screen.getByRole('group', { name: 'Pick the Fundit to feature' }))
    const [none, first, second] = picker.getAllByRole('radio') as HTMLInputElement[]
    expect([none!.checked, first!.checked, second!.checked]).toEqual([false, true, false])
    // A choice the owner makes is kept.
    await userEvent.setup().click(second!)
    expect(second!.checked).toBe(true)
    vi.mocked(fetchSnapshot).mockResolvedValue([])
  })
})

// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type Address, encodeErrorResult, zeroAddress } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { factoryAbi } from '../../../src/abi/factory'
import type { AdminSession } from '../lib/api'
import type { FactoryState } from '../lib/factoryState'
import { type AdminNetwork, ADMIN_NETWORKS } from '../lib/networks'
import { fetchSnapshot } from '../lib/snapshot'
import { SettingsPage } from './SettingsPage'

const OWNER = '0x3552E9c14C7b6050839009A5B160A4446a1e916D' as Address
const TESTNET = ADMIN_NETWORKS.testnet.chainId
const MAINNET = ADMIN_NETWORKS.mainnet.chainId
const HASH = `0x${'ab'.repeat(32)}` as const
// Lower case, so it is a valid address without a checksum; the typed confirm takes any case.
const NEW_TREASURY = '0x333333333333333333333333333333333333abcd' as Address

const wagmi = vi.hoisted(() => ({
  getAccount: vi.fn(),
  watchAccount: vi.fn(() => () => {}),
  switchChain: vi.fn(),
  simulateContract: vi.fn(),
  writeContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}))
vi.mock('@wagmi/core', () => wagmi)
vi.mock('../wagmi', () => ({ adminWagmiConfig: {} }))
vi.mock('../../../src/components/ConnectWallet', () => ({ ConnectWallet: () => <p>connect</p> }))
// isCampaign: only the two snapshot Fundits below are Fundits.
const FUNDIT_A = '0x5555555555555555555555555555555555555555' as Address
const FUNDIT_B = '0x6666666666666666666666666666666666666666' as Address
// gate holds the isCampaign read open, so a test can click again while a review waits on the RPC.
const rpc = vi.hoisted(() => ({ gate: null as Promise<void> | null }))
vi.mock('../lib/clients', () => ({
  readClient: () => ({
    readContract: vi.fn(async ({ args }: { args: [Address] }) => {
      if (rpc.gate) await rpc.gate
      return [FUNDIT_A, FUNDIT_B].includes(args[0])
    }),
  }),
}))

function deferred() {
  let release!: () => void
  const promise = new Promise<void>((r) => (release = r))
  return { promise, release }
}
const state = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../lib/factoryState', () => ({ readFactoryState: state.read }))
vi.mock('../lib/snapshot', () => ({ fetchSnapshot: vi.fn(async () => []) }))
const panel = vi.hoisted(() => ({ network: 'testnet' as AdminNetwork }))
const session: AdminSession = {
  address: OWNER,
  networks: {
    mainnet: { chainId: MAINNET, factory: ADMIN_NETWORKS.mainnet.factory, owner: true },
    testnet: { chainId: TESTNET, factory: ADMIN_NETWORKS.testnet.factory, owner: true },
  },
}
vi.mock('../ui/Shell', () => ({ usePanel: () => ({ session, network: panel.network, showTest: false }) }))
const scan = vi.hoisted(() => ({ nudge: vi.fn() }))
vi.mock('../scan/ScanProvider', () => ({
  useScan: () => ({ state: null, status: { kind: 'scanning' }, progress: { readTo: 0n, head: 0n }, canSave: true, rescan: vi.fn(), nudge: scan.nudge }),
}))

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

function show(network: AdminNetwork = 'testnet') {
  panel.network = network
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SettingsPage />
    </QueryClientProvider>,
  )
}

async function reviewFees(user: ReturnType<typeof userEvent.setup>) {
  const donation = await screen.findByLabelText('Donation fee (bps)')
  await user.clear(donation)
  await user.type(donation, '100')
  await user.click(screen.getByRole('button', { name: 'Review fee change' }))
}

beforeEach(() => {
  state.read.mockResolvedValue(factoryState)
  wagmi.getAccount.mockReturnValue({ address: OWNER, chainId: TESTNET })
  wagmi.switchChain.mockResolvedValue({ id: MAINNET })
  wagmi.simulateContract.mockResolvedValue({ request: { marker: 'simulated' } })
  wagmi.writeContract.mockResolvedValue(HASH)
  wagmi.waitForTransactionReceipt.mockResolvedValue({ status: 'success', logs: [] })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.mocked(fetchSnapshot).mockResolvedValue([])
  rpc.gate = null
})

describe('SettingsPage', () => {
  it('shows current settings, controls and the danger zone', async () => {
    show()
    expect(await screen.findByRole('heading', { name: 'Current settings' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Controls' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Danger zone' })).toBeTruthy()
    expect(await screen.findByText('EURC payout domain')).toBeTruthy()
  })

  // A call that would revert must never reach the wallet: the reason shows and there is nothing to sign.
  it('a simulation that rejects shows the reason and no Sign button', async () => {
    const data = encodeErrorResult({ abi: factoryAbi, errorName: 'OwnableUnauthorizedAccount', args: [OWNER] })
    wagmi.simulateContract.mockRejectedValue({ name: 'ContractFunctionExecutionError', data })
    show()
    const user = userEvent.setup()
    await reviewFees(user)
    expect(await screen.findByText('Only the Fundit owner can do this.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /sign/i })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(wagmi.writeContract).not.toHaveBeenCalled()
  })

  it('on mainnet the confirm dialog says it uses real USDC and names the network', async () => {
    wagmi.getAccount.mockReturnValue({ address: OWNER, chainId: MAINNET })
    show('mainnet')
    const user = userEvent.setup()
    await reviewFees(user)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Mainnet: this uses real USDC for gas')
    expect(within(dialog).getByRole('heading').textContent).toContain('on Arc Mainnet')
    // Nothing is sent until the owner signs.
    expect(wagmi.writeContract).not.toHaveBeenCalled()
  })

  // Review Focus 2: never simulate or send against the wrong chain's factory.
  it('switches the wallet to the selected network before simulating', async () => {
    wagmi.getAccount.mockReturnValue({ address: OWNER, chainId: TESTNET })
    show('mainnet')
    const user = userEvent.setup()
    await reviewFees(user)
    await screen.findByRole('dialog')
    expect(wagmi.switchChain).toHaveBeenCalledWith({}, { chainId: MAINNET })
    expect(wagmi.switchChain.mock.invocationCallOrder[0]!).toBeLessThan(wagmi.simulateContract.mock.invocationCallOrder[0]!)
    expect(wagmi.simulateContract.mock.calls[0]![1]).toMatchObject({ address: ADMIN_NETWORKS.mainnet.factory, chainId: MAINNET, account: OWNER })
  })

  it('a refused chain switch simulates nothing', async () => {
    wagmi.switchChain.mockRejectedValue({ name: 'UserRejectedRequestError', code: 4001 })
    show('mainnet')
    const user = userEvent.setup()
    await reviewFees(user)
    await waitFor(() => expect(wagmi.switchChain).toHaveBeenCalled())
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(wagmi.simulateContract).not.toHaveBeenCalled()
  })

  it('signs the simulated request, then refreshes the settings and the scan', async () => {
    show()
    const user = userEvent.setup()
    await reviewFees(user)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).not.toContain('Mainnet: this uses real USDC for gas')
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and sign' }))
    expect(await screen.findByText('Confirmed')).toBeTruthy()
    expect(wagmi.writeContract.mock.calls[0]![1]).toEqual({ marker: 'simulated' })
    expect(wagmi.waitForTransactionReceipt).toHaveBeenCalledWith({}, { hash: HASH, chainId: TESTNET })
    await waitFor(() => expect(state.read.mock.calls.length).toBeGreaterThan(1))
    expect(scan.nudge).toHaveBeenCalled()
  })

  it('a receipt-wait error keeps the hash and its explorer link', async () => {
    wagmi.waitForTransactionReceipt.mockRejectedValue(new Error('timed out'))
    show()
    const user = userEvent.setup()
    await reviewFees(user)
    await user.click(await screen.findByRole('button', { name: 'Confirm and sign' }))
    expect(await screen.findByText('Failed')).toBeTruthy()
    const link = screen.getByRole('link', { name: /view transaction/i }) as HTMLAnchorElement
    expect(link.href).toBe(`${ADMIN_NETWORKS.testnet.explorerUrl}/tx/${HASH}`)
    // It may still land, so the settings and the scan are read again anyway.
    await waitFor(() => expect(state.read.mock.calls.length).toBeGreaterThan(1))
    expect(scan.nudge).toHaveBeenCalled()
  })

  // One review at a time: a second click (on the same control or another) while a review waits on the RPC or the
  // simulation must not start a second flow, or the wallet could be asked twice, or asked to sign a call the
  // dialog does not describe.
  describe('concurrent reviews', () => {
    beforeEach(() => {
      wagmi.simulateContract.mockImplementation(async (_c: unknown, call: { functionName: string }) => ({ request: { functionName: call.functionName } }))
      vi.mocked(fetchSnapshot).mockResolvedValue([{ address: FUNDIT_A, isTest: false }] as never)
    })

    it('a double click on Review featured change signs once', async () => {
      show()
      fireEvent.click(await screen.findByRole('radio', { name: /0x5555/ }))
      const gate = deferred()
      rpc.gate = gate.promise
      const button = screen.getByRole('button', { name: 'Review featured change' })
      fireEvent.click(button)
      fireEvent.click(button)
      await act(async () => gate.release())
      expect(await screen.findByText('Confirmed')).toBeTruthy()
      expect(wagmi.simulateContract).toHaveBeenCalledTimes(1)
      expect(wagmi.writeContract).toHaveBeenCalledTimes(1)
    })

    it('Review fee change during the featured check starts nothing', async () => {
      show()
      const donation = await screen.findByLabelText('Donation fee (bps)')
      fireEvent.change(donation, { target: { value: '100' } })
      fireEvent.click(await screen.findByRole('radio', { name: /0x5555/ }))
      const gate = deferred()
      rpc.gate = gate.promise
      fireEvent.click(screen.getByRole('button', { name: 'Review featured change' }))
      fireEvent.click(screen.getByRole('button', { name: 'Review fee change' }))
      await act(async () => gate.release())
      expect(await screen.findByText('Confirmed')).toBeTruthy()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(wagmi.simulateContract).toHaveBeenCalledTimes(1)
      expect(wagmi.writeContract).toHaveBeenCalledTimes(1)
      expect(wagmi.writeContract.mock.calls[0]![1]).toEqual({ functionName: 'setFeatured' })
    })

    it('the dialog signs the call it describes when a second review is clicked during the simulation', async () => {
      const sim = deferred()
      wagmi.simulateContract.mockImplementation(async (_c: unknown, call: { functionName: string }) => {
        await sim.promise
        return { request: { functionName: call.functionName } }
      })
      show()
      const donation = await screen.findByLabelText('Donation fee (bps)')
      fireEvent.change(donation, { target: { value: '100' } })
      fireEvent.click(await screen.findByRole('radio', { name: /0x5555/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Review fee change' }))
      fireEvent.click(screen.getByRole('button', { name: 'Review featured change' }))
      await act(async () => sim.release())
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('heading').textContent).toContain('Change fees')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and sign' }))
      expect(await screen.findByText('Confirmed')).toBeTruthy()
      expect(wagmi.writeContract).toHaveBeenCalledTimes(1)
      expect(wagmi.writeContract.mock.calls[0]![1]).toEqual({ functionName: 'setFees' })
    })
  })

  it('a fee change that keeps the current values is refused before any simulation', async () => {
    show()
    const user = userEvent.setup()
    await screen.findByLabelText('Donation fee (bps)')
    await user.click(screen.getByRole('button', { name: 'Review fee change' }))
    expect(await screen.findByText('Those are the current fees. Change one to review.')).toBeTruthy()
    expect(wagmi.simulateContract).not.toHaveBeenCalled()
  })

  it('fees above 500 bps are refused before any simulation', async () => {
    show()
    const user = userEvent.setup()
    const donation = await screen.findByLabelText('Donation fee (bps)')
    await user.clear(donation)
    await user.type(donation, '501')
    await user.click(screen.getByRole('button', { name: 'Review fee change' }))
    expect(await screen.findByText('The donation fee cannot be above 500 bps (5%).')).toBeTruthy()
    expect(wagmi.simulateContract).not.toHaveBeenCalled()
  })

  it('the zero-address treasury is refused before any simulation', async () => {
    show()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('New treasury address'), zeroAddress)
    await user.type(screen.getByLabelText('Enter it again to confirm'), zeroAddress)
    await user.click(screen.getByRole('button', { name: 'Review treasury change' }))
    expect(await screen.findByText('The treasury cannot be the zero address.')).toBeTruthy()
    expect(wagmi.simulateContract).not.toHaveBeenCalled()
  })

  it('the treasury signs only after the last 4 characters are typed', async () => {
    show()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('New treasury address'), NEW_TREASURY)
    await user.type(screen.getByLabelText('Enter it again to confirm'), NEW_TREASURY)
    await user.click(screen.getByRole('button', { name: 'Review treasury change' }))
    const dialog = await screen.findByRole('dialog')
    const sign = within(dialog).getByRole('button', { name: 'Confirm and sign' }) as HTMLButtonElement
    expect(sign.disabled).toBe(true)
    const typed = within(dialog).getByLabelText('Type the last 4 characters of the new address to confirm.')
    await user.type(typed, 'abce')
    expect(sign.disabled).toBe(true)
    await user.clear(typed)
    await user.type(typed, 'ABCD')
    expect(sign.disabled).toBe(false)
    await user.click(sign)
    await waitFor(() => expect(wagmi.writeContract).toHaveBeenCalledTimes(1))
  })

  it('the pause dialog says what pausing does', async () => {
    show()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Review pause' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('No one can create a new Fundit until you unpause. Gifts and withdrawals keep working.')
    expect(within(dialog).getByRole('heading').textContent).toContain('on Arc Testnet')
  })

  it('featured signs straight after the simulation', async () => {
    vi.mocked(fetchSnapshot).mockResolvedValue([{ address: FUNDIT_A, isTest: false }] as never)
    show()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: /0x5555/ }))
    await user.click(screen.getByRole('button', { name: 'Review featured change' }))
    expect(await screen.findByText('Confirmed')).toBeTruthy()
    expect(wagmi.simulateContract.mock.calls[0]![1]).toMatchObject({ functionName: 'setFeatured', args: [FUNDIT_A] })
    expect(wagmi.writeContract).toHaveBeenCalledTimes(1)
  })

  it('the featured picker starts on the current featured Fundit', async () => {
    vi.mocked(fetchSnapshot).mockResolvedValue([{ address: FUNDIT_A, isTest: false }, { address: FUNDIT_B, isTest: false }] as never)
    state.read.mockResolvedValue({ ...factoryState, featured: FUNDIT_A })
    show()
    const picker = within(await screen.findByRole('group', { name: 'Pick the Fundit to feature' }))
    await waitFor(() => expect(picker.getAllByRole('radio')).toHaveLength(3))
    const [none, first, second] = picker.getAllByRole('radio') as HTMLInputElement[]
    expect([none!.checked, first!.checked, second!.checked]).toEqual([false, true, false])
    // A choice the owner makes is kept.
    await userEvent.setup().click(second!)
    expect(second!.checked).toBe(true)
  })

  it('has no control for renounceOwnership or transferOwnership', async () => {
    show()
    await screen.findByRole('button', { name: 'Review fee change' })
    expect(document.body.textContent ?? '').not.toMatch(/renounce|transfer ownership|transferOwnership/i)
    expect(screen.queryByRole('button', { name: /owner/i })).toBeNull()
  })
})

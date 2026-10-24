import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { type Address, decodeFunctionData, type Hex, UserRejectedRequestError } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { erc20Abi } from '../abi/erc20'
import { ARC_CHAIN_ID, TOKENS } from '../config'
import { balancesKey } from '../lib/deposit'
import { formatAmount } from '../lib/format'
import { AddMoneyPanel } from './AddMoneyPanel'

const ACCOUNT = '0x00000000000000000000000000000000000000cc' as Address
const EXTERNAL = '0x1111111111111111111111111111111111111111' as Address
const HASH = `0x${'1'.repeat(64)}` as Hex

const flags = vi.hoisted(() => ({ crosschain: false, reown: 'test-project' }))
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  get CROSSCHAIN_ENABLED() {
    return flags.crosschain
  },
  get REOWN_PROJECT_ID() {
    return flags.reown
  },
}))

const state = vi.hoisted(() => ({ kind: 'passkey' as 'passkey' | 'email' | 'wallet', external: null as Address | null, balances: new Map<string, { usdc: bigint; eurc: bigint }>() }))
const passkeySend = vi.hoisted(() => vi.fn())
vi.mock('../lib/passkey', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/passkey')>()),
  usePasskeySession: () => ({ address: '0x00000000000000000000000000000000000000cc', credentialId: 'cred-1' }),
  storedPasskeySender: () => ({ kind: 'passkey', address: '0x00000000000000000000000000000000000000cc', send: passkeySend }),
}))
vi.mock('../lib/account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/account')>()),
  useAccount: () => ({ kind: state.kind, address: ACCOUNT }),
}))
const fetchAccountBalances = vi.hoisted(() =>
  vi.fn(async (_client: unknown, who: Address) => state.balances.get(who.toLowerCase()) ?? { usdc: 0n, eurc: 0n }),
)
vi.mock('../lib/deposit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/deposit')>()),
  fetchAccountBalances,
}))

const core = vi.hoisted(() => ({ reconnect: vi.fn(async () => []), getAccount: vi.fn(), getChainId: vi.fn(), switchChain: vi.fn(), sendTransaction: vi.fn() }))
vi.mock('@wagmi/core', () => core)
const arc = vi.hoisted(() => ({ estimateGas: vi.fn(), waitForTransactionReceipt: vi.fn(), getTransaction: vi.fn(), call: vi.fn() }))
vi.mock('../lib/clients', () => ({ arcClient: arc }))
const disconnect = vi.hoisted(() => vi.fn())
// The Fundit account is signed in. state.external is a regular wallet connected here to add money from.
vi.mock('wagmi', () => ({
  WagmiContext: { Provider: ({ children }: { children: ReactNode }) => children },
  useConfig: () => ({}),
  useConnection: () =>
    state.external
      ? { isConnected: true, address: state.external, connector: { name: 'MetaMask', getProvider: async () => ({}) } }
      : { isConnected: false },
  useDisconnect: () => ({ mutate: disconnect }),
}))
// The real setup creates the wagmi config. The wallet tabs only need it, and the wagmi mocks above ignore it.
vi.mock('../wagmi', () => ({ wagmiConfig: {} }))
// The wallet list itself talks to wagmi. Here only whether Connect a wallet opens it matters.
vi.mock('./ConnectWallet', () => ({ ConnectWallet: () => <p>Wallet list</p> }))
// Bridge Kit itself is covered in lib/bridge.test.ts. Here only the panel's busy state matters.
const bridgeKit = vi.hoisted(() => ({ donateCrossChain: vi.fn(), estimateCrossChain: vi.fn() }))
vi.mock('../lib/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/bridge')>()),
  donateCrossChain: (...a: unknown[]) => bridgeKit.donateCrossChain(...a),
  estimateCrossChain: (...a: unknown[]) => bridgeKit.estimateCrossChain(...a),
}))

beforeEach(() => {
  core.getAccount.mockImplementation(() => ({ address: state.external }))
  core.getChainId.mockReturnValue(ARC_CHAIN_ID)
  core.sendTransaction.mockResolvedValue(HASH)
  arc.estimateGas.mockResolvedValue(50_000n)
  arc.waitForTransactionReceipt.mockResolvedValue({ transactionHash: HASH, status: 'success', blockNumber: 1n, logs: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
  flags.crosschain = false
  flags.reown = 'test-project'
  state.external = null
  state.kind = 'passkey'
  state.balances.clear()
})

// My page shows the account balance from this same query, so it stands in for the dashboard's balance card.
function Balance() {
  const q = useQuery({ queryKey: balancesKey(ACCOUNT), queryFn: () => fetchAccountBalances({}, ACCOUNT) })
  return <p>{q.data ? `${formatAmount(q.data.usdc, 'USDC')} and ${formatAmount(q.data.eurc, 'EURC')}` : 'Loading...'}</p>
}

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Balance />
        <AddMoneyPanel account={ACCOUNT} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// The wallet tabs load on first open, so this waits until the tab has its content.
async function openTab(name: 'From a wallet' | 'From another chain') {
  const user = userEvent.setup()
  await user.click(screen.getByRole('tab', { name }))
  const panel = screen.getByRole('tabpanel', { name })
  await waitFor(() => expect(panel.textContent).not.toContain('Loading...'), { timeout: 5000 })
  return user
}

const openWalletTab = () => openTab('From a wallet')

async function fillDeposit(amount: string) {
  const user = await openWalletTab()
  await screen.findByText(/^Your wallet holds 10\.00 USDC on Arc\./)
  await user.type(screen.getByLabelText('Amount'), amount)
  await user.click(screen.getByRole('button', { name: 'Add to my Fundit account' }))
}

describe('AddMoneyPanel', () => {
  // The ways to add money are tabs. Another chain is offered only when the bridge is switched on.
  it('offers Your address and From a wallet as tabs, starting on Your address', () => {
    renderPage()
    expect(screen.getByRole('tablist', { name: 'Ways to add money' })).toBeTruthy()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Your address', 'From a wallet'])
    expect(screen.getByRole('tab', { name: 'Your address' }).getAttribute('aria-selected')).toBe('true')
  })

  it('shows the account address, a QR code and a working copy button', async () => {
    // userEvent.setup() puts in its own clipboard, so the spy goes in after it.
    const user = userEvent.setup()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPage()
    expect(screen.getByRole('tabpanel', { name: 'Your address' })).toBeTruthy()
    expect(screen.getByText(ACCOUNT)).toBeTruthy()
    expect(screen.getByText('Send USDC or EURC on Arc to this address from any wallet or exchange.')).toBeTruthy()
    expect(await screen.findByRole('img', { name: 'QR code of your Fundit account address' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Copy address' }))
    expect(writeText).toHaveBeenCalledWith(ACCOUNT)
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
    expect(screen.getByText('Card and bank coming soon.')).toBeTruthy()
  })

  it('From a wallet uses ConnectWallet, not AppKit', async () => {
    renderPage()
    const user = await openWalletTab()
    await user.click(screen.getByRole('button', { name: 'Connect a wallet' }))
    expect(screen.getByText('Wallet list')).toBeTruthy()
  })

  // The person must see which wallet pays, and be able to drop it to use another one.
  it('shows the connected wallet and a Disconnect button that disconnects it', async () => {
    state.external = EXTERNAL
    state.balances.set(EXTERNAL.toLowerCase(), { usdc: 10_000000n, eurc: 0n })
    renderPage()
    const user = await openWalletTab()
    const panel = screen.getByRole('tabpanel', { name: 'From a wallet' })
    expect(panel.textContent).toContain('Connected: MetaMask')
    expect(panel.textContent).toContain('0x1111...1111')
    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(core.sendTransaction).not.toHaveBeenCalled()
  })

  // Disconnecting mid-send would cut the wallet out of a transfer it is signing.
  it('disables Disconnect while a deposit is in flight', async () => {
    state.external = EXTERNAL
    state.balances.set(EXTERNAL.toLowerCase(), { usdc: 10_000000n, eurc: 0n })
    core.sendTransaction.mockReturnValue(new Promise(() => {}))
    renderPage()
    await fillDeposit('5')
    await waitFor(() => expect(core.sendTransaction).toHaveBeenCalledTimes(1))
    const button = screen.getByRole('button', { name: 'Disconnect' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    await userEvent.setup().click(button)
    expect(disconnect).not.toHaveBeenCalled()
  })

  // The wallet tab and the bridge tab share one wallet connection, so a bridge being signed also locks Disconnect.
  it('disables Disconnect while a transfer from another chain is being sent', async () => {
    flags.crosschain = true
    state.external = EXTERNAL
    state.balances.set(EXTERNAL.toLowerCase(), { usdc: 10_000000n, eurc: 0n })
    bridgeKit.estimateCrossChain.mockResolvedValue(10_000n)
    bridgeKit.donateCrossChain.mockReturnValue(new Promise(() => {}))
    renderPage()
    const user = await openTab('From another chain')
    await user.type(screen.getByLabelText('Amount'), '5')
    await screen.findByText(/^At least /)
    await user.click(screen.getByRole('button', { name: 'Bridge USDC' }))
    await waitFor(() => expect(bridgeKit.donateCrossChain).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('tab', { name: 'From a wallet' }))
    expect((screen.getByRole('button', { name: 'Disconnect' }) as HTMLButtonElement).disabled).toBe(true)
  })

  // Without a Reown project id Add money offers no wallet. The person gets a plain sentence, never a raw error.
  it('says connecting a wallet is not available when the Reown project id is missing', async () => {
    flags.reown = ''
    renderPage()
    await openWalletTab()
    expect(screen.getByText('Connecting a wallet is not available on this site right now.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Connect a wallet' })).toBeNull()
  })

  // The signed-in wallet is the account, so there is nothing to connect or send from.
  it('a wallet account sees no From a wallet tab', () => {
    state.kind = 'wallet'
    renderPage()
    expect(screen.queryByRole('tab', { name: 'From a wallet' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Your address' })).toBeTruthy()
  })

  // Review focus 4: a deposit must never go out on another chain.
  describe('switches to Arc before sending', () => {
    it('switches from Base to Arc first, then sends on Arc', async () => {
      state.external = EXTERNAL
      state.balances.set(EXTERNAL.toLowerCase(), { usdc: 10_000000n, eurc: 0n })
      core.getChainId.mockReturnValue(8453)
      core.switchChain.mockResolvedValue({ id: ARC_CHAIN_ID })
      renderPage()
      await fillDeposit('5')
      await waitFor(() => expect(core.sendTransaction).toHaveBeenCalledTimes(1))
      expect(core.switchChain).toHaveBeenCalledWith(expect.anything(), { chainId: ARC_CHAIN_ID })
      expect(core.switchChain.mock.invocationCallOrder[0]!).toBeLessThan(core.sendTransaction.mock.invocationCallOrder[0]!)
      expect(core.sendTransaction.mock.calls[0]![1].chainId).toBe(ARC_CHAIN_ID)
    })

    it('sends nothing when the switch is refused', async () => {
      state.external = EXTERNAL
      state.balances.set(EXTERNAL.toLowerCase(), { usdc: 10_000000n, eurc: 0n })
      core.getChainId.mockReturnValue(8453)
      core.switchChain.mockRejectedValue(new UserRejectedRequestError(new Error('User rejected')))
      renderPage()
      await fillDeposit('5')
      expect(await screen.findByText("You cancelled the request. Try again when you're ready.")).toBeTruthy()
      expect(core.sendTransaction).not.toHaveBeenCalled()
      expect(passkeySend).not.toHaveBeenCalled()
    })
  })

  // The money comes out of the regular wallet. The passkey account is where it goes, so it must not pay.
  it('sends with the connected wallet, never the passkey, even when the passkey is active', async () => {
    state.external = EXTERNAL
    state.balances.set(EXTERNAL.toLowerCase(), { usdc: 10_000000n, eurc: 0n })
    renderPage()
    await fillDeposit('5')
    await waitFor(() => expect(core.sendTransaction).toHaveBeenCalledTimes(1))
    const sent = core.sendTransaction.mock.calls[0]![1]
    expect(sent.account).toBe(EXTERNAL)
    expect(sent.to).toBe(TOKENS.USDC.address)
    const decoded = decodeFunctionData({ abi: erc20Abi, data: sent.data })
    expect(decoded.args).toEqual([ACCOUNT, 5_000000n])
    expect(passkeySend).not.toHaveBeenCalled()
  })

  it('refuses an amount above the wallet balance on Arc', async () => {
    state.external = EXTERNAL
    state.balances.set(EXTERNAL.toLowerCase(), { usdc: 10_000000n, eurc: 0n })
    renderPage()
    await fillDeposit('11')
    expect(screen.getByText('That is more than this wallet holds on Arc.')).toBeTruthy()
    expect(core.sendTransaction).not.toHaveBeenCalled()
  })

  // Success is shown only after the receipt, and the account balance shown then is the new one.
  it('refreshes balances after a successful deposit', async () => {
    state.external = EXTERNAL
    state.balances.set(EXTERNAL.toLowerCase(), { usdc: 10_000000n, eurc: 0n })
    renderPage()
    expect(await screen.findByText('0.00 USDC and 0.00 EURC')).toBeTruthy()
    arc.waitForTransactionReceipt.mockImplementation(async () => {
      state.balances.set(ACCOUNT.toLowerCase(), { usdc: 5_000000n, eurc: 0n })
      return { transactionHash: HASH, status: 'success', blockNumber: 1n, logs: [] }
    })
    await fillDeposit('5')
    expect(await screen.findByText('Money added to your Fundit account.')).toBeTruthy()
    expect(await screen.findByText('5.00 USDC and 0.00 EURC')).toBeTruthy()
  })

  it('leaves out From another chain when cross-chain is off', () => {
    renderPage()
    expect(screen.queryByRole('tab', { name: 'From another chain' })).toBeNull()
  })

  it('offers From another chain when cross-chain is on', () => {
    flags.crosschain = true
    renderPage()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Your address', 'From a wallet', 'From another chain'])
  })

  // A second bridge while the first is still on its way could send the money twice, so the form waits.
  it('blocks a new transfer from another chain while one to the account is on its way', async () => {
    flags.crosschain = true
    localStorage.setItem(
      'fundit.pendingBridges',
      JSON.stringify([{ kind: 'submitted', id: 's-1', campaign: ACCOUNT, srcDomain: 6, amount: '25', createdAt: Date.now() }]),
    )
    renderPage()
    await openTab('From another chain')
    expect(
      screen.getByText(
        'A transfer to your Fundit account is still on its way. Wait for it to arrive before you send another. Follow it in the Account tab.',
      ),
    ).toBeTruthy()
    // The row itself shows only in the Account tab on My page.
    expect(screen.queryByText(/25 USDC from Base: Submitted/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Bridge USDC' })).toBeNull()
  })

  // Arc gas is paid in USDC from the same wallet, so sending every last USDC would fail at the fee.
  it('keeps a gas reserve in the wallet for a USDC deposit', async () => {
    state.external = EXTERNAL
    state.balances.set(EXTERNAL.toLowerCase(), { usdc: 10_000000n, eurc: 0n })
    renderPage()
    await fillDeposit('9.96')
    expect(screen.getByText('Leave at least 0.05 USDC in this wallet for the network fee.')).toBeTruthy()
    expect(core.sendTransaction).not.toHaveBeenCalled()
  })

  it('allows a USDC deposit that leaves the gas reserve', async () => {
    state.external = EXTERNAL
    state.balances.set(EXTERNAL.toLowerCase(), { usdc: 10_000000n, eurc: 0n })
    renderPage()
    await fillDeposit('9.95')
    await waitFor(() => expect(core.sendTransaction).toHaveBeenCalledTimes(1))
  })
})

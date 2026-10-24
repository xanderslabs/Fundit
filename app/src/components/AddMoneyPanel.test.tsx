import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { Address } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddMoneyPanel } from './AddMoneyPanel'

const ACCOUNT = '0x00000000000000000000000000000000000000cc' as Address
const EXTERNAL = '0x1111111111111111111111111111111111111111' as Address

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

const state = vi.hoisted(() => ({ external: null as Address | null }))
vi.mock('wagmi', () => ({
  WagmiContext: { Provider: ({ children }: { children: React.ReactNode }) => children },
  useConnection: () =>
    state.external
      ? { isConnected: true, address: state.external, connector: { name: 'MetaMask', getProvider: async () => ({}) } }
      : { isConnected: false },
}))
// The real setup creates the wagmi config. The bridge tab only needs it, and the wagmi mock above ignores it.
vi.mock('../wagmi', () => ({ wagmiConfig: {} }))
// The wallet list itself talks to wagmi. Here only whether the connect button opens it matters.
vi.mock('./ConnectWallet', () => ({ ConnectWallet: () => <p>Wallet list</p> }))
// Bridge Kit itself is covered in lib/bridge.test.ts.
const bridgeKit = vi.hoisted(() => ({ donateCrossChain: vi.fn(), estimateCrossChain: vi.fn() }))
vi.mock('../lib/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/bridge')>()),
  donateCrossChain: (...a: unknown[]) => bridgeKit.donateCrossChain(...a),
  estimateCrossChain: (...a: unknown[]) => bridgeKit.estimateCrossChain(...a),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
  flags.crosschain = false
  flags.reown = 'test-project'
  state.external = null
})

function renderPanel() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AddMoneyPanel account={ACCOUNT} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// The bridge tab loads on first open, so this waits until the tab has its content.
async function openChainTab() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('tab', { name: 'From another chain' }))
  const panel = screen.getByRole('tabpanel', { name: 'From another chain' })
  await waitFor(() => expect(panel.textContent).not.toContain('Loading...'), { timeout: 5000 })
  return user
}

describe('AddMoneyPanel', () => {
  // Connecting a wallet to add money was dropped: the only way in is to send to the address.
  it('shows Your address with no From a wallet tab and no tab strip when cross-chain is off', () => {
    renderPanel()
    expect(screen.queryByRole('tab', { name: 'From a wallet' })).toBeNull()
    expect(screen.queryAllByRole('tab')).toEqual([])
    expect(screen.getByText(ACCOUNT)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /connect/i })).toBeNull()
  })

  it('shows the account address, a QR code and a working copy button', async () => {
    // userEvent.setup() puts in its own clipboard, so the spy goes in after it.
    const user = userEvent.setup()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPanel()
    expect(screen.getByText('Send USDC or EURC on Arc to this address from any wallet or exchange.')).toBeTruthy()
    expect(await screen.findByRole('img', { name: 'QR code of your Fundit account address' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Copy address' }))
    expect(writeText).toHaveBeenCalledWith(ACCOUNT)
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
    expect(screen.getByText('Card and bank coming soon.')).toBeTruthy()
  })

  it('offers Your address and From another chain as tabs when cross-chain is on, starting on Your address', () => {
    flags.crosschain = true
    renderPanel()
    expect(screen.getByRole('tablist', { name: 'Ways to add money' })).toBeTruthy()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Your address', 'From another chain'])
    expect(screen.getByRole('tab', { name: 'Your address' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByRole('tab', { name: 'From a wallet' })).toBeNull()
  })

  it('the bridge tab opens the wallet list from its connect button', async () => {
    flags.crosschain = true
    renderPanel()
    const user = await openChainTab()
    await user.click(screen.getByRole('button', { name: 'Connect the wallet that holds the USDC' }))
    expect(screen.getByText('Wallet list')).toBeTruthy()
  })

  // Without a Reown project id the bridge offers no wallet. The person gets a plain sentence, never a raw error.
  it('the bridge tab says connecting a wallet is not available when the Reown project id is missing', async () => {
    flags.crosschain = true
    flags.reown = ''
    renderPanel()
    await openChainTab()
    expect(screen.getByText('Connecting a wallet is not available on this site right now.')).toBeTruthy()
  })

  it('sends a transfer from another chain with the connected wallet', async () => {
    flags.crosschain = true
    state.external = EXTERNAL
    bridgeKit.estimateCrossChain.mockResolvedValue(10_000n)
    bridgeKit.donateCrossChain.mockReturnValue(new Promise(() => {}))
    renderPanel()
    const user = await openChainTab()
    await user.type(screen.getByLabelText('Amount'), '5')
    await screen.findByText(/^At least /)
    await user.click(screen.getByRole('button', { name: 'Bridge USDC' }))
    await waitFor(() => expect(bridgeKit.donateCrossChain).toHaveBeenCalledTimes(1))
    expect(bridgeKit.donateCrossChain.mock.calls[0]![0]).toMatchObject({ campaign: ACCOUNT, account: EXTERNAL })
  })

  // A second bridge while the first is still on its way could send the money twice, so the form waits.
  it('blocks a new transfer from another chain while one to the account is on its way', async () => {
    flags.crosschain = true
    localStorage.setItem(
      'fundit.pendingBridges',
      JSON.stringify([{ kind: 'submitted', id: 's-1', campaign: ACCOUNT, srcDomain: 6, amount: '25', createdAt: Date.now() }]),
    )
    renderPanel()
    await openChainTab()
    expect(
      screen.getByText(
        'A transfer to your Fundit account is still on its way. Wait for it to arrive before you send another. Follow it in the Account tab.',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Bridge USDC' })).toBeNull()
  })
})

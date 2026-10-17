import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { getAddress, type Hex } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOKENS, type TokenSymbol } from '../config'
import type { CampaignView } from '../lib/campaigns'
import { CrossChainDonate, PendingBridgeTracker } from './CrossChainDonate'
import { DonatePanel } from './DonatePanel'

const CAMPAIGN = getAddress('0x00000000000000000000000000000000000000a1')
const BURN = `0x${'cd'.repeat(32)}` as Hex
const KEY = 'fundit.pendingBridges'

type Conn = { isConnected: boolean; address?: string; connector?: { getProvider: () => Promise<unknown> } }
const conn: { current: Conn } = { current: { isConnected: false } }
vi.mock('wagmi', () => ({ useConnection: () => conn.current }))
const estimate = vi.hoisted(() => ({
  fn: (async () => 0n) as (p: { amount: string }) => Promise<bigint>,
  calls: [] as string[],
  accounts: [] as (string | undefined)[],
  donations: 0,
}))
vi.mock('../lib/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/bridge')>()),
  estimateCrossChain: (p: { amount: string; account?: string }) => {
    estimate.calls.push(p.amount)
    estimate.accounts.push(p.account)
    return estimate.fn(p)
  },
  donateCrossChain: async () => {
    estimate.donations++
    return new Promise(() => {})
  },
}))
vi.mock('@reown/appkit/react', () => ({ useAppKit: () => ({ open: () => {} }) }))
vi.mock('../hooks/useSender', () => ({ useSender: () => null }))

function view(symbol: TokenSymbol): CampaignView {
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
      closed: false,
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

function wrap(node: ReactNode, client = new QueryClient()) {
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
  return client
}

const FEE_SAMPLE = [
  { finalityThreshold: 1000, minimumFee: 0.325, forwardFee: { low: 15000, med: 16217, high: 20000 } },
  { finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: 15000, med: 16217, high: 20000 } },
]

function stubFetch(handler: (url: string) => unknown) {
  const fn = vi.fn(async (url: string) => new Response(JSON.stringify(handler(url)), { status: 200 }))
  vi.stubGlobal('fetch', fn)
  return fn
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

function savePending(createdAt: number) {
  localStorage.setItem(KEY, JSON.stringify([{ kind: 'bridge', campaign: CAMPAIGN, burnTx: BURN, srcDomain: 6, amount: '25', createdAt }]))
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setVisibility('visible')
  conn.current = { isConnected: false }
  estimate.fn = async () => 0n
  estimate.calls.length = 0
  estimate.accounts.length = 0
  estimate.donations = 0
})

const connectWallet = () => {
  conn.current = { isConnected: true, address: '0x1111111111111111111111111111111111111111', connector: { getProvider: async () => ({}) } }
}

describe('CrossChainDonate', () => {
  // The wallet's provider can answer eth_accounts with a stale account. wagmi's address is the one the person sees.
  it('passes the connected address from wagmi to the bridge', async () => {
    stubFetch(() => FEE_SAMPLE)
    connectWallet()
    wrap(<CrossChainDonate view={view('USDC')} />)
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('From'), 'Base')
    await user.type(screen.getByLabelText('Amount'), '25')
    await waitFor(() => expect(estimate.accounts.length).toBeGreaterThan(0))
    expect(estimate.accounts.at(-1)).toBe('0x1111111111111111111111111111111111111111')
  })

  // CCTP has no Fast transfer from Polygon or Avalanche. Offering it would quote a fee and a time that are wrong.
  it('hides Fast for Polygon and shows it for Base', async () => {
    stubFetch(() => FEE_SAMPLE)
    wrap(<CrossChainDonate view={view('USDC')} />)
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('From'), 'Base')
    expect(screen.getByLabelText(/^Fast/)).toBeTruthy()
    await user.selectOptions(screen.getByLabelText('From'), 'Polygon')
    expect(screen.queryByLabelText(/^Fast/)).toBeNull()
    expect((screen.getByLabelText(/^Standard/) as HTMLInputElement).checked).toBe(true)
  })

  // Bridged money arrives as USDC. An EURC campaign would hold the wrong token.
  it('is not offered on an EURC campaign, which says why', () => {
    wrap(<DonatePanel view={view('EURC')} />)
    expect(screen.getByText('EURC campaigns accept donations on Arc only.')).toBeTruthy()
    expect(screen.queryByLabelText(/USDC on another chain/)).toBeNull()
  })

  it('is offered on a USDC campaign', async () => {
    stubFetch(() => FEE_SAMPLE)
    wrap(<DonatePanel view={view('USDC')} />)
    await userEvent.setup().click(screen.getByLabelText(/USDC on another chain/))
    expect(screen.getByLabelText('From')).toBeTruthy()
  })

  // Fees come out of the amount, so the donor must see what actually reaches the campaign.
  it('previews the fees and what reaches the campaign before a wallet is connected', async () => {
    stubFetch(() => FEE_SAMPLE)
    wrap(<CrossChainDonate view={view('USDC')} />)
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('From'), 'Base')
    await user.type(screen.getByLabelText('Amount'), '25')
    // 25 - (20000 + 825) units = 24.979175, shown to the unit so the donor sees the exact fee and floor.
    // The real fee can be lower than the quote, so the landed amount is a floor.
    expect(await screen.findByText('At least 24.979175 USDC')).toBeTruthy()
    expect(screen.getByText('0.020825 USDC')).toBeTruthy()
    expect(screen.getByText('Reaches the campaign')).toBeTruthy()
    expect(screen.getByText(/about a minute/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Connect wallet to donate' })).toBeTruthy()
  })
})

describe('CrossChainDonate fees with a wallet', () => {
  // One estimate per settled amount, not one SDK round trip per keystroke.
  it('estimates once for the settled amount', async () => {
    connectWallet()
    stubFetch(() => FEE_SAMPLE)
    estimate.fn = async () => 17042n
    wrap(<CrossChainDonate view={view('USDC')} />)
    await userEvent.setup().type(screen.getByLabelText('Amount'), '25')
    expect(await screen.findByText('At least 24.982958 USDC')).toBeTruthy()
    expect(estimate.calls).toEqual(['25'])
    expect(screen.getByText('Transfer fees')).toBeTruthy()
  })

  // A wallet RPC hiccup must not stop a donation when Circle's own quote is available.
  it("falls back to Circle's quote when the wallet estimate fails, and still allows Donate", async () => {
    connectWallet()
    stubFetch(() => FEE_SAMPLE)
    estimate.fn = async () => {
      throw new Error('rpc down')
    }
    wrap(<CrossChainDonate view={view('USDC')} />)
    await userEvent.setup().type(screen.getByLabelText('Amount'), '25')
    expect(await screen.findByText("Estimated fee (could not reach your wallet's network)")).toBeTruthy()
    expect(screen.getByText('At least 24.979175 USDC')).toBeTruthy()
    await waitFor(() => expect((screen.getByRole('button', { name: 'Donate' }) as HTMLButtonElement).disabled).toBe(false))
  })

  // Another tab may have started a donation to this campaign after this form loaded, without this tab hearing
  // of it. The store is read again at submit, and nothing is sent while that donation is unconfirmed.
  it('re-reads the pending store at submit and sends nothing while another donation is unconfirmed', async () => {
    connectWallet()
    stubFetch(() => FEE_SAMPLE)
    wrap(<CrossChainDonate view={view('USDC')} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Amount'), '25')
    await waitFor(() => expect((screen.getByRole('button', { name: 'Donate' }) as HTMLButtonElement).disabled).toBe(false))
    localStorage.setItem(KEY, JSON.stringify([{ kind: 'unified', campaign: CAMPAIGN, amount: '5', createdAt: Date.now() }]))
    await user.click(screen.getByRole('button', { name: 'Donate' }))
    expect(await screen.findByText(/Another donation to this campaign is not confirmed yet/)).toBeTruthy()
    expect(estimate.donations).toBe(0)
  })

  // Nothing is being sent while quoting, so the error must not talk about sending.
  it('says plainly when no quote is available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    wrap(<CrossChainDonate view={view('USDC')} />)
    await userEvent.setup().type(screen.getByLabelText('Amount'), '25')
    const msg = await screen.findByText(/Could not get a fee quote/, {}, { timeout: 3000 })
    expect(msg.textContent).not.toMatch(/Nothing was sent/)
  })
})

describe('PendingBridgeTracker', () => {
  // Saved when the wallet sent, before any hash: the donor still learns something is in flight after a reload.
  it('shows a submitted transfer that has no hash yet, without polling', async () => {
    localStorage.setItem(KEY, JSON.stringify([{ kind: 'submitted', id: 'a', campaign: CAMPAIGN, srcDomain: 6, amount: '25', createdAt: Date.now() }]))
    const fetchFn = stubFetch(() => ({ messages: [] }))
    wrap(<PendingBridgeTracker campaign={CAMPAIGN} />)
    expect(await screen.findByText(/Submitted, waiting for confirmation/)).toBeTruthy()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  // The mint happens even if the tab closed. After a reload the donor still sees it, and the total refreshes.
  it('picks up a saved transfer after reload and refreshes the campaign once minted', async () => {
    savePending(Date.now())
    const fetchFn = stubFetch(() => ({ messages: [{ status: 'complete', forwardTxHash: `0x${'ef'.repeat(32)}` }] }))
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    wrap(<PendingBridgeTracker campaign={CAMPAIGN} />, client)
    expect(await screen.findByText(/reached the campaign/)).toBeTruthy()
    expect(fetchFn.mock.calls[0]![0]).toContain(`/v2/messages/6?transactionHash=${BURN}`)
    const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey))
    expect(keys).toContain(JSON.stringify(['campaign', CAMPAIGN.toLowerCase()]))
  })

  it('shows nothing for transfers to another campaign', () => {
    savePending(Date.now())
    stubFetch(() => ({ messages: [] }))
    wrap(<PendingBridgeTracker campaign={getAddress('0x00000000000000000000000000000000000000b2')} />)
    expect(screen.queryByText(/on its way/)).toBeNull()
  })

  // Polling a hidden tab wastes the donor's battery and Circle's rate limit.
  it('polls only while the tab is visible', async () => {
    savePending(Date.now())
    setVisibility('hidden')
    const fetchFn = stubFetch(() => ({ messages: [] }))
    wrap(<PendingBridgeTracker campaign={CAMPAIGN} />)
    expect(await screen.findByText(/on its way/)).toBeTruthy()
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchFn).not.toHaveBeenCalled()
    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1))
  })

  // After 2 hours something is wrong. One last look at Iris, then stop and send the donor to the explorer.
  it('asks Iris once more after 2 hours, then stops and links the burn on the source-chain explorer', async () => {
    savePending(Date.now() - 2 * 60 * 60 * 1000 - 1)
    const fetchFn = stubFetch(() => ({ messages: [] }))
    wrap(<PendingBridgeTracker campaign={CAMPAIGN} />)
    const link = await screen.findByRole('link', { name: /Check the explorer/ })
    expect(link.getAttribute('href')).toBe(`https://basescan.org/tx/${BURN}`)
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  // A transfer that arrived while the tab was closed must not show as overdue, nor keep blocking donations.
  it('marks an overdue transfer minted when the last Iris check finds the mint', async () => {
    savePending(Date.now() - 2 * 60 * 60 * 1000 - 1)
    stubFetch(() => ({ messages: [{ status: 'complete', forwardTxHash: `0x${'ef'.repeat(32)}` }] }))
    wrap(<PendingBridgeTracker campaign={CAMPAIGN} />)
    expect(await screen.findByText(/reached the campaign/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Check the explorer/ })).toBeNull()
    expect(JSON.parse(localStorage.getItem(KEY)!)[0]).toMatchObject({ burnTx: BURN, minted: true })
  })

  // Another tab saved a transfer. The browser tells this tab through a storage event.
  it('shows a transfer another tab saved, on the storage event', async () => {
    stubFetch(() => ({ messages: [] }))
    wrap(<PendingBridgeTracker campaign={CAMPAIGN} />)
    expect(screen.queryByText(/on its way/)).toBeNull()
    savePending(Date.now())
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    expect(await screen.findByText(/on its way/)).toBeTruthy()
  })
})

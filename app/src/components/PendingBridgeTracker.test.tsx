import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { getAddress, type Hex } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXPLORER_URL } from '../config'
import { PendingBridgeTracker } from './PendingBridgeTracker'

const CAMPAIGN = getAddress('0x00000000000000000000000000000000000000a1')
const BURN = `0x${'cd'.repeat(32)}` as Hex
const KEY = 'fundit.pendingBridges'

function wrap(node: ReactNode, client = new QueryClient()) {
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
  return client
}

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
    expect(await screen.findByText(/reached the Fundit/)).toBeTruthy()
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

  // Money that left from the person's own wallet on another chain: only that wallet's history shows what happened.
  it('sends an overdue outside-wallet transfer to the wallet activity on its chain', () => {
    localStorage.setItem(KEY, JSON.stringify([{ kind: 'submitted', id: 'a', campaign: CAMPAIGN, srcDomain: 6, amount: '25', createdAt: Date.now() - 2 * 60 * 60 * 1000 - 1 }]))
    stubFetch(() => ({ messages: [] }))
    wrap(<PendingBridgeTracker campaign={CAMPAIGN} />)
    expect(screen.getByText(/Check your wallet's activity on Base/)).toBeTruthy()
    expect(screen.queryByText(/Fundit account's activity/)).toBeNull()
  })

  // Money that left from the Fundit account on Arc: the person has no other wallet to check, so point to the
  // account's own page on the Arc explorer.
  it('sends an overdue transfer from Arc to the Fundit account on the Arc explorer', async () => {
    const ACCOUNT = getAddress('0x00000000000000000000000000000000000000c3')
    localStorage.setItem(
      KEY,
      JSON.stringify([{ kind: 'payout', campaign: CAMPAIGN, burnTx: BURN, srcDomain: 26, destDomain: 6, amount: '25', createdAt: Date.now() - 2 * 60 * 60 * 1000 - 1 }]),
    )
    stubFetch(() => ({ messages: [] }))
    wrap(<PendingBridgeTracker campaign={CAMPAIGN} account={ACCOUNT} kind="payout" />)
    expect(await screen.findByText('25 USDC to Base has not been confirmed yet.')).toBeTruthy()
    const link = screen.getByRole('link', { name: "See your Fundit account's activity on the Arc explorer." })
    expect(link.getAttribute('href')).toBe(`${EXPLORER_URL}/address/${ACCOUNT}`)
    expect(screen.queryByText(/your wallet's activity/)).toBeNull()
  })

  // Send money out saves the account itself as the entry's address, so no separate account is needed.
  it('links the entry address when no account is given', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([{ kind: 'payout', campaign: CAMPAIGN, burnTx: BURN, srcDomain: 26, destDomain: 6, amount: '25', createdAt: Date.now() - 2 * 60 * 60 * 1000 - 1 }]),
    )
    stubFetch(() => ({ messages: [] }))
    wrap(<PendingBridgeTracker campaign={CAMPAIGN} kind="payout" />)
    const link = await screen.findByRole('link', { name: /Fundit account's activity/ })
    expect(link.getAttribute('href')).toBe(`${EXPLORER_URL}/address/${CAMPAIGN}`)
  })

  // A transfer that arrived while the tab was closed must not show as overdue, nor keep blocking donations.
  it('marks an overdue transfer minted when the last Iris check finds the mint', async () => {
    savePending(Date.now() - 2 * 60 * 60 * 1000 - 1)
    stubFetch(() => ({ messages: [{ status: 'complete', forwardTxHash: `0x${'ef'.repeat(32)}` }] }))
    wrap(<PendingBridgeTracker campaign={CAMPAIGN} />)
    expect(await screen.findByText(/reached the Fundit/)).toBeTruthy()
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

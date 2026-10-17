import type { Hex } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchForwardFee, fetchTransferStatus } from './iris'

const BURN = `0x${'cd'.repeat(32)}` as Hex

// Shape of GET /v2/burn/USDC/fees/{src}/{dst}?forward=true: one tier per finality threshold.
// minimumFee is in basis points; forwardFee is in USDC base units (6 decimals).
const FEE_SAMPLE = [
  { finalityThreshold: 1000, minimumFee: 0.325, forwardFee: { low: 15000, med: 16217, high: 20000 } },
  { finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: 15000, med: 16217, high: 20000 } },
]

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchForwardFee', () => {
  // The donor sees this before paying, so it must match what Circle will take from the amount.
  it('adds the bps protocol fee to the high forwarding fee for a fast transfer', async () => {
    const fetchFn = mockFetch(200, FEE_SAMPLE)
    const fee = await fetchForwardFee(6, 26, 25_000000n, true)
    expect(fetchFn.mock.calls[0]![0]).toBe('https://iris-api.circle.com/v2/burn/USDC/fees/6/26?forward=true')
    expect(fee.forwardFee).toBe(20000n)
    // 0.325 bps rounds to 33 hundredths of a bp.
    expect(fee.protocolFee).toBe((25_000000n * 33n) / 1_000_000n)
    expect(fee.maxFee).toBe(20000n + (25_000000n * 33n) / 1_000_000n)
  })

  // A fee cap one unit short of what Circle charges makes the burn fail or the transfer fall back to slow.
  it('rounds the protocol fee up, so maxFee is never one unit short', async () => {
    mockFetch(200, FEE_SAMPLE)
    // 25.000001 USDC at 33 hundredths of a bp is 825.000033 units: Circle needs 826, not 825.
    const fee = await fetchForwardFee(6, 26, 25_000001n, true)
    expect(fee.protocolFee).toBe(826n)
    expect(fee.maxFee).toBe(20000n + 826n)
  })

  it('uses the standard tier (threshold 2000) when not fast', async () => {
    mockFetch(200, FEE_SAMPLE)
    const fee = await fetchForwardFee(0, 26, 25_000000n, false)
    expect(fee.protocolFee).toBe(0n)
    expect(fee.maxFee).toBe(20000n)
  })

  it('throws when Iris does not answer, so the UI never shows a made-up fee', async () => {
    mockFetch(500, {})
    await expect(fetchForwardFee(6, 26, 25_000000n, true)).rejects.toThrow()
  })
})

describe('fetchTransferStatus', () => {
  it('is minted once the forwarder has a mint transaction on Arc', async () => {
    const fetchFn = mockFetch(200, { messages: [{ status: 'complete', forwardState: 'CONFIRMED', forwardTxHash: `0x${'ef'.repeat(32)}` }] })
    expect(await fetchTransferStatus(6, BURN)).toBe('minted')
    expect(fetchFn.mock.calls[0]![0]).toBe(`https://iris-api.circle.com/v2/messages/6?transactionHash=${BURN}`)
  })

  it('is attested when the message is complete but not yet minted', async () => {
    mockFetch(200, { messages: [{ status: 'complete', forwardState: 'PENDING' }] })
    expect(await fetchTransferStatus(6, BURN)).toBe('attested')
  })

  it('is pending while Iris has no message for the burn yet', async () => {
    mockFetch(200, { messages: [] })
    expect(await fetchTransferStatus(6, BURN)).toBe('pending')
    mockFetch(404, { error: 'Message not found' })
    expect(await fetchTransferStatus(6, BURN)).toBe('pending')
  })

  // An outage is not news about the transfer. It must not read as failed or done.
  it('is unknown on HTTP 500 or a network error', async () => {
    mockFetch(500, {})
    expect(await fetchTransferStatus(6, BURN)).toBe('unknown')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    expect(await fetchTransferStatus(6, BURN)).toBe('unknown')
  })
})

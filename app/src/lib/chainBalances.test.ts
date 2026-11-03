import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { type BalanceSource, type ChainState, readWithTimeout, summarize } from './chainBalances'

const ACCOUNT = '0x2B35EA205659e5aAb183Af1C711564FCD86DC71f' as Address

const source = (key: BalanceSource['key'], read: BalanceSource['read'] = async () => 0n): BalanceSource => ({ key, label: key, read })
const SOURCES = [source('Arc'), source('Ethereum'), source('Base')]
const ok = (amount: bigint): ChainState => ({ status: 'ok', amount })
const FAILED: ChainState = { status: 'failed' }

describe('summarize', () => {
  it('adds up every network when all of them answer', () => {
    const r = summarize(SOURCES, [ok(5_000_000n), ok(1_500_000n), ok(250_000n)])
    expect(r.total).toBe(6_750_000n)
    expect([r.answered, r.failed, r.pending]).toEqual([3, 0, 0])
    expect(r.rows).toEqual([
      { key: 'Arc', label: 'Arc', status: 'ok', amount: 5_000_000n },
      { key: 'Ethereum', label: 'Ethereum', status: 'ok', amount: 1_500_000n },
      { key: 'Base', label: 'Base', status: 'ok', amount: 250_000n },
    ])
  })

  // A rate-limited RPC must not read as an empty balance: the person would think their money is gone.
  it('marks a failed network as failed, with no amount, and keeps the others', () => {
    const r = summarize(SOURCES, [ok(5_000_000n), FAILED, ok(250_000n)])
    const eth = r.rows.find((x) => x.key === 'Ethereum')!
    expect(eth.status).toBe('failed')
    expect('amount' in eth).toBe(false)
    expect(r.rows.filter((x) => x.status === 'ok').map((x) => x.key)).toEqual(['Arc', 'Base'])
    expect([r.answered, r.failed]).toEqual([2, 1])
  })

  // The total counts only what was read. A failure is left out, so it neither zeroes nor inflates the total.
  it('leaves failed networks out of the total and does not make it 0', () => {
    const r = summarize(SOURCES, [FAILED, ok(2_000_000n), FAILED])
    expect(r.total).toBe(2_000_000n)
    expect(r.failed).toBe(2)
  })

  // A network still loading is neither counted nor reported as failed.
  it('keeps a network that has not answered yet out of the total and out of the failures', () => {
    const r = summarize(SOURCES, [ok(1_000_000n), { status: 'pending' }])
    expect(r.total).toBe(1_000_000n)
    expect([r.answered, r.failed, r.pending]).toEqual([1, 0, 2])
  })
})

describe('readWithTimeout', () => {
  it('passes through the balance a network answers with', async () => {
    await expect(readWithTimeout(source('Base', async () => 42n), ACCOUNT, 1_000)).resolves.toBe(42n)
  })

  // One slow network fails on its own once its time is up, so its row can say so.
  it('rejects when the network never answers', async () => {
    const slow = source('Polygon', () => new Promise<bigint>(() => {}))
    await expect(readWithTimeout(slow, ACCOUNT, 20)).rejects.toThrow('Polygon did not answer within 20 ms')
  })

  it('passes through the RPC error', async () => {
    const limited = source('Ethereum', () => Promise.reject(new Error('HTTP 429')))
    await expect(readWithTimeout(limited, ACCOUNT, 1_000)).rejects.toThrow('HTTP 429')
  })
})

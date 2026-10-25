import type { Address } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { TOKENS } from '../../../src/config'
import type { ReadClient } from '../../../src/lib/campaigns'
import { fetchSnapshot } from './snapshot'

const TEST_CREATOR = '0x2222222222222222222222222222222222222222'
const SEED = '0x74d4a3c56063f2f544d6c1444005b5174f482b76'
const FACTORY = '0x6890D40a9A472D0d05aDb5938D85B07059ad54ab' as Address

// The seed account is deliberately absent: it is a real creator, so its Fundits count.
vi.mock('../../../src/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/config')>()),
  TEST_CREATORS: ['0x2222222222222222222222222222222222222222'],
}))

const addr = (i: number) => `0x${i.toString(16).padStart(40, '0')}` as Address

function summary(creator: string) {
  return {
    creator,
    token: TOKENS.USDC.address,
    goal: 100n,
    raised: 50n,
    available: 40n,
    withdrawn: 10n,
    closed: false,
    donationFeeBps: 250,
    withdrawFeeBps: 100,
    createdAt: 1n,
    createdAtBlock: 77n,
  }
}

// A fake chain with `count` Fundits. creatorOf picks each one's creator.
function fakeClient(count: number, creatorOf: (i: number) => string = () => SEED) {
  const readContract = vi.fn(async ({ functionName, args }: { functionName: string; args?: readonly bigint[] }) => {
    if (functionName === 'campaignCount') return BigInt(count)
    const [offset, limit] = args as [bigint, bigint]
    const end = Math.min(count, Number(offset + limit))
    return Array.from({ length: end - Number(offset) }, (_, k) => addr(Number(offset) + k + 1))
  })
  const multicall = vi.fn(async ({ contracts }: { contracts: { address: Address; functionName: string }[]; allowFailure?: boolean }) =>
    contracts.map((c) => {
      const i = Number(BigInt(c.address)) - 1
      if (c.functionName === 'summary') return summary(creatorOf(i))
      return c.functionName === 'feesAccrued' ? 7n : 9n
    }),
  )
  return { client: { readContract, multicall } as unknown as ReadClient, readContract, multicall }
}

describe('fetchSnapshot', () => {
  it('reads 250 Fundits in 3 pages with one multicall each', async () => {
    const { client, multicall, readContract } = fakeClient(250)
    const rows = await fetchSnapshot(client, FACTORY)
    expect(rows).toHaveLength(250)
    expect(rows[0]!.address).toBe(addr(1))
    expect(rows[249]!.address).toBe(addr(250))
    expect(multicall).toHaveBeenCalledTimes(3)
    expect(readContract).toHaveBeenCalledTimes(4)
    expect(multicall.mock.calls.every(([a]) => (a as { allowFailure?: boolean }).allowFailure === false)).toBe(true)
    expect(rows[0]).toMatchObject({ feesAccrued: 7n, unaccounted: 9n, createdAtBlock: 77n, token: 'USDC' })
  })

  it("marks a test creator's Fundit isTest", async () => {
    const { client } = fakeClient(2, (i) => (i === 0 ? TEST_CREATOR : SEED))
    const rows = await fetchSnapshot(client, FACTORY)
    expect(rows.map((r) => r.isTest)).toEqual([true, false])
  })

  it('a Fundit by the seed account 0x74d4...2b76 is not a test Fundit on testnet', async () => {
    const { client } = fakeClient(1, () => SEED)
    const [row] = await fetchSnapshot(client, FACTORY)
    expect(row?.isTest).toBe(false)
  })
})

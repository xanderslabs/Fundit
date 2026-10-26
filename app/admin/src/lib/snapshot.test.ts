import type { Address } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import type { ReadClient } from '../../../src/lib/campaigns'
import { ADMIN_NETWORKS } from './networks'
import { fetchSnapshot } from './snapshot'

// A real testnet test creator (the first testnet Fundit's). The seed account is deliberately absent from the list:
// it is a real creator, so its Fundits count.
const TEST_CREATOR = '0xb6ac54f822867adaaa39daa8cc97c6e0a17a2402'
const SEED = '0x74d4a3c56063f2f544d6c1444005b5174f482b76'

const addr = (i: number) => `0x${i.toString(16).padStart(40, '0')}` as Address

function summary(creator: string, token: Address = ADMIN_NETWORKS.testnet.usdc) {
  return {
    creator,
    token,
    goal: 100n,
    raised: 50n,
    available: 40n,
    withdrawn: 10n,
    closed: false,
    donationFeeBps: 250,
    withdrawFeeBps: 100,
    createdAt: 1_760_000_000n,
    createdAtBlock: 77n,
    backup: '0x0000000000000000000000000000000000000000',
    recoveryReadyAt: 0n,
    meta: { title: `Fundit by ${creator.slice(0, 6)}`, description: '', imageUrl: '' },
  }
}

// A fake chain with `count` Fundits. creatorOf picks each one's creator.
function fakeClient(count: number, creatorOf: (i: number) => string = () => SEED, token?: Address) {
  const readContract = vi.fn(async ({ functionName, args }: { functionName: string; args?: readonly bigint[] }) => {
    if (functionName === 'campaignCount') return BigInt(count)
    const [offset, limit] = args as [bigint, bigint]
    const end = Math.min(count, Number(offset + limit))
    return Array.from({ length: end - Number(offset) }, (_, k) => addr(Number(offset) + k + 1))
  })
  const multicall = vi.fn(async ({ contracts }: { contracts: { address: Address; functionName: string }[]; allowFailure?: boolean }) =>
    contracts.map((c) => {
      const i = Number(BigInt(c.address)) - 1
      if (c.functionName === 'summary') return summary(creatorOf(i), token)
      return c.functionName === 'feesAccrued' ? 7n : 9n
    }),
  )
  return { client: { readContract, multicall } as unknown as ReadClient, readContract, multicall }
}

describe('fetchSnapshot', () => {
  it('reads 250 Fundits in 3 pages with one multicall each', async () => {
    const { client, multicall, readContract } = fakeClient(250)
    const rows = await fetchSnapshot(client, 'testnet')
    expect(rows).toHaveLength(250)
    expect(rows[0]!.address).toBe(addr(1))
    expect(rows[249]!.address).toBe(addr(250))
    expect(multicall).toHaveBeenCalledTimes(3)
    expect(readContract).toHaveBeenCalledTimes(4)
    // The factory comes from the network, never from the build.
    for (const [a] of readContract.mock.calls) expect((a as unknown as { address: Address }).address).toBe(ADMIN_NETWORKS.testnet.factory)
    expect(multicall.mock.calls.every(([a]) => (a as { allowFailure?: boolean }).allowFailure === false)).toBe(true)
    expect(rows[0]).toMatchObject({ feesAccrued: 7n, unaccounted: 9n, createdAtBlock: 77n, token: 'USDC' })
  })

  it('rows carry the title and createdAt from summary()', async () => {
    const { client } = fakeClient(1, () => SEED)
    const [row] = await fetchSnapshot(client, 'testnet')
    expect(row?.title).toBe('Fundit by 0x74d4')
    expect(row?.createdAt).toBe(1_760_000_000n)
  })

  it('a testnet test creator is isTest on testnet and not on mainnet', async () => {
    const { client } = fakeClient(1, () => TEST_CREATOR)
    expect((await fetchSnapshot(client, 'testnet'))[0]?.isTest).toBe(true)
    expect((await fetchSnapshot(client, 'mainnet'))[0]?.isTest).toBe(false)
  })

  it("reads the token by the network's own EURC address", async () => {
    const { client } = fakeClient(1, () => SEED, ADMIN_NETWORKS.testnet.eurc)
    expect((await fetchSnapshot(client, 'testnet'))[0]?.token).toBe('EURC')
    // On mainnet the testnet EURC address is not EURC.
    expect((await fetchSnapshot(client, 'mainnet'))[0]?.token).toBe('USDC')
  })

  it("marks a test creator's Fundit isTest", async () => {
    const { client } = fakeClient(2, (i) => (i === 0 ? TEST_CREATOR : SEED))
    const rows = await fetchSnapshot(client, 'testnet')
    expect(rows.map((r) => r.isTest)).toEqual([true, false])
  })

  it('a Fundit by the seed account 0x74d4...2b76 is not a test Fundit on testnet', async () => {
    const { client } = fakeClient(1, () => SEED)
    const [row] = await fetchSnapshot(client, 'testnet')
    expect(row?.isTest).toBe(false)
  })
})

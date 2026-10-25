import type { Address } from 'viem'
import { campaignAbi } from '../../../src/abi/campaign'
import { factoryAbi } from '../../../src/abi/factory'
import { TEST_CREATORS, type TokenSymbol } from '../../../src/config'
import { type ReadClient, type Summary, tokenSymbol } from '../../../src/lib/campaigns'

export type FunditSnapshot = {
  address: Address
  creator: Address
  token: TokenSymbol
  goal: bigint
  raised: bigint
  available: bigint
  withdrawn: bigint
  closed: boolean
  donationFeeBps: number
  createdAtBlock: bigint
  feesAccrued: bigint
  unaccounted: bigint
  isTest: boolean
}

const PAGE = 100n

// Every Fundit the factory made, oldest first: one getCampaigns read and one multicall per page of 100.
export async function fetchSnapshot(client: ReadClient, factory: Address): Promise<FunditSnapshot[]> {
  const count = await client.readContract({ address: factory, abi: factoryAbi, functionName: 'campaignCount' })
  const rows: FunditSnapshot[] = []
  for (let offset = 0n; offset < count; offset += PAGE) {
    const page = await client.readContract({ address: factory, abi: factoryAbi, functionName: 'getCampaigns', args: [offset, PAGE] })
    if (page.length === 0) break
    const results = await client.multicall({
      contracts: page.flatMap((address) => [
        { address, abi: campaignAbi, functionName: 'summary' } as const,
        { address, abi: campaignAbi, functionName: 'feesAccrued' } as const,
        { address, abi: campaignAbi, functionName: 'unaccounted' } as const,
      ]),
      allowFailure: false,
    })
    page.forEach((address, i) => {
      const s = results[i * 3] as Summary
      rows.push({
        address,
        creator: s.creator,
        token: tokenSymbol(s.token),
        goal: s.goal,
        raised: s.raised,
        available: s.available,
        withdrawn: s.withdrawn,
        closed: s.closed,
        donationFeeBps: s.donationFeeBps,
        createdAtBlock: s.createdAtBlock,
        feesAccrued: results[i * 3 + 1] as bigint,
        unaccounted: results[i * 3 + 2] as bigint,
        isTest: TEST_CREATORS.includes(s.creator.toLowerCase()),
      })
    })
  }
  return rows
}

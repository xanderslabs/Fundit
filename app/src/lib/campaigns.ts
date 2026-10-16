import type { Address, ContractFunctionReturnType, PublicClient } from 'viem'
import { zeroAddress } from 'viem'
import { campaignAbi } from '../abi/campaign'
import { factoryAbi } from '../abi/factory'
import { FACTORY_ADDRESS, TOKENS, type TokenSymbol } from '../config'

export type Summary = ContractFunctionReturnType<typeof campaignAbi, 'view', 'summary'>

export type CampaignView = { address: Address; summary: Summary; symbol: TokenSymbol }

export type ReadClient = Pick<PublicClient, 'readContract' | 'multicall'>

export function tokenSymbol(token: Address): TokenSymbol {
  return token.toLowerCase() === TOKENS.EURC.address.toLowerCase() ? 'EURC' : 'USDC'
}

function toView(address: Address, summary: Summary): CampaignView {
  return { address, summary, symbol: tokenSymbol(summary.token) }
}

// offset counts from the newest campaign. The factory stores them oldest first, so read from the end.
export async function fetchCampaignPage(client: ReadClient, offset: bigint, limit: bigint): Promise<CampaignView[]> {
  const count = await client.readContract({ address: FACTORY_ADDRESS, abi: factoryAbi, functionName: 'campaignCount' })
  if (offset >= count || limit <= 0n) return []
  const end = count - offset
  const start = end > limit ? end - limit : 0n
  const addresses = await client.readContract({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: 'getCampaigns',
    args: [start, end - start],
  })
  const newestFirst = [...addresses].reverse()
  if (newestFirst.length === 0) return []
  const summaries = await client.multicall({
    contracts: newestFirst.map((address) => ({ address, abi: campaignAbi, functionName: 'summary' }) as const),
    allowFailure: false,
  })
  return newestFirst.map((address, i) => toView(address, summaries[i] as Summary))
}

// Any address in a URL is untrusted. Only the factory's own campaigns are read.
export async function fetchCampaign(client: ReadClient, address: Address): Promise<CampaignView | 'not-a-campaign'> {
  const known = await client.readContract({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: 'isCampaign',
    args: [address],
  })
  if (!known) return 'not-a-campaign'
  const summary = await client.readContract({ address, abi: campaignAbi, functionName: 'summary' })
  return toView(address, summary)
}

export async function fetchFeatured(client: ReadClient): Promise<CampaignView | null> {
  const featured = await client.readContract({ address: FACTORY_ADDRESS, abi: factoryAbi, functionName: 'featuredCampaign' })
  if (featured === zeroAddress) return null
  const view = await fetchCampaign(client, featured)
  return view === 'not-a-campaign' ? null : view
}

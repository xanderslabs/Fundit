import { useInfiniteQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { campaignAbi } from '../abi/campaign'
import { type ActivityItem, walkActivity } from '../lib/activity'
import { arcClient } from '../lib/clients'

export const ACTIVITY_PAGE = 50

export type ActivityPage = {
  items: ActivityItem[]
  nextCursor: bigint | null
  // Unix seconds per block number, for the blocks in this page.
  times: Map<bigint, bigint>
  tip: bigint
  last: bigint
}

type PageParam = { cursor: bigint; tip: bigint; last: bigint } | null

// Block timestamps never change, so they are cached for the whole session.
const blockTimes = new Map<bigint, bigint>()

async function timesFor(blocks: bigint[]): Promise<Map<bigint, bigint>> {
  const missing = [...new Set(blocks)].filter((b) => !blockTimes.has(b))
  const fetched = await Promise.all(missing.map((blockNumber) => arcClient.getBlock({ blockNumber })))
  for (const block of fetched) blockTimes.set(block.number, block.timestamp)
  return new Map(blocks.map((b) => [b, blockTimes.get(b)!]))
}

async function loadPage(campaign: Address, createdAtBlock: bigint, param: PageParam): Promise<ActivityPage> {
  // The first page reads where the history ends. Later pages reuse it so the walk stays consistent.
  const [last, tip] = param
    ? [param.last, param.tip]
    : await Promise.all([
        arcClient.readContract({ address: campaign, abi: campaignAbi, functionName: 'lastActivityBlock' }),
        arcClient.getBlockNumber(),
      ])
  const page = await walkActivity(arcClient, campaign, {
    fromBlockTip: tip,
    createdAtBlock,
    lastActivityBlock: last,
    limit: ACTIVITY_PAGE,
    cursor: param?.cursor,
  })
  const times = await timesFor(page.items.map((i) => i.blockNumber))
  return { ...page, times, tip, last }
}

// Only call this for an address that factory.isCampaign has confirmed.
export function useActivity(campaign: Address, createdAtBlock: bigint) {
  return useInfiniteQuery({
    queryKey: ['activity', campaign.toLowerCase(), createdAtBlock.toString()],
    queryFn: ({ pageParam }) => loadPage(campaign, createdAtBlock, pageParam),
    initialPageParam: null as PageParam,
    getNextPageParam: (page): PageParam | undefined =>
      page.nextCursor === null ? undefined : { cursor: page.nextCursor, tip: page.tip, last: page.last },
    staleTime: 15_000,
  })
}

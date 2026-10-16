import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { fetchCampaign, fetchCampaignPage, fetchFactoryFees, fetchFeatured } from '../lib/campaigns'
import { arcClient } from '../lib/clients'

export const PAGE_SIZE = 60n
const STALE_TIME = 15_000

// offset counts from the newest campaign. Exported so Explore can load several pages with useQueries.
export function campaignsQuery(offset: bigint) {
  return {
    queryKey: ['campaigns', offset.toString()],
    queryFn: () => fetchCampaignPage(arcClient, offset, PAGE_SIZE),
    staleTime: STALE_TIME,
  }
}

export function useCampaigns(offset: bigint) {
  return useQuery(campaignsQuery(offset))
}

// Pass undefined when the URL holds no valid address; the query then never runs.
export function useCampaign(address: Address | undefined) {
  return useQuery({
    queryKey: ['campaign', address?.toLowerCase()],
    queryFn: () => fetchCampaign(arcClient, address!),
    enabled: address !== undefined,
    staleTime: STALE_TIME,
  })
}

export function useFeatured() {
  return useQuery({ queryKey: ['featured'], queryFn: () => fetchFeatured(arcClient), staleTime: STALE_TIME })
}

export function useFactoryFees() {
  return useQuery({ queryKey: ['factory-fees'], queryFn: () => fetchFactoryFees(arcClient), staleTime: STALE_TIME })
}

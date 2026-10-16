import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { mainnetClient } from '../lib/clients'
import { resolveName } from '../lib/names'

const HOUR = 60 * 60 * 1000

// Names change rarely, so each address is looked up at most once an hour.
export function useName(address: Address) {
  return useQuery({
    queryKey: ['name', address.toLowerCase()],
    queryFn: () => resolveName(mainnetClient, address),
    staleTime: HOUR,
    gcTime: HOUR,
    retry: false,
  })
}

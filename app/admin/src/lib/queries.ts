import { useQuery } from '@tanstack/react-query'
import { type AdminSession, getHealth, matchesWorker } from './api'
import { readClient } from './clients'
import type { AdminNetwork } from './networks'
import { fetchSnapshot } from './snapshot'

// Panel reads refresh every minute while the tab is visible, and a card marks its data stale at twice that.
const REFRESH = { refetchInterval: 60_000, refetchIntervalInBackground: false, retry: 1 } as const
export const STALE_AFTER_MS = 120_000

// Same key as the history scan and the Gifts page, so they share one read.
export function useSnapshot(session: AdminSession, network: AdminNetwork) {
  return useQuery({
    queryKey: ['admin', network, 'snapshot'],
    queryFn: () => fetchSnapshot(readClient(network), network),
    enabled: matchesWorker(session, network),
    ...REFRESH,
  })
}

export function useHealth(network: AdminNetwork) {
  return useQuery({ queryKey: ['admin', network, 'health'], queryFn: () => getHealth(network), ...REFRESH })
}

import { useQuery } from '@tanstack/react-query'
import { type AdminSession, getHealth, matchesWorker } from './api'
import { readClient } from './clients'
import type { AdminNetwork } from './networks'
import { fetchSnapshot } from './snapshot'

// Panel reads refresh every minute while the tab is visible, and a card marks its data stale at twice that.
const REFRESH = { refetchInterval: 60_000, refetchIntervalInBackground: false, retry: 1 } as const
export const STALE_AFTER_MS = 120_000

// The one setup for the snapshot. Every page and the history scan use it, as each observer of a key runs its own
// refetch timer: a second setup would read every Fundit again on its own schedule.
export function snapshotQueryOptions(network: AdminNetwork, enabled: boolean) {
  return {
    queryKey: ['admin', network, 'snapshot'],
    queryFn: () => fetchSnapshot(readClient(network), network),
    enabled,
    ...REFRESH,
  } as const
}

export function useSnapshot(session: AdminSession, network: AdminNetwork) {
  return useQuery(snapshotQueryOptions(network, matchesWorker(session, network)))
}

export function useHealth(network: AdminNetwork) {
  return useQuery({ queryKey: ['admin', network, 'health'], queryFn: () => getHealth(network), ...REFRESH })
}

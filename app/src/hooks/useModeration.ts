import { useQuery } from '@tanstack/react-query'
import { EMPTY_MODERATION, fetchModeration, type Moderation } from '../lib/moderation'

// Never blocks anything: EMPTY_MODERATION while loading or on error, so every Fundit reads as normal.
export function useModeration(): Moderation {
  const query = useQuery({ queryKey: ['moderation'], queryFn: fetchModeration, staleTime: 60_000, refetchInterval: 60_000 })
  return query.data ?? EMPTY_MODERATION
}

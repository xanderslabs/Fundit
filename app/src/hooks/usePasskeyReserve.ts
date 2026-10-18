import { useQuery } from '@tanstack/react-query'
import { passkeyReserve } from '../lib/passkey'
import type { Call, Sender } from '../lib/sender'

export const RESERVE_KEY = 'passkey-reserve'
const RESERVE_POLL_MS = 15_000

// The USDC a Fundit account keeps back for the network fee (see passkeyReserve), or undefined while it loads.
// Only passkey senders have one; a wallet pays its own gas. calls is an operation of the same shape as the one
// the form sends (a gift is an approve and a donate), named by key; without it a USDC transfer stands in.
// The reserve changes with every operation (the first one deploys the account, and each leaves a deposit in
// the EntryPoint), so it is read again on every mount, polled like the balance, and dropped after each send.
export function usePasskeyReserve(sender: Sender | null, shape?: { key: string; calls: Call[] }): bigint | undefined {
  const address = sender?.kind === 'passkey' ? sender.address : null
  const query = useQuery({
    queryKey: [RESERVE_KEY, address?.toLowerCase(), shape?.key ?? 'transfer'],
    queryFn: () => passkeyReserve(address!, shape?.calls),
    enabled: address !== null,
    staleTime: 0,
    refetchInterval: RESERVE_POLL_MS,
  })
  return query.data
}

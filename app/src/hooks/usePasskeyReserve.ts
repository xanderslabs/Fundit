import { useQuery } from '@tanstack/react-query'
import { passkeyReserve } from '../lib/passkey'
import type { Call, Sender } from '../lib/sender'

export const RESERVE_KEY = 'passkey-reserve'
const RESERVE_POLL_MS = 15_000

// The USDC a Fundit account keeps back for the network fee (see passkeyReserve), or undefined while it loads.
// Only passkey senders have one; a wallet pays its own gas. shape is an operation like the one the form sends (a
// gift is an approve and a donate), named by key; without it a USDC transfer stands in. The reserve changes with
// every operation (the first one deploys the account, and each leaves a deposit in the EntryPoint), so it is
// read again on every mount and dropped after each send. It is polled only while polling is true (the person
// is typing an amount), since each read is a bundler estimate. This number is for the form: passkeySender
// checks again with a fresh estimate before it sends.
export function usePasskeyReserve(sender: Sender | null, shape?: { key: string; calls: Call[] }, polling = false): bigint | undefined {
  const address = sender?.kind === 'passkey' ? sender.address : null
  const query = useQuery({
    queryKey: [RESERVE_KEY, address?.toLowerCase(), shape?.key ?? 'transfer'],
    queryFn: () => passkeyReserve(address!, shape?.calls),
    enabled: address !== null,
    staleTime: 0,
    refetchInterval: polling ? RESERVE_POLL_MS : false,
  })
  return query.data
}

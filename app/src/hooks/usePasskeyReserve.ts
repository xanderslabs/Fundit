import { useQuery } from '@tanstack/react-query'
import { passkeyReserve } from '../lib/passkey'
import type { Sender } from '../lib/sender'

// The USDC a Fundit account keeps back for the network fee (see passkeyReserve), or undefined while it loads.
// Only passkey senders have one; a wallet pays its own gas.
export function usePasskeyReserve(sender: Sender | null): bigint | undefined {
  const address = sender?.kind === 'passkey' ? sender.address : null
  const query = useQuery({
    queryKey: ['passkey-reserve', address?.toLowerCase()],
    queryFn: () => passkeyReserve(address!),
    enabled: address !== null,
    staleTime: 30_000,
  })
  return query.data
}

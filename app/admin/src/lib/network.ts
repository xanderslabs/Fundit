import { createContext, useContext } from 'react'
import { useSearchParams } from 'react-router'
import type { AdminSession } from './api'
import type { AdminNetwork } from './networks'

// The network the panel shows. It is in the URL as ?network=testnet (mainnet has no parameter) so a link opens the
// right one, and remembered in this browser. A network is only ever picked when the signed-in address owns its
// factory there.
const KEY = 'fundit-admin:network'
const ORDER = ['mainnet', 'testnet'] as const satisfies readonly AdminNetwork[]

function isNetwork(v: string | null): v is AdminNetwork {
  return v === 'mainnet' || v === 'testnet'
}

// In order: ?network= if owned, the stored choice if owned, then mainnet, then testnet. null when the address owns
// neither (the Worker refuses such a session, so this is a safety net).
export function pickNetwork(search: string, stored: string | null, session: AdminSession): AdminNetwork | null {
  const owned = (n: AdminNetwork) => session.networks[n].owner === true
  const asked = new URLSearchParams(search).get('network')
  for (const n of [asked, stored, ...ORDER]) {
    if (isNetwork(n) && owned(n)) return n
  }
  return null
}

export function readStoredNetwork(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function storeNetwork(n: AdminNetwork) {
  try {
    localStorage.setItem(KEY, n)
  } catch {
    // Not saved: the URL still carries the choice.
  }
}

// The signed-in session, for everything under the router.
export const SessionContext = createContext<AdminSession | null>(null)

export function useSession(): AdminSession {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession needs a SessionContext')
  return session
}

// The URL form of a network: ?network=testnet for testnet, nothing for mainnet. Other parameters are kept.
export function withNetwork(params: URLSearchParams, n: AdminNetwork): URLSearchParams {
  const next = new URLSearchParams(params)
  if (n === 'testnet') next.set('network', 'testnet')
  else next.delete('network')
  return next
}

export function useNetwork(): { network: AdminNetwork; setNetwork(n: AdminNetwork): void } {
  const session = useSession()
  const [params, setParams] = useSearchParams()
  const network = pickNetwork(`?${params.toString()}`, readStoredNetwork(), session)
  // The shell renders no page without a network, so this only fires on a wiring mistake.
  if (!network) throw new Error('No network this session owns')

  function setNetwork(n: AdminNetwork) {
    storeNetwork(n)
    setParams((p) => withNetwork(p, n), { replace: true })
  }

  return { network, setNetwork }
}

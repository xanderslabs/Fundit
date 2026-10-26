import { type Address, isAddressEqual } from 'viem'
import { type AdminNetwork, ADMIN_NETWORKS } from './networks'

// owner is null when that network's owner() read failed, so the panel cannot tell either way.
export type AdminSession = { address: Address; networks: Record<AdminNetwork, { chainId: number; factory: Address; owner: boolean | null }> }

// Whether the Worker names the same chain and factory as this build for the network. A mismatch means the two
// were built from different code, so nothing is read or sent.
export function matchesWorker(session: AdminSession, network: AdminNetwork): boolean {
  const s = session.networks[network]
  const n = ADMIN_NETWORKS[network]
  return s.chainId === n.chainId && isAddressEqual(s.factory, n.factory)
}

// The Worker's cron state for one network (GET /api/admin/health). Times are epoch milliseconds; the block numbers
// are decimal strings, null until the cron has stored one.
export type HealthCheck = { key: string; ok: boolean; failCount: number; since: number; lastSent: number }
export type HealthReport = { checks: HealthCheck[]; alertsStarted: boolean; lastEventBlock: string | null; rpcHead: string | null }

// The signed-in owner, or null with no session (the Worker answers 401). Any other failure throws, so a broken
// Worker is never shown as "signed out".
export async function getSession(): Promise<AdminSession | null> {
  const res = await fetch('/api/admin/session')
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`Session check failed (${res.status})`)
  return (await res.json()) as AdminSession
}

// A panel call answered 401: the session has ended (after 8 h, or on sign-out in another tab). Reloading the page
// the owner is on makes the Worker serve the login page there, which returns to it after sign-in.
function signedOut(): never {
  location.assign(`${location.pathname}${location.search}`)
  throw new Error('Signed out')
}

export async function getHealth(network: AdminNetwork): Promise<HealthReport> {
  const res = await fetch(`/api/admin/health?network=${network}`)
  if (res.status === 401) signedOut()
  if (!res.ok) throw new Error(`Health check failed (${res.status})`)
  return (await res.json()) as HealthReport
}

// Ends the session. The cookie is cleared by the Worker; a failed call still leaves the person signed in, so it throws.
export async function logout(): Promise<void> {
  const res = await fetch('/api/admin/logout', { method: 'POST' })
  if (!res.ok) throw new Error(`Sign out failed (${res.status})`)
}

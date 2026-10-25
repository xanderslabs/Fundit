import type { Address } from 'viem'

export type AdminSession = { address: Address; network: 'testnet' | 'mainnet'; chainId: number; factory: Address }

// The signed-in owner, or null with no session (the Worker answers 401). Any other failure throws, so a broken
// Worker is never shown as "signed out".
export async function getSession(): Promise<AdminSession | null> {
  const res = await fetch('/api/admin/session')
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`Session check failed (${res.status})`)
  return (await res.json()) as AdminSession
}

// Ends the session. The cookie is cleared by the Worker; a failed call still leaves the person signed in, so it throws.
export async function logout(): Promise<void> {
  const res = await fetch('/api/admin/logout', { method: 'POST' })
  if (!res.ok) throw new Error(`Sign out failed (${res.status})`)
}

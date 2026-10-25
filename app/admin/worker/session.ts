// The signed-in owner's session: a cookie holding the session as JSON plus an HMAC-SHA256 of it, keyed with
// ADMIN_SESSION_SECRET. Nothing is stored on the server; the Worker checks owner() again on every request.
import type { Address } from 'viem'

export const SESSION_COOKIE = '__Host-fundit_admin'
export const SESSION_TTL_SEC = 28_800

// Addresses lower case, times in seconds.
export type Session = { v: 1; address: Address; chainId: number; factory: Address; iat: number; exp: number }

// __Host- needs Secure, Path=/ and no Domain, so no other subdomain can set or read it.
const ATTRIBUTES = 'Path=/; HttpOnly; Secure; SameSite=Strict'
const LOWER_ADDRESS = /^0x[0-9a-f]{40}$/
const B64URL = /^[A-Za-z0-9_-]+$/

function decodeBase64(text: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

function toBase64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(text: string): Uint8Array | null {
  if (!B64URL.test(text)) return null
  return decodeBase64(text.replace(/-/g, '+').replace(/_/g, '/'))
}

// The secret is base64 and must decode to at least 32 bytes.
export function secretOk(secret: string | undefined): boolean {
  if (!secret) return false
  return (decodeBase64(secret)?.length ?? 0) >= 32
}

function hmacKey(secret: string): Promise<CryptoKey> {
  const raw = decodeBase64(secret)
  if (!raw || raw.length < 32) throw new Error('bad session secret')
  return crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signSession(s: Session, secret: string): Promise<string> {
  const payload = toBase64url(new TextEncoder().encode(JSON.stringify(s)))
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(payload))
  return `${payload}.${toBase64url(new Uint8Array(mac))}`
}

function cookieValue(header: string | null): string | null {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim()
  }
  return null
}

function isSession(x: unknown): x is Session {
  if (typeof x !== 'object' || x === null) return false
  const s = x as Record<string, unknown>
  return (
    Object.keys(s).length === 6 &&
    s.v === 1 &&
    typeof s.address === 'string' &&
    LOWER_ADDRESS.test(s.address) &&
    typeof s.factory === 'string' &&
    LOWER_ADDRESS.test(s.factory) &&
    Number.isSafeInteger(s.chainId) &&
    Number.isSafeInteger(s.iat) &&
    Number.isSafeInteger(s.exp)
  )
}

// The session in the cookie, or null when it is missing, malformed, signed with another key or expired.
// The MAC is checked first, with crypto.subtle.verify (constant time), before the payload is parsed.
export async function readSession(cookieHeader: string | null, secret: string, nowSec: number): Promise<Session | null> {
  const value = cookieValue(cookieHeader)
  if (!value || value.length > 1024) return null
  const parts = value.split('.')
  if (parts.length !== 2) return null
  const [payload, macText] = parts as [string, string]
  const mac = fromBase64url(macText)
  if (!payload || !mac || !B64URL.test(payload)) return null
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), mac as Uint8Array<ArrayBuffer>, new TextEncoder().encode(payload))
    if (!ok) return null
    const bytes = fromBase64url(payload)
    if (!bytes) return null
    const s: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!isSession(s)) return null
    if (s.exp <= nowSec || s.exp - s.iat > SESSION_TTL_SEC) return null
    return s
  } catch {
    return null
  }
}

export function sessionCookie(value: string): string {
  return `${SESSION_COOKIE}=${value}; ${ATTRIBUTES}; Max-Age=${SESSION_TTL_SEC}`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; ${ATTRIBUTES}; Max-Age=0`
}

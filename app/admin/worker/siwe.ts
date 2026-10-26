// Checks the Sign-In with Ethereum (EIP-4361) message the panel asks the owner's wallet to sign.
// Every field must be exactly what the panel builds for this Worker; anything else is refused before the
// signature is even checked.
import { verifyMessage, type Address, type Hex } from 'viem'
import { createSiweMessage, parseSiweMessage } from 'viem/siwe'

export const ADMIN_STATEMENT = 'Sign in to the Fundit admin panel.'
export const MAX_MESSAGE_CHARS = 2048
export const MAX_LIFETIME_MS = 600_000
export const CLOCK_SKEW_MS = 60_000

export type LoginRefusal = 'bad_message' | 'wrong_domain' | 'wrong_uri' | 'wrong_chain' | 'expired' | 'not_yet_valid' | 'too_long_lived'

// chainIds: every chain a message may name. The Worker passes both Arc chains.
type Expect = { origin: string; chainIds: readonly number[]; nowMs: number }

const valid = (d: Date | undefined): d is Date => d instanceof Date && !Number.isNaN(d.getTime())

export function checkLoginMessage(message: string, expect: Expect): { ok: true; address: Address; nonce: string } | { ok: false; reason: LoginRefusal } {
  const refuse = (reason: LoginRefusal) => ({ ok: false as const, reason })
  if (typeof message !== 'string' || message.length > MAX_MESSAGE_CHARS) return refuse('bad_message')
  const m = parseSiweMessage(message)
  if (!m.address || !m.domain || !m.uri || !m.nonce || m.chainId === undefined) return refuse('bad_message')
  if (m.version !== '1' || m.statement !== ADMIN_STATEMENT) return refuse('bad_message')
  if (!valid(m.issuedAt) || !valid(m.expirationTime) || (m.notBefore !== undefined && !valid(m.notBefore))) return refuse('bad_message')
  // parseSiweMessage does not anchor the part from "URI:" on, so extra lines could slip through. The message must
  // be exactly what createSiweMessage gives for the parsed fields (which also needs a checksummed address).
  try {
    if (createSiweMessage({ ...m, version: '1' } as Parameters<typeof createSiweMessage>[0]) !== message) return refuse('bad_message')
  } catch {
    return refuse('bad_message')
  }
  if ((m.scheme !== undefined && m.scheme !== 'https') || m.domain !== new URL(expect.origin).host) return refuse('wrong_domain')
  if (m.uri !== expect.origin) return refuse('wrong_uri')
  if (!expect.chainIds.includes(m.chainId)) return refuse('wrong_chain')
  const issued = m.issuedAt.getTime()
  const expires = m.expirationTime.getTime()
  if (expires <= expect.nowMs) return refuse('expired')
  if (issued > expect.nowMs + CLOCK_SKEW_MS) return refuse('not_yet_valid')
  if (m.notBefore && m.notBefore.getTime() > expect.nowMs + CLOCK_SKEW_MS) return refuse('not_yet_valid')
  if (expires - issued > MAX_LIFETIME_MS) return refuse('too_long_lived')
  return { ok: true, address: m.address, nonce: m.nonce }
}

// True when `address` signed `message` (EIP-191). False on a bad signature, never a throw.
export async function signerMatches(message: string, address: Address, signature: Hex): Promise<boolean> {
  try {
    return await verifyMessage({ address, message, signature })
  } catch {
    return false
  }
}

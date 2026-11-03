import { isAddress } from 'viem'

// The team's own decisions about Fundits, from GET /api/moderation. Addresses are lowercase.
export type Moderation = { review: Set<string>; removed: Set<string> }

export const EMPTY_MODERATION: Moderation = { review: new Set(), removed: new Set() }

function addresses(list: unknown): Set<string> | null {
  if (!Array.isArray(list)) return null
  return new Set(list.filter((a): a is string => typeof a === 'string' && isAddress(a, { strict: false })).map((a) => a.toLowerCase()))
}

// Anything malformed gives EMPTY_MODERATION: if the list cannot be read, every Fundit is treated as normal.
export function parseModeration(body: unknown): Moderation {
  if (typeof body !== 'object' || body === null) return EMPTY_MODERATION
  const { review, removed } = body as { review?: unknown; removed?: unknown }
  const r = addresses(review)
  const x = addresses(removed)
  return r && x ? { review: r, removed: x } : EMPTY_MODERATION
}

export function moderationFor(m: Moderation, address: string): 'normal' | 'review' | 'removed' {
  const key = address.toLowerCase()
  return m.removed.has(key) ? 'removed' : m.review.has(key) ? 'review' : 'normal'
}

// Fails open. Local dev and e2e have no Worker, so the request 404s or returns HTML.
export async function fetchModeration(): Promise<Moderation> {
  try {
    const res = await fetch('/api/moderation')
    if (!res.ok) return EMPTY_MODERATION
    return parseModeration(await res.json())
  } catch {
    return EMPTY_MODERATION
  }
}

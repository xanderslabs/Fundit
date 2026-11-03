// GET /api/moderation: the Fundits the owner has marked, for this Worker's own network. The site hides the removed
// ones and warns on the ones under review. Read-only: the admin Worker writes the table (moderation/migrations).
//
// The note column never leaves the admin side, so the query does not select it.
import type { Env } from './index'

// The part of Cloudflare D1 this route uses. Same shape as admin/worker/db.ts, copied because the public Worker does
// not import admin code.
export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike
  first<T>(): Promise<T | null>
  run(): Promise<unknown>
  all<T>(): Promise<{ results: T[] }>
}

export interface D1Like {
  prepare(sql: string): D1StatementLike
}

type Row = { address: string; state: 'review' | 'removed' }

function reply(status: number, body: unknown, cache: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': cache, 'x-content-type-options': 'nosniff' },
  })
}

export async function handleModeration(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return reply(405, { error: 'method' }, 'no-store')
  if (env.NETWORK !== 'mainnet' && env.NETWORK !== 'testnet') return reply(503, { error: 'unavailable' }, 'no-store')
  const lists: { review: string[]; removed: string[] } = { review: [], removed: [] }
  // Fail open: without the binding nothing is flagged.
  if (!env.MOD_DB) return reply(200, lists, 'public, max-age=60')
  try {
    const { results } = await env.MOD_DB.prepare("SELECT address, state FROM fundit_state WHERE network = ? AND state IN ('review','removed')")
      .bind(env.NETWORK)
      .all<Row>()
    for (const row of results) lists[row.state].push(row.address)
  } catch {
    // No error text: the site treats any failure as "load nothing" and retries.
    return reply(503, { error: 'unavailable' }, 'no-store')
  }
  return reply(200, lists, 'public, max-age=60')
}

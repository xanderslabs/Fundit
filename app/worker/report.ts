// POST /api/report: the "Report a problem" form sends a message to the team's private Telegram chat. It needs no
// Circle values.
//
// The message holds only what the person typed. The server keeps no copy, and adds no IP address or user agent.
// Never log the report text, the email, a token or any response body.
import { type Env } from './index'
import { sendTelegram } from './telegram'
import { TURNSTILE_TOKEN, verifyTurnstile } from './turnstile'

export const REPORT_CATEGORIES = ['Signing in', 'Adding money', 'Giving', 'Creating or managing a Fundit', 'Withdrawing', 'Something else'] as const

export type ReportInput = { category: (typeof REPORT_CATEGORIES)[number]; page: string; what: string; tx?: string; email?: string }

const MAX_BODY = 8 * 1024
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/

function text(v: unknown, min: number, max: number): string | null {
  return typeof v === 'string' && v.length >= min && v.length <= max ? v : null
}

// Keeps the five typed fields and the Turnstile token. Every other field is ignored.
export function validateReport(body: Record<string, unknown>): { ok: true; input: ReportInput; turnstile: string } | { ok: false } {
  const category = REPORT_CATEGORIES.find((c) => c === body.category)
  const page = text(body.page, 0, 200)
  const what = text(body.what, 1, 2000)
  const turnstile = typeof body.turnstile === 'string' && TURNSTILE_TOKEN.test(body.turnstile) ? body.turnstile : null
  if (!category || page === null || !what || !turnstile) return { ok: false }
  const input: ReportInput = { category, page, what }
  if (body.tx !== undefined && body.tx !== '') {
    const tx = text(body.tx, 1, 200)
    if (tx === null) return { ok: false }
    input.tx = tx
  }
  if (body.email !== undefined && body.email !== '') {
    const email = text(body.email, 1, 254)
    if (email === null || !EMAIL.test(email)) return { ok: false }
    input.email = email
  }
  return { ok: true, input, turnstile }
}

// Plain text with no parse mode, so nothing the person typed is read as formatting.
export function messageFor(input: ReportInput): string {
  const parts = [`Problem report: ${input.category}`, `Page: ${input.page}`, `What happened:\n${input.what}`]
  if (input.tx) parts.push(`Transaction: ${input.tx}`)
  if (input.email) parts.push(`Email: ${input.email}`)
  return parts.join('\n\n')
}

function reply(status: number, error?: string): Response {
  return new Response(JSON.stringify(error ? { error } : { ok: true }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })
}

async function limited(env: Env, key: string): Promise<boolean> {
  return env.UCW_LIMIT ? !(await env.UCW_LIMIT.limit({ key })).success : false
}

export async function handleReport(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return reply(405, 'bad_input')
  if (request.headers.get('origin') !== env.SITE_ORIGIN) return reply(403, 'origin')
  if (!env.SITE_ORIGIN || !env.TURNSTILE_SECRET || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return reply(503, 'unavailable')

  let body: unknown
  try {
    if (!/^application\/json(\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return reply(400, 'bad_input')
    if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY) return reply(400, 'bad_input')
    const raw = await request.text()
    if (raw.length > MAX_BODY) return reply(400, 'bad_input')
    body = JSON.parse(raw)
  } catch {
    return reply(400, 'bad_input')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return reply(400, 'bad_input')
  const checked = validateReport(body as Record<string, unknown>)
  if (!checked.ok) return reply(400, 'bad_input')

  const ip = request.headers.get('cf-connecting-ip') ?? ''
  if (await limited(env, `ip:report:${ip || 'unknown'}`)) return reply(429, 'rate_limited')
  if (!(await verifyTurnstile(env.TURNSTILE_SECRET, checked.turnstile, ip, new URL(env.SITE_ORIGIN).hostname))) return reply(403, 'turnstile')
  // The overall limit comes after Turnstile, so junk requests cannot use up the budget for real ones.
  if (await limited(env, 'report:all')) return reply(429, 'rate_limited')

  const sent = await sendTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, messageFor(checked.input))
  return sent ? reply(200) : reply(502, 'not_sent')
}

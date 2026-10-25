// POST /api/report: the "Report a problem" form opens a private GitHub issue. It needs no Circle values.
//
// The issue holds only what the person typed. The server keeps no copy, and adds no IP address or user agent.
// Never log the report text, the email, a token or any response body.
import { type Env } from './index'
import { TURNSTILE_TOKEN, verifyTurnstile } from './turnstile'

export const REPORTS_REPO = 'xanderslabs/fundit-reports'

export const REPORT_CATEGORIES = ['Signing in', 'Adding money', 'Giving', 'Creating or managing a Fundit', 'Withdrawing', 'Something else'] as const
const LABELS: Record<(typeof REPORT_CATEGORIES)[number], string> = {
  'Signing in': 'signing-in',
  'Adding money': 'adding-money',
  Giving: 'giving',
  'Creating or managing a Fundit': 'fundit',
  Withdrawing: 'withdrawing',
  'Something else': 'other',
}

export type ReportInput = { category: (typeof REPORT_CATEGORIES)[number]; page: string; what: string; tx?: string; email?: string }

const MAX_BODY = 8 * 1024
const GITHUB_TIMEOUT_MS = 10_000
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

// A fenced block whose backtick run is longer than any run in the text, so the text cannot close it. Inside a
// code block GitHub does not link a mention, a reference or a URL.
function fenced(value: string): string {
  const longest = Math.max(0, ...(value.match(/`+/g) ?? []).map((r) => r.length))
  const fence = '`'.repeat(Math.max(4, longest + 1))
  return `${fence}\n${value}\n${fence}`
}

export function issueFor(input: ReportInput): { title: string; body: string; labels: string[] } {
  const title = `[${input.category}] ${input.what.slice(0, 60).replace(/\s+/g, ' ')}`
  const parts = [`Category\n${fenced(input.category)}`, `Page\n${fenced(input.page)}`, `What happened\n${fenced(input.what)}`]
  if (input.tx) parts.push(`Transaction\n${fenced(input.tx)}`)
  if (input.email) parts.push(`Email\n${fenced(input.email)}`)
  return { title, body: parts.join('\n\n'), labels: [LABELS[input.category]] }
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
  if (!env.SITE_ORIGIN || !env.TURNSTILE_SECRET || !env.GITHUB_TOKEN) return reply(503, 'unavailable')

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

  try {
    const res = await fetch(`https://api.github.com/repos/${REPORTS_REPO}/issues`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'fundit',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify(issueFor(checked.input)),
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    })
    return res.status === 201 ? reply(200) : reply(502, 'not_sent')
  } catch {
    return reply(502, 'not_sent')
  }
}

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env } from './index'
import { handleReport, issueFor, REPORT_CATEGORIES, validateReport } from './report'

const ORIGIN = 'https://fundit.fun'
const limit = vi.fn(async (_o: { key: string }) => ({ success: true }))
const assets = vi.fn(async (_req: Request) => new Response('static'))

// Only what the report route reads. No Circle values, no network, no factory.
function env(over: Partial<Env> = {}): Env {
  return { ASSETS: { fetch: assets }, UCW_LIMIT: { limit }, TURNSTILE_SECRET: 'ts-secret', GITHUB_TOKEN: 'gh-token', SITE_ORIGIN: ORIGIN, ...over } as Env
}

const GOOD = { category: 'Giving', page: '/c/0x1', what: 'The Give button does nothing.', turnstile: 'tok-1' }

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/report`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

type Hook = { turnstile?: { success: boolean; hostname: string }; github?: { status: number; body: unknown } }
let calls: { url: string; init: RequestInit }[]

function stub({ turnstile = { success: true, hostname: 'fundit.fun' }, github = { status: 201, body: { html_url: 'https://github.com/x' } } }: Hook = {}) {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init })
      if (String(url).includes('challenges.cloudflare.com')) return Response.json(turnstile)
      if (String(url).startsWith('https://api.github.com/')) return new Response(JSON.stringify(github.body), { status: github.status })
      throw new Error(`unexpected fetch ${url}`)
    }),
  )
}
const github = () => calls.filter((c) => c.url.startsWith('https://api.github.com/'))

beforeEach(() => {
  limit.mockClear()
  limit.mockImplementation(async () => ({ success: true }))
  stub()
})
afterEach(() => vi.unstubAllGlobals())

describe('POST /api/report', () => {
  it('rejects a missing or failed Turnstile token', async () => {
    const missing = await handleReport(post({ ...GOOD, turnstile: undefined }), env())
    expect(missing.status).toBe(400)
    stub({ turnstile: { success: false, hostname: 'fundit.fun' } })
    const failed = await handleReport(post(GOOD), env())
    expect(failed.status).toBe(403)
    expect(await failed.json()).toEqual({ error: 'turnstile' })
    expect(github()).toHaveLength(0)
  })

  it('rejects a Turnstile token solved on another hostname', async () => {
    stub({ turnstile: { success: true, hostname: 'evil.example' } })
    const res = await handleReport(post(GOOD), env())
    expect(res.status).toBe(403)
    expect(github()).toHaveLength(0)
  })

  it('rejects a field over its limit and an unknown category', () => {
    const base = { ...GOOD }
    expect(validateReport(base).ok).toBe(true)
    expect(validateReport({ ...base, page: 'x'.repeat(201) }).ok).toBe(false)
    expect(validateReport({ ...base, what: '' }).ok).toBe(false)
    expect(validateReport({ ...base, what: 'x'.repeat(2001) }).ok).toBe(false)
    expect(validateReport({ ...base, what: 'x'.repeat(2000) }).ok).toBe(true)
    expect(validateReport({ ...base, tx: 'x'.repeat(201) }).ok).toBe(false)
    expect(validateReport({ ...base, email: 'not an email' }).ok).toBe(false)
    expect(validateReport({ ...base, email: `${'a'.repeat(250)}@b.co` }).ok).toBe(false)
    expect(validateReport({ ...base, category: 'Other thing' }).ok).toBe(false)
    expect(validateReport({ ...base, category: 5 }).ok).toBe(false)
    expect(REPORT_CATEGORIES).toHaveLength(6)
  })

  it('puts typed text in fenced blocks so it cannot mention or link', () => {
    const issue = issueFor({ category: 'Giving', page: '/c/x', what: 'hi @octocat\n```\nclose https://evil.example', email: 'a@b.co' })
    expect(issue.body).toContain('@octocat')
    const lines = issue.body.split('\n')
    // Every line holding @octocat sits between a fence of 4 or more backticks.
    const fences = lines.map((l, i) => ({ l, i })).filter(({ l }) => /^`{4,}$/.test(l))
    const at = lines.findIndex((l) => l.includes('@octocat'))
    const before = fences.filter((f) => f.i < at).length
    expect(before % 2).toBe(1)
    const fence = [...fences].reverse().find((f) => f.i < at)!.l
    expect(fence.length).toBeGreaterThan(3)
    expect(issue.labels).toEqual(['giving'])
  })

  it('never adds data the person did not type', async () => {
    const res = await handleReport(post({ ...GOOD, tx: '0xabc', email: 'me@example.com', ip: '1.2.3.4' }, { 'user-agent': 'SecretAgent/9' }), env())
    expect(res.status).toBe(200)
    const sent = JSON.parse(String(github()[0]!.init.body)) as { title: string; body: string; labels: string[] }
    expect(sent.body).not.toContain('203.0.113.7')
    expect(sent.body).not.toContain('SecretAgent')
    expect(sent.body).not.toContain('1.2.3.4')
    for (const typed of ['Giving', '/c/0x1', 'The Give button does nothing.', '0xabc', 'me@example.com']) expect(sent.body).toContain(typed)
    expect(sent.title).toBe('[Giving] The Give button does nothing.')
    expect(Object.keys(sent).sort()).toEqual(['body', 'labels', 'title'])
  })

  it('sends the GitHub request with the documented headers', async () => {
    await handleReport(post(GOOD), env())
    const call = github()[0]!
    expect(call.url).toBe('https://api.github.com/repos/xanderslabs/fundit-reports/issues')
    const h = new Headers(call.init.headers)
    expect(h.get('authorization')).toBe('Bearer gh-token')
    expect(h.get('user-agent')).toBe('fundit')
    expect(h.get('x-github-api-version')).toBe('2022-11-28')
  })

  it('refuses a wrong Origin', async () => {
    const res = await handleReport(post(GOOD, { origin: 'https://evil.example' }), env())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'origin' })
    expect(calls).toHaveLength(0)
  })

  it('rate limits per IP and overall', async () => {
    await handleReport(post(GOOD), env())
    expect(limit.mock.calls.map((c) => c[0].key)).toEqual(['ip:report:203.0.113.7', 'report:all'])
    limit.mockImplementation(async ({ key }) => ({ success: key !== 'report:all' }))
    const res = await handleReport(post(GOOD), env())
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited' })
  })

  it('never returns a GitHub or Cloudflare error body', async () => {
    stub({ github: { status: 422, body: { message: 'SECRET-GITHUB-DETAIL' } } })
    const res = await handleReport(post(GOOD), env())
    expect(res.status).toBe(502)
    expect(await res.text()).toBe(JSON.stringify({ error: 'not_sent' }))
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('SECRET-NETWORK') }))
    const down = await handleReport(post(GOOD), env())
    expect(down.status).toBe(403)
    expect(await down.text()).not.toContain('SECRET')
  })

  it('works when Circle is not configured', async () => {
    const res = await worker.fetch(post(GOOD), env())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('answers 503 without GITHUB_TOKEN', async () => {
    const res = await handleReport(post(GOOD), env({ GITHUB_TOKEN: undefined }))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'unavailable' })
    expect(calls).toHaveLength(0)
  })

  it('answers POST only and rejects a non-object or oversized body', async () => {
    expect((await handleReport(new Request(`${ORIGIN}/api/report`), env())).status).toBe(405)
    expect((await handleReport(post('[1]'), env())).status).toBe(400)
    expect((await handleReport(post({ ...GOOD, what: 'x'.repeat(9000) }), env())).status).toBe(400)
  })
})

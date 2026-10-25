// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env } from './index'
import { handleReport, messageFor, REPORT_CATEGORIES, validateReport } from './report'

const ORIGIN = 'https://fundit.fun'
const limit = vi.fn(async (_o: { key: string }) => ({ success: true }))
const assets = vi.fn(async (_req: Request) => new Response('static'))

// Only what the report route reads. No Circle values, no network, no factory.
function env(over: Partial<Env> = {}): Env {
  return { ASSETS: { fetch: assets }, UCW_LIMIT: { limit }, TURNSTILE_SECRET: 'ts-secret', TELEGRAM_BOT_TOKEN: '123:tg-token', TELEGRAM_CHAT_ID: '-100', SITE_ORIGIN: ORIGIN, ...over } as Env
}

const GOOD = { category: 'Giving', page: '/c/0x1', what: 'The Give button does nothing.', turnstile: 'tok-1' }

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/report`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

type Hook = { turnstile?: { success: boolean; hostname: string }; telegram?: { status: number; body: unknown } }
let calls: { url: string; init: RequestInit }[]

function stub({ turnstile = { success: true, hostname: 'fundit.fun' }, telegram = { status: 200, body: { ok: true } } }: Hook = {}) {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init })
      if (String(url).includes('challenges.cloudflare.com')) return Response.json(turnstile)
      if (String(url).startsWith('https://api.telegram.org/')) return new Response(JSON.stringify(telegram.body), { status: telegram.status })
      throw new Error(`unexpected fetch ${url}`)
    }),
  )
}
const telegram = () => calls.filter((c) => c.url.startsWith('https://api.telegram.org/'))

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
    expect(telegram()).toHaveLength(0)
  })

  it('rejects a Turnstile token solved on another hostname', async () => {
    stub({ turnstile: { success: true, hostname: 'evil.example' } })
    const res = await handleReport(post(GOOD), env())
    expect(res.status).toBe(403)
    expect(telegram()).toHaveLength(0)
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

  // Telegram reads formatting only when a parse mode is set, so typed text cannot style or hide part of the message.
  it('sends plain text with no parse mode', async () => {
    await handleReport(post({ ...GOOD, what: '*bold* <b>x</b> [link](https://evil.example)' }), env())
    const sent = JSON.parse(String(telegram()[0]!.init.body)) as Record<string, unknown>
    expect(sent).not.toHaveProperty('parse_mode')
    expect(sent.text).toContain('*bold* <b>x</b> [link](https://evil.example)')
    expect(messageFor({ category: 'Giving', page: '/c/x', what: 'hi' })).toBe('Problem report: Giving\n\nPage: /c/x\n\nWhat happened:\nhi')
  })

  it('never adds data the person did not type', async () => {
    const res = await handleReport(post({ ...GOOD, tx: '0xabc', email: 'me@example.com', ip: '1.2.3.4' }, { 'user-agent': 'SecretAgent/9' }), env())
    expect(res.status).toBe(200)
    const sent = JSON.parse(String(telegram()[0]!.init.body)) as { chat_id: string; text: string }
    expect(sent.text).not.toContain('203.0.113.7')
    expect(sent.text).not.toContain('SecretAgent')
    expect(sent.text).not.toContain('1.2.3.4')
    for (const typed of ['Giving', '/c/0x1', 'The Give button does nothing.', '0xabc', 'me@example.com']) expect(sent.text).toContain(typed)
    expect(sent.chat_id).toBe('-100')
  })

  it('sends to the configured bot and chat', async () => {
    await handleReport(post(GOOD), env())
    expect(telegram().map((c) => c.url)).toEqual(['https://api.telegram.org/bot123:tg-token/sendMessage'])
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

  it('never returns a Telegram or Cloudflare error body', async () => {
    stub({ telegram: { status: 400, body: { ok: false, description: 'SECRET-TELEGRAM-DETAIL' } } })
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

  it('answers 503 without the Telegram bot token or chat id', async () => {
    for (const missing of [{ TELEGRAM_BOT_TOKEN: undefined }, { TELEGRAM_CHAT_ID: undefined }]) {
      const res = await handleReport(post(GOOD), env(missing))
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'unavailable' })
    }
    expect(calls).toHaveLength(0)
  })

  it('answers POST only and rejects a non-object or oversized body', async () => {
    expect((await handleReport(new Request(`${ORIGIN}/api/report`), env())).status).toBe(405)
    expect((await handleReport(post('[1]'), env())).status).toBe(400)
    expect((await handleReport(post({ ...GOOD, what: 'x'.repeat(9000) }), env())).status).toBe(400)
  })
})

// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { sendTelegram } from './telegram'

const TOKEN = '123456:SECRET-token'

describe('sendTelegram', () => {
  // A down or misconfigured Telegram must not break a cron run; the caller decides what a false means.
  it('returns false and never throws when Telegram fails', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await sendTelegram(TOKEN, '42', 'hi', (async () => new Response('{}', { status: 401 })) as typeof fetch)).toBe(false)
    expect(await sendTelegram(TOKEN, '42', 'hi', (async () => new Response('{"ok":false}', { status: 200 })) as typeof fetch)).toBe(false)
    expect(await sendTelegram(TOKEN, '42', 'hi', (async () => { throw new Error(`boom ${TOKEN}`) }) as typeof fetch)).toBe(false)
    for (const spy of [log, err, warn]) expect(JSON.stringify(spy.mock.calls)).not.toContain('SECRET')
    vi.restoreAllMocks()
  })

  it('never puts the token anywhere but the URL', async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const fetcher = (async (url: string, init: RequestInit) => {
      seen = { url, init }
      return new Response('{"ok":true}', { status: 200 })
    }) as unknown as typeof fetch
    expect(await sendTelegram(TOKEN, '42', 'hello', fetcher)).toBe(true)
    expect(seen!.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`)
    expect(seen!.init.method).toBe('POST')
    expect(JSON.parse(seen!.init.body as string)).toEqual({ chat_id: '42', text: 'hello', disable_web_page_preview: true })
    expect(JSON.stringify(seen!.init.headers)).not.toContain('SECRET')
    expect(seen!.init.body as string).not.toContain('SECRET')
  })
})

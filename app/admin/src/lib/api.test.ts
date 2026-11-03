import { afterEach, describe, expect, it, vi } from 'vitest'
import { getHealth, getSession, setModeration } from './api'

// After the 8 h session the Worker answers 401. The owner must land on the login page for the page they were on,
// not on a card that says "Couldn't load this.".
const assign = vi.fn()
function stub(status: number) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(status === 200 ? '{"checks":[]}' : '{}', { status })))
  vi.stubGlobal('location', { pathname: '/health', search: '?network=testnet', assign })
}

afterEach(() => {
  vi.unstubAllGlobals()
  assign.mockReset()
})

describe('getHealth', () => {
  it('reloads the current panel path on 401, which the Worker serves as the login page', async () => {
    stub(401)
    await expect(getHealth('testnet')).rejects.toThrow()
    expect(assign).toHaveBeenCalledWith('/health?network=testnet')
  })

  it('throws without a reload on any other failure', async () => {
    stub(500)
    await expect(getHealth('testnet')).rejects.toThrow('Health check failed (500)')
    expect(assign).not.toHaveBeenCalled()
  })
})

describe('getSession', () => {
  it('reads 401 as signed out and leaves the redirect to its caller', async () => {
    stub(401)
    await expect(getSession()).resolves.toBeNull()
    expect(assign).not.toHaveBeenCalled()
  })
})

describe('setModeration', () => {
  it('posts the network, address, state and note as JSON with the session cookie', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await setModeration('testnet', '0xabc', 'review', 'looks odd')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/admin/moderation')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    expect(JSON.parse(init.body as string)).toEqual({ network: 'testnet', address: '0xabc', state: 'review', note: 'looks odd' })
  })

  it('throws on a non-2xx so the drawer shows the failure instead of a saved state', async () => {
    stub(403)
    await expect(setModeration('testnet', '0xabc', 'removed', '')).rejects.toThrow('(403)')
    expect(assign).not.toHaveBeenCalled()
  })
})

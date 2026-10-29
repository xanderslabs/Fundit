// @vitest-environment node
import { readFileSync } from 'node:fs'
import { encodeFunctionResult, parseAbi, type Address } from 'viem'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NETWORKS_WORKER, type WorkerNetwork } from '../../worker/networks'
import { KNOWN_FACTORIES } from '../../src/deployConfig'
import { ADMIN_CSP } from './headers'
import worker, { PANEL_PATHS, type Env } from './index'
import { clearOwnerCache } from './owner'
import { SESSION_COOKIE, SESSION_TTL_SEC, signSession, type Session } from './session'
import { ADMIN_STATEMENT } from './siwe'
import { sqliteDb } from './testing/sqliteDb'

const ORIGIN = 'https://admin.fundit.fun'
const IP = '203.0.113.7'
const NOW = Date.UTC(2026, 9, 25, 12, 0, 0)
const SCHEMA = ['0001_nonces.sql', '0002_alerts.sql'].map((f) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8')).join('\n')
const SECRET = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256)))
const TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const ownerAbi = parseAbi(['function owner() view returns (address)'])

const owner = privateKeyToAccount(generatePrivateKey())
const stranger = privateKeyToAccount(generatePrivateKey())

// The built admin site: login.html and its files are public, index.html and its own chunks are the panel.
const MANIFEST = {
  'login.html': { file: 'assets/login-a1.js', css: ['assets/login-a1.css'], imports: ['_shared-b2.js'] },
  '_shared-b2.js': { file: 'assets/shared-b2.js' },
  'index.html': { file: 'assets/index-e5.js', css: ['assets/index-e5.css'], imports: ['_shared-b2.js', '_panel-f6.js'] },
  '_panel-f6.js': { file: 'assets/panel-f6.js' },
}
const FILES: Record<string, string> = {
  '/manifest.json': JSON.stringify(MANIFEST),
  '/login.html': 'LOGIN PAGE',
  '/assets/login-a1.js': 'login js',
  '/assets/login-a1.css': 'login css',
  '/assets/shared-b2.js': 'shared js',
  '/index.html': 'PANEL PAGE',
  '/assets/index-e5.js': 'PANEL JS',
  '/assets/index-e5.css': 'PANEL CSS',
  '/assets/panel-f6.js': 'PANEL CHUNK',
  '/fonts/Outfit-VariableFont_wght.ttf': 'font bytes',
  '/fonts/OFL.txt': 'font licence',
  '/favicon.svg': 'svg icon',
  '/favicon.ico': 'ico icon',
  '/apple-touch-icon.png': 'touch icon',
}
const PANEL_TEXT = /PANEL|"index\.html"/

// A lenient stand-in for Cloudflare's asset server: it decodes the path and ignores a trailing slash, so the
// Worker alone has to keep panel files back.
const assetPaths: string[] = []
const assets = vi.fn(async (req: Request) => {
  const raw = new URL(req.url).pathname
  assetPaths.push(raw)
  let path = raw
  try {
    path = decodeURIComponent(raw)
  } catch {
    // Kept raw.
  }
  path = path.replace(/\/+$/, '') || '/'
  const body = FILES[path]
  return body === undefined ? new Response('not found', { status: 404 }) : new Response(body, { headers: { 'cache-control': 'public, max-age=3600' } })
})
const limit = vi.fn(async (_o: { key: string }) => ({ success: true }))

function env(over: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: assets },
    ADMIN_DB: sqliteDb(SCHEMA),
    ADMIN_LIMIT: { limit },
    ADMIN_ORIGIN: ORIGIN,
    ADMIN_SESSION_SECRET: SECRET,
    TURNSTILE_SECRET: 'turnstile-secret',
    ...over,
  }
}

function post(route: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/admin/${route}`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': IP, ...headers },
    body: JSON.stringify(body),
  })
}

function get(path: string, cookie?: string): Request {
  return new Request(`${ORIGIN}${path}`, { headers: { 'cf-connecting-ip': IP, ...(cookie && { cookie }) } })
}

type Call = { url: string; init: RequestInit }
let calls: Call[]
// owner() per network. A network in rpcDown has its eth_call fail, as if its RPC were unreachable.
let owners: Record<WorkerNetwork, Address>
let rpcDown: Set<WorkerNetwork>
let rpcReply: (() => Response) | null
const setOwner = (a: Address) => (owners = { testnet: a, mainnet: a })

const rpcCalls = () => calls.filter((c) => c.url.startsWith('https://rpc.'))
const rows = async (e: Env) => (await e.ADMIN_DB.prepare('SELECT COUNT(*) AS n FROM nonces').first<{ n: number }>())?.n

beforeEach(() => {
  calls = []
  assetPaths.length = 0
  assets.mockClear()
  limit.mockReset()
  limit.mockImplementation(async () => ({ success: true }))
  clearOwnerCache()
  setOwner(owner.address)
  rpcDown = new Set()
  rpcReply = null
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  const replies: Record<string, () => Response> = {
    [TURNSTILE]: () => Response.json({ success: true, hostname: 'admin.fundit.fun' }),
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      calls.push({ url, init })
      if (url === NETWORKS_WORKER.testnet.rpcUrl || url === NETWORKS_WORKER.mainnet.rpcUrl) {
        if (rpcReply) return rpcReply()
        const net: WorkerNetwork = url === NETWORKS_WORKER.testnet.rpcUrl ? 'testnet' : 'mainnet'
        if (rpcDown.has(net)) throw new TypeError('fetch failed')
        const req = JSON.parse(String(init.body)) as { method: string; params: [{ to: string; data: string }, string] }
        const factory = KNOWN_FACTORIES[net].address
        if (req.method !== 'eth_call' || req.params[0].to.toLowerCase() !== factory.toLowerCase() || req.params[0].data !== '0x8da5cb5b') {
          return Response.json({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'unexpected call' } })
        }
        return Response.json({ jsonrpc: '2.0', id: 1, result: encodeFunctionResult({ abi: ownerAbi, functionName: 'owner', result: owners[net] }) })
      }
      const reply = replies[url]
      if (!reply) throw new Error(`unexpected fetch ${url}`)
      return reply()
    }),
  )
  turnstileReply = (r) => (replies[TURNSTILE] = r)
})

let turnstileReply: (r: () => Response) => void

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function nonce(e: Env): Promise<{ nonce: string; issuedAt: string; expirationTime: string }> {
  const res = await worker.fetch(post('nonce', { turnstile: 'good-token' }), e)
  expect(res.status).toBe(200)
  return res.json()
}

function siwe(account: PrivateKeyAccount, n: { nonce: string; issuedAt: string; expirationTime: string }, over: Record<string, unknown> = {}): string {
  return createSiweMessage({
    address: account.address,
    domain: 'admin.fundit.fun',
    uri: ORIGIN,
    version: '1',
    statement: ADMIN_STATEMENT,
    chainId: 5042002,
    nonce: n.nonce,
    issuedAt: new Date(n.issuedAt),
    expirationTime: new Date(n.expirationTime),
    ...over,
  })
}

async function signedLogin(e: Env, signer: PrivateKeyAccount = owner, over: Record<string, unknown> = {}) {
  const message = siwe(signer, await nonce(e), over)
  const signature = await signer.signMessage({ message })
  return { body: { message, signature }, res: await worker.fetch(post('login', { message, signature }), e) }
}

// The Cookie header a browser would send back.
function cookieOf(res: Response): string {
  const set = res.headers.get('set-cookie') ?? ''
  return set.split(';')[0] ?? ''
}

async function signIn(e: Env): Promise<string> {
  const { res } = await signedLogin(e)
  expect(res.status).toBe(200)
  return cookieOf(res)
}

describe('nonce', () => {
  it('nonce refuses a missing Turnstile token', async () => {
    const e = env()
    const res = await worker.fetch(post('nonce', {}), e)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad_input' })
    expect(await rows(e)).toBe(0)
  })

  // A token from the public site's widget must not count here.
  it('nonce refuses a failed Turnstile or one solved on fundit.fun', async () => {
    const e = env()
    turnstileReply(() => Response.json({ success: false }))
    const failed = await worker.fetch(post('nonce', { turnstile: 'bad-token' }), e)
    expect(failed.status).toBe(403)
    expect(await failed.json()).toEqual({ error: 'turnstile' })

    turnstileReply(() => Response.json({ success: true, hostname: 'fundit.fun' }))
    const foreign = await worker.fetch(post('nonce', { turnstile: 'public-site' }), e)
    expect(foreign.status).toBe(403)
    expect(await rows(e)).toBe(0)

    const form = new URLSearchParams(String(calls.find((c) => c.url === TURNSTILE)?.init.body))
    expect(form.get('secret')).toBe('turnstile-secret')
    expect(form.get('remoteip')).toBe(IP)
  })

  it('issues a nonce that lives 10 minutes', async () => {
    const e = env()
    const n = await nonce(e)
    expect(n.issuedAt).toBe(new Date(NOW).toISOString())
    expect(n.expirationTime).toBe(new Date(NOW + 600_000).toISOString())
    expect(await rows(e)).toBe(1)
  })
})

describe('login', () => {
  // The public mainnet RPC answers Cloudflare with 429, which greyed out Arc Mainnet in the network switch.
  it('reads owner() through the provider RPC secrets when they are set', async () => {
    const provider: Record<string, string> = {
      'https://main.example.org/KEY': NETWORKS_WORKER.mainnet.rpcUrl,
      'https://test.example.org/KEY': NETWORKS_WORKER.testnet.rpcUrl,
    }
    const inner = globalThis.fetch
    const seen: string[] = []
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(String(input))
      return inner(provider[String(input)] ?? input, init)
    })
    const e = env({ ARC_MAINNET_RPC_URL: 'https://main.example.org/KEY', ARC_TESTNET_RPC_URL: 'https://test.example.org/KEY' })
    const { res } = await signedLogin(e)
    expect(res.status).toBe(200)
    expect(seen.filter((u) => u in provider).sort()).toEqual(['https://main.example.org/KEY', 'https://test.example.org/KEY'])
    expect(seen).not.toContain(NETWORKS_WORKER.mainnet.rpcUrl)
  })

  it('login with the owner sets the session cookie', async () => {
    const e = env()
    const { res } = await signedLogin(e)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ address: owner.address })
    const set = res.headers.get('set-cookie') ?? ''
    expect(set).toMatch(/^__Host-fundit_admin=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; /)
    // owner() was read fresh at login, once per network.
    expect(rpcCalls().map((c) => c.url).sort()).toEqual([NETWORKS_WORKER.mainnet.rpcUrl, NETWORKS_WORKER.testnet.rpcUrl])

    const session = await worker.fetch(get('/api/admin/session', cookieOf(res)), e)
    expect(session.status).toBe(200)
    expect(await session.json()).toEqual({
      address: owner.address,
      networks: {
        mainnet: { chainId: 5042, factory: KNOWN_FACTORIES.mainnet.address, owner: true },
        testnet: { chainId: 5042002, factory: KNOWN_FACTORIES.testnet.address, owner: true },
      },
    })
  })

  // The owner may hold only one network's factory: sign-in works, and the panel learns which one.
  it('signs in an address that owns only the testnet factory, and reports mainnet owner false', async () => {
    const e = env()
    owners = { testnet: owner.address, mainnet: stranger.address }
    const { res } = await signedLogin(e, owner, { chainId: 5042002 })
    expect(res.status).toBe(200)
    const session = await worker.fetch(get('/api/admin/session', cookieOf(res)), e)
    expect(session.status).toBe(200)
    const body = (await session.json()) as { networks: Record<WorkerNetwork, { owner: boolean | null }> }
    expect(body.networks.testnet.owner).toBe(true)
    expect(body.networks.mainnet.owner).toBe(false)
  })

  it('accepts a SIWE message for either Arc chain and refuses chain 1', async () => {
    for (const chainId of [5042, 5042002]) {
      const { res } = await signedLogin(env(), owner, { chainId })
      expect(res.status, String(chainId)).toBe(200)
    }
    const { res } = await signedLogin(env(), owner, { chainId: 1 })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'wrong_chain' })
  })

  it('refuses login when the address owns neither factory', async () => {
    owners = { testnet: stranger.address, mainnet: stranger.address }
    const { res } = await signedLogin(env())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'not_owner' })
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  // One network's RPC being down must not lock the owner out of the network that answers.
  it('keeps the session when one network RPC fails and the other confirms the owner', async () => {
    const e = env()
    rpcDown = new Set(['mainnet'])
    const { res } = await signedLogin(e)
    expect(res.status).toBe(200)
    const session = await worker.fetch(get('/api/admin/session', cookieOf(res)), e)
    expect(session.status).toBe(200)
    const body = (await session.json()) as { networks: Record<WorkerNetwork, { owner: boolean | null }> }
    expect(body.networks.mainnet.owner).toBeNull()
    expect(body.networks.testnet.owner).toBe(true)
    expect(await (await worker.fetch(get('/', cookieOf(res)), e)).text()).toBe('PANEL PAGE')
  })

  // A failed read is never taken as "not the owner" or as "the owner".
  it('answers 503 when no network confirms and at least one read failed', async () => {
    owners = { testnet: stranger.address, mainnet: owner.address }
    rpcDown = new Set(['mainnet'])
    const e = env()
    const { res } = await signedLogin(e)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'unavailable' })
    expect(res.headers.get('set-cookie')).toBeNull()

    // Signed in while both answered, then one goes down and the other no longer confirms.
    rpcDown = new Set()
    setOwner(owner.address)
    const cookie = await signIn(e)
    clearOwnerCache()
    owners = { testnet: stranger.address, mainnet: owner.address }
    rpcDown = new Set(['mainnet'])
    const session = await worker.fetch(get('/api/admin/session', cookie), e)
    expect(session.status).toBe(503)
    expect(await session.json()).toEqual({ error: 'unavailable' })
    expect(session.headers.get('set-cookie')).toBeNull()
  })

  // Only CampaignFactory.owner() gets in, whoever else can sign a valid message.
  it('login refuses a signature from a wallet that is not owner()', async () => {
    const { res } = await signedLogin(env(), stranger)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'not_owner' })
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  // Someone who knows the owner's address cannot sign in as the owner with their own key.
  it('login refuses a signature that does not match the message address', async () => {
    const e = env()
    const message = siwe(owner, await nonce(e))
    const signature = await stranger.signMessage({ message })
    const res = await worker.fetch(post('login', { message, signature }), e)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'bad_signature' })
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(rpcCalls()).toHaveLength(0)
  })

  it('login refuses a replayed nonce', async () => {
    const e = env()
    const { body, res } = await signedLogin(e)
    expect(res.status).toBe(200)
    const again = await worker.fetch(post('login', body), e)
    expect(again.status).toBe(403)
    expect(await again.json()).toEqual({ error: 'nonce' })
    expect(again.headers.get('set-cookie')).toBeNull()
  })

  it('login refuses a nonce the server never issued', async () => {
    const e = env()
    const message = siwe(owner, { nonce: 'neverissued0123456789', issuedAt: new Date(NOW).toISOString(), expirationTime: new Date(NOW + 300_000).toISOString() })
    const res = await worker.fetch(post('login', { message, signature: await owner.signMessage({ message }) }), e)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'nonce' })
  })

  it('login refuses an expired message', async () => {
    const e = env()
    const { res } = await signedLogin(e, owner, { issuedAt: new Date(NOW - 9 * 60_000), expirationTime: new Date(NOW - 1_000) })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'expired' })
  })

  it('login refuses another domain', async () => {
    const { res } = await signedLogin(env(), owner, { domain: 'fundit.fun' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'wrong_domain' })
  })

  it('login refuses a body that is not JSON or too large', async () => {
    const e = env()
    const text = await worker.fetch(new Request(`${ORIGIN}/api/admin/login`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'text/plain' }, body: '{}' }), e)
    expect(text.status).toBe(400)
    const big = await worker.fetch(post('login', { message: 'x'.repeat(5000), signature: '0x00' }), e)
    expect(big.status).toBe(400)
    const missing = await worker.fetch(post('login', { message: 'hello' }), e)
    expect(missing.status).toBe(400)
  })

  // Another site cannot make the owner's browser start or finish a sign-in.
  it('nonce and login refuse a wrong Origin', async () => {
    const e = env()
    const n = await worker.fetch(post('nonce', { turnstile: 'good' }, { origin: 'https://fundit.fun' }), e)
    expect(n.status).toBe(403)
    expect(await n.json()).toEqual({ error: 'origin' })
    const noOrigin = new Request(`${ORIGIN}/api/admin/nonce`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"turnstile":"good"}' })
    expect((await worker.fetch(noOrigin, e)).status).toBe(403)
    const l = await worker.fetch(post('login', { message: 'm', signature: '0x00' }, { origin: 'https://evil.example' }), e)
    expect(l.status).toBe(403)
    expect(await l.json()).toEqual({ error: 'origin' })
    expect(await rows(e)).toBe(0)
    expect(calls).toEqual([])
  })

  it('rate limits nonce and login per IP', async () => {
    const e = env()
    limit.mockImplementation(async () => ({ success: false }))
    const n = await worker.fetch(post('nonce', { turnstile: 'good' }), e)
    expect(n.status).toBe(429)
    expect(await n.json()).toEqual({ error: 'rate_limited' })
    const l = await worker.fetch(post('login', { message: 'm', signature: '0x00' }), e)
    expect(l.status).toBe(429)
    expect(limit.mock.calls.map(([o]) => o.key)).toEqual([`ip:nonce:${IP}`, `ip:login:${IP}`])
    // Refused before Turnstile or the RPC.
    expect(calls).toEqual([])
  })
})

describe('session', () => {
  it('session refuses a tampered cookie', async () => {
    const e = env()
    const cookie = await signIn(e)
    const tampered = cookie.replace(/\.(.)/, (_m, c: string) => `.${c === 'A' ? 'B' : 'A'}`)
    expect(tampered).not.toBe(cookie)
    const res = await worker.fetch(get('/api/admin/session', tampered), e)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'signed_out' })
    expect(res.headers.get('set-cookie')).toMatch(/^__Host-fundit_admin=; .*Max-Age=0/)
    expect(await (await worker.fetch(get('/', tampered), e)).text()).toBe('LOGIN PAGE')
  })

  // Ownership moved away from the signed-in wallet: its session stops within OWNER_CACHE_MS.
  it('session ends when owner() changes after login', async () => {
    const e = env()
    const cookie = await signIn(e)
    expect((await worker.fetch(get('/api/admin/session', cookie), e)).status).toBe(200)
    const before = rpcCalls().length
    setOwner(stranger.address)

    vi.setSystemTime(NOW + 30_000)
    expect((await worker.fetch(get('/api/admin/session', cookie), e)).status).toBe(200)
    expect(rpcCalls()).toHaveLength(before)

    vi.setSystemTime(NOW + 61_000)
    const res = await worker.fetch(get('/api/admin/session', cookie), e)
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(await (await worker.fetch(get('/', cookie), e)).text()).toBe('LOGIN PAGE')
    expect((await worker.fetch(get('/assets/panel-f6.js', cookie), e)).status).toBe(404)
  })

  // A Plan 8 cookie still in the browser after the deploy: signed out, never an error page.
  it('treats a v1 cookie as signed out', async () => {
    const e = env()
    const iat = Math.floor(NOW / 1000)
    const v1 = { v: 1, address: owner.address.toLowerCase(), chainId: 5042002, factory: KNOWN_FACTORIES.testnet.address.toLowerCase(), iat, exp: iat + SESSION_TTL_SEC }
    const cookie = `${SESSION_COOKIE}=${await signSession(v1 as unknown as Session, SECRET)}`
    const res = await worker.fetch(get('/api/admin/session', cookie), e)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'signed_out' })
    const page = await worker.fetch(get('/', cookie), e)
    expect(page.status).toBe(200)
    expect(await page.text()).toBe('LOGIN PAGE')
  })

  // An RPC error or junk answer is never read as "this wallet is the owner".
  it('fails closed when owner() cannot be read', async () => {
    const answers: (() => Response)[] = [
      () => new Response('boom', { status: 500 }),
      () => Response.json({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'execution reverted' } }),
      () => Response.json({ jsonrpc: '2.0', id: 1 }),
      () => Response.json({ jsonrpc: '2.0', id: 1, result: '0x' }),
      () => Response.json({ jsonrpc: '2.0', id: 1, result: `0x${'0'.repeat(64)}` }),
      () => Response.json({ jsonrpc: '2.0', id: 1, result: `0x${'f'.repeat(24)}${owner.address.slice(2)}` }),
      () => Response.json({ jsonrpc: '2.0', id: 1, result: owner.address }),
      () => Response.json({ jsonrpc: '2.0', id: 1, result: `0x${'0'.repeat(24)}${owner.address.slice(2)}00` }),
      () => new Response('not json'),
    ]
    for (const answer of answers) {
      const e = env()
      rpcReply = answer
      const { res } = await signedLogin(e)
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'unavailable' })
      expect(res.headers.get('set-cookie')).toBeNull()
    }

    rpcReply = null
    const e = env()
    const cookie = await signIn(e)
    clearOwnerCache()
    rpcReply = () => new Response('boom', { status: 500 })
    const session = await worker.fetch(get('/api/admin/session', cookie), e)
    expect(session.status).toBe(503)
    for (const path of ['/', '/index.html', '/assets/index-e5.js', '/assets/panel-f6.js']) {
      const res = await worker.fetch(get(path, cookie), e)
      expect(await res.text()).not.toMatch(PANEL_TEXT)
    }
  })

  it('fails closed without ADMIN_SESSION_SECRET, with a short one, or without the origin or Turnstile secret', async () => {
    const cookie = await signIn(env())
    const bad: Partial<Env>[] = [
      { ADMIN_SESSION_SECRET: undefined as unknown as string },
      { ADMIN_SESSION_SECRET: btoa('x'.repeat(31)) },
      { ADMIN_ORIGIN: undefined as unknown as string },
      { TURNSTILE_SECRET: undefined as unknown as string },
    ]
    for (const over of bad) {
      const e = env(over)
      calls = []
      const responses = [
        await worker.fetch(post('nonce', { turnstile: 'good' }), e),
        await worker.fetch(post('login', { message: 'm', signature: '0x00' }), e),
        await worker.fetch(post('logout', {}), e),
        await worker.fetch(get('/api/admin/session', cookie), e),
        await worker.fetch(get('/api/admin/other', cookie), e),
      ]
      for (const res of responses) {
        expect(res.status).toBe(503)
        expect(await res.json()).toEqual({ error: 'unavailable' })
      }
      expect(calls).toEqual([])
      for (const path of ['/', '/index.html', '/assets/panel-f6.js']) {
        expect(await (await worker.fetch(get(path, cookie), e)).text()).not.toMatch(PANEL_TEXT)
      }
    }
  })
})

describe('files', () => {
  it('serves the login page and its files without a session', async () => {
    const e = env()
    expect(await (await worker.fetch(get('/'), e)).text()).toBe('LOGIN PAGE')
    expect(await (await worker.fetch(get('/login.html'), e)).text()).toBe('LOGIN PAGE')
    for (const path of ['/assets/login-a1.js', '/assets/login-a1.css', '/assets/shared-b2.js']) {
      const res = await worker.fetch(get(path), e)
      expect(res.status).toBe(200)
      expect(await res.text()).toBe(FILES[path])
    }
  })

  // The login page's stylesheet loads the font from the public dir, which is not in the manifest. Only that one
  // exact path is added; other files beside it and spellings of it stay behind the session.
  it('serves the login font without a session, and nothing else from /fonts', async () => {
    const e = env()
    const res = await worker.fetch(get('/fonts/Outfit-VariableFont_wght.ttf'), e)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('font bytes')
    for (const path of ['/fonts/OFL.txt', '/fonts/Outfit-VariableFont_wght.ttf/', '/fonts/%4Futfit-VariableFont_wght.ttf', '/fonts/', '/fonts']) {
      expect((await worker.fetch(get(path), e)).status, path).toBe(404)
    }
    for (const path of ['/index.html', '/assets/index-e5.js', '/assets/panel-f6.js']) {
      expect((await worker.fetch(get(path), e)).status, path).toBe(404)
    }
  })

  // The browser asks for the tab icon on the login page too, before anyone signs in.
  it('serves the tab icons without a session', async () => {
    const e = env()
    for (const [path, body] of [['/favicon.svg', 'svg icon'], ['/favicon.ico', 'ico icon'], ['/apple-touch-icon.png', 'touch icon']] as const) {
      const res = await worker.fetch(get(path), e)
      expect(res.status, path).toBe(200)
      expect(await res.text()).toBe(body)
    }
  })

  it('path variants of panel files get 404 without a session', async () => {
    const e = env()
    const variants = [
      '/index.html',
      '/index',
      '/index.html/',
      '//index.html',
      '/assets/index-e5.js',
      '/assets/index-e5.css',
      '/assets/panel-f6.js',
      '/assets/panel-f6.js/',
      '/assets/%70anel-f6.js',
      '/manifest.json',
      '/manifest.json/',
      '/.vite/manifest.json',
      '/assets/../index.html',
      '/%2e%2e/index.html',
      '/assets/%2e%2e/index.html',
      '/assets/..%2findex.html',
      '/%2findex.html',
      '/login.html/../index.html',
      '/login.html/',
      '/assets/login-a1.js/',
      '/api/other',
    ]
    for (const path of variants) {
      const res = await worker.fetch(get(path), e)
      expect(res.status, path).toBe(404)
      expect(await res.text(), path).not.toMatch(PANEL_TEXT)
    }
    // A bad cookie is the same as none.
    const res = await worker.fetch(get('/index.html', '__Host-fundit_admin=abc.def'), e)
    expect(res.status).toBe(404)
    // The asset server was only ever asked for the manifest, never a panel file.
    expect(assetPaths.filter((p) => p !== '/manifest.json')).toEqual([])
  })

  it('never serves manifest.json, even with a session', async () => {
    const e = env()
    const cookie = await signIn(e)
    for (const path of ['/manifest.json', '/manifest.json/', '/Manifest.JSON', '/%6Danifest.json', '/assets/../manifest.json', '/.vite/manifest.json']) {
      const res = await worker.fetch(get(path, cookie), e)
      expect(res.status, path).toBe(404)
      expect(await res.text(), path).not.toContain('login.html')
    }
  })

  it('serves the panel at / with a session', async () => {
    const e = env()
    const cookie = await signIn(e)
    expect(await (await worker.fetch(get('/', cookie), e)).text()).toBe('PANEL PAGE')
    expect(await (await worker.fetch(get('/assets/panel-f6.js', cookie), e)).text()).toBe('PANEL CHUNK')
    expect(await (await worker.fetch(get('/assets/login-a1.js', cookie), e)).text()).toBe('login js')
  })

  // The panel routes its pages in the browser, so a reload on any of them must get the panel.
  it('serves the panel for each panel path with a session', async () => {
    const e = env()
    const cookie = await signIn(e)
    for (const path of [...PANEL_PATHS, '/fundits/', '/gifts?network=testnet']) {
      assetPaths.length = 0
      const res = await worker.fetch(get(path, cookie), e)
      expect(res.status, path).toBe(200)
      expect(assetPaths, path).toEqual(['/index.html'])
      expect(await res.text(), path).toBe('PANEL PAGE')
    }
  })

  // Signed out, a panel URL shows the login page (so a bookmark works) but never the panel, and nothing below it.
  it('serves the login page for panel paths without a session', async () => {
    const e = env()
    const res = await worker.fetch(get('/settings'), e)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('LOGIN PAGE')
    expect(assetPaths.filter((p) => p !== '/manifest.json')).toEqual(['/login.html'])
    for (const path of ['/settings/x', '/index.html', '//', '/settings//']) {
      const r = await worker.fetch(get(path), e)
      expect(r.status, path).toBe(404)
      expect(await r.text(), path).not.toMatch(PANEL_TEXT)
    }
  })

  it('logout clears the cookie', async () => {
    const e = env()
    const cookie = await signIn(e)
    const res = await worker.fetch(post('logout', {}, { cookie }), e)
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toMatch(/^__Host-fundit_admin=; .*Max-Age=0/)
  })

  it('every response carries noindex, no-store and the CSP', async () => {
    const e = env()
    const cookie = await signIn(e)
    const responses = [
      await worker.fetch(post('nonce', { turnstile: 'good' }), e),
      await worker.fetch(post('nonce', {}), e),
      await worker.fetch(post('login', { message: 'm', signature: '0x00' }), e),
      await worker.fetch(get('/api/admin/session', cookie), e),
      await worker.fetch(get('/api/admin/session'), e),
      await worker.fetch(get('/api/admin/nope'), e),
      await worker.fetch(get('/'), e),
      await worker.fetch(get('/', cookie), e),
      await worker.fetch(get('/assets/login-a1.js'), e),
      await worker.fetch(get('/index.html'), e),
      await worker.fetch(get('/manifest.json', cookie), e),
      await worker.fetch(post('nonce', {}), env({ ADMIN_SESSION_SECRET: '' })),
      await worker.fetch(get('/'), env({ ADMIN_ORIGIN: 'http://admin.fundit.fun' })),
      await worker.fetch(get('/api/admin/health?network=testnet', cookie), e),
      await worker.fetch(get('/settings'), e),
    ]
    for (const res of responses) {
      expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow')
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('referrer-policy')).toBe('no-referrer')
      expect(res.headers.get('content-security-policy')).toBe(ADMIN_CSP)
      expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains')
    }
  })
})

describe('health', () => {
  const seed = async (e: Env) => {
    const insert = 'INSERT INTO alert_state (key, failing, fail_count, since, last_sent) VALUES (?, ?, ?, ?, ?)'
    await e.ADMIN_DB.prepare(insert).bind('site', 0, 0, 0, 0).run()
    await e.ADMIN_DB.prepare(insert).bind('ucw', 1, 3, NOW - 900_000, NOW - 600_000).run()
    await e.ADMIN_DB.prepare(insert).bind('rpc:arc-testnet', 0, 0, 0, 0).run()
    await e.ADMIN_DB.prepare(insert).bind('rpc:arc-mainnet', 1, 2, NOW - 300_000, 0).run()
    await e.ADMIN_DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').bind('owner_events_next:testnet', '100').run()
    await e.ADMIN_DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').bind('rpc_head:testnet', '1234').run()
  }

  it('returns health rows for the asked network only', async () => {
    const e = env({ TELEGRAM_BOT_TOKEN: 'TELEGRAM-TOKEN-123', TELEGRAM_CHAT_ID: '987654321' })
    await seed(e)
    const cookie = await signIn(e)

    const testnet = await worker.fetch(get('/api/admin/health?network=testnet', cookie), e)
    expect(testnet.status).toBe(200)
    const text = await testnet.text()
    expect(text).not.toContain('TELEGRAM')
    expect(text).not.toContain('987654321')
    const body = JSON.parse(text) as { checks: { key: string }[]; alertsStarted: boolean; lastEventBlock: string | null; rpcHead: string | null }
    expect(body.checks.map((c) => c.key).sort()).toEqual(['rpc:arc-testnet', 'site', 'ucw'])
    expect(body.checks.find((c) => c.key === 'ucw')).toEqual({ key: 'ucw', ok: false, failCount: 3, since: NOW - 900_000, lastSent: NOW - 600_000 })
    expect(body.checks.find((c) => c.key === 'site')).toEqual({ key: 'site', ok: true, failCount: 0, since: 0, lastSent: 0 })
    expect(body.alertsStarted).toBe(true)
    expect(body.lastEventBlock).toBe('100')
    expect(body.rpcHead).toBe('1234')

    const mainnet = await worker.fetch(get('/api/admin/health?network=mainnet', cookie), e)
    expect(mainnet.status).toBe(200)
    const m = (await mainnet.json()) as { checks: { key: string }[]; alertsStarted: boolean; lastEventBlock: string | null; rpcHead: string | null }
    expect(m.checks.map((c) => c.key).sort()).toEqual(['rpc:arc-mainnet', 'site', 'ucw'])
    expect(m.alertsStarted).toBe(false)
    expect(m.lastEventBlock).toBeNull()
    expect(m.rpcHead).toBeNull()

    for (const bad of ['?network=x', '', '?network=', '?network=Testnet']) {
      const res = await worker.fetch(get(`/api/admin/health${bad}`, cookie), e)
      expect(res.status, bad).toBe(400)
      expect(await res.json()).toEqual({ error: 'bad_input' })
    }

    const out = await worker.fetch(get('/api/admin/health?network=testnet'), e)
    expect(out.status).toBe(401)
    expect(await out.json()).toEqual({ error: 'signed_out' })
  })

  it('health refuses a method other than GET', async () => {
    const e = env()
    const cookie = await signIn(e)
    const res = await worker.fetch(post('health?network=testnet', {}, { cookie }), e)
    expect(res.status).toBe(405)
  })
})

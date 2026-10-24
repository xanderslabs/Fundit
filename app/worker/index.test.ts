// @vitest-environment node
import { encodeFunctionResult, parseAbi } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env } from './index'
import { NETWORKS_WORKER } from './networks'

const ORIGIN = 'https://fundit.fun'
const FACTORY = '0x6890D40a9A472D0d05aDb5938D85B07059ad54ab'
const CAMPAIGN = '0x00000000000000000000000000000000000000Ca'
const OTHER = '0x00000000000000000000000000000000000000Bb'
const COOKIE_UT = 'cookie-user-token-0123456789abcdef'
const COOKIE_RT = 'cookie-refresh-token-0123456789abcdef'
const BODY_UT = 'body-user-token-0123456789abcdef'
const WALLET_ID = '0a1b2c3d-1111-4222-8333-444455556666'
const net = NETWORKS_WORKER.testnet

const assets = vi.fn(async (_req: Request) => new Response('static'))
const limit = vi.fn(async (_o: { key: string }) => ({ success: true }))

function env(over: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: assets },
    UCW_LIMIT: { limit },
    CIRCLE_API_KEY: 'TEST_API_KEY:abc:def',
    TURNSTILE_SECRET: 'turnstile-secret',
    NETWORK: 'testnet',
    FACTORY_ADDRESS: FACTORY,
    SITE_ORIGIN: ORIGIN,
    ...over,
  }
}

function post(route: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/ucw/${route}`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...headers },
    body: JSON.stringify(body),
  })
}

const cookie = { cookie: `ucw_ut=${COOKIE_UT}; ucw_rt=${COOKIE_RT}` }

type Call = { url: string; init: RequestInit }
let calls: Call[]
// Upstream replies by URL. Tests replace entries.
let replies: Record<string, () => Response>

function circleCalls(): Call[] {
  return calls.filter((c) => c.url.startsWith('https://api.circle.com/'))
}

function header(c: Call, name: string): string | null {
  return new Headers(c.init.headers).get(name)
}

const factoryAbi = parseAbi(['function isCampaign(address) view returns (bool)'])

beforeEach(() => {
  calls = []
  assets.mockClear()
  limit.mockClear()
  replies = {
    'https://challenges.cloudflare.com/turnstile/v0/siteverify': () => Response.json({ success: true, hostname: 'fundit.fun' }),
    'https://api.circle.com/v1/w3s/users/email/token': () =>
      Response.json({ data: { deviceToken: 'dt', deviceEncryptionKey: 'dek', otpToken: 'ot' } }, { status: 201 }),
    'https://api.circle.com/v1/w3s/wallets?blockchain=EVM-TESTNET': () => Response.json({ data: { wallets: [] } }),
    'https://api.circle.com/v1/w3s/user/sign/transaction': () => Response.json({ data: { challengeId: 'ch-1' } }, { status: 201 }),
    [net.rpcUrl]: () => Response.json({ jsonrpc: '2.0', id: 1, result: encodeFunctionResult({ abi: factoryAbi, functionName: 'isCampaign', result: false }) }),
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      calls.push({ url, init })
      const reply = replies[url]
      if (!reply) throw new Error(`unexpected fetch ${url}`)
      return reply()
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function signTx(to: string): string {
  return JSON.stringify({ chainId: net.chainId, nonce: '1', to, value: '0', data: '0x', gas: '60000', maxFeePerGas: '41000000000', maxPriorityFeePerGas: '1000000000' })
}

describe('worker', () => {
  // Without Turnstile anyone could make Fundit's key send login codes to any address.
  it('email-token refuses without a valid Turnstile token and never calls Circle', async () => {
    const missing = await worker.fetch(post('email-token', { deviceId: 'device-12345', email: 'a@example.com' }), env())
    expect(missing.status).toBe(400)

    replies['https://challenges.cloudflare.com/turnstile/v0/siteverify'] = () => Response.json({ success: false, 'error-codes': ['invalid-input-response'] })
    const failed = await worker.fetch(post('email-token', { deviceId: 'device-12345', email: 'a@example.com', turnstile: 'bad-token' }), env())
    expect(failed.status).toBe(403)

    // A token solved on another site's widget does not count either.
    replies['https://challenges.cloudflare.com/turnstile/v0/siteverify'] = () => Response.json({ success: true, hostname: 'evil.example' })
    const foreign = await worker.fetch(post('email-token', { deviceId: 'device-12345', email: 'a@example.com', turnstile: 'other-site' }), env())
    expect(foreign.status).toBe(403)

    expect(circleCalls()).toEqual([])
    // The secret and the visitor's IP went to Cloudflare's check, not anywhere else.
    const verify = calls.find((c) => c.url.includes('siteverify'))
    const form = new URLSearchParams(String(verify?.init.body))
    expect(form.get('secret')).toBe('turnstile-secret')
    expect(form.get('response')).toBe('bad-token')
    expect(form.get('remoteip')).toBe('203.0.113.7')
  })

  it('email-token with a valid Turnstile token returns only the three login values', async () => {
    const res = await worker.fetch(post('email-token', { deviceId: 'device-12345', email: 'a@example.com', turnstile: 'good' }), env())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deviceToken: 'dt', deviceEncryptionKey: 'dek', otpToken: 'ot' })
    const [c] = circleCalls()
    expect(header(c!, 'authorization')).toBe('Bearer TEST_API_KEY:abc:def')
    expect(JSON.parse(String(c!.init.body))).toMatchObject({ deviceId: 'device-12345', email: 'a@example.com' })
    // Rate limited per IP and per email address.
    expect(limit.mock.calls.map(([o]) => o.key)).toEqual(['ip:203.0.113.7', 'email:a@example.com'])
  })

  it('refuses when the rate limit is reached, before Turnstile or Circle', async () => {
    limit.mockResolvedValueOnce({ success: false })
    const res = await worker.fetch(post('email-token', { deviceId: 'device-12345', email: 'a@example.com', turnstile: 'good' }), env())
    expect(res.status).toBe(429)
    expect(calls).toEqual([])
  })

  it('sign-transaction refuses a disallowed target with 403 and never calls Circle', async () => {
    const res = await worker.fetch(post('sign-transaction', { walletId: WALLET_ID, transaction: signTx(OTHER) }, cookie), env())
    expect(res.status).toBe(403)
    expect(await res.json()).toHaveProperty('error')
    expect(circleCalls()).toEqual([])
    // The factory was asked about the unknown address through the network's RPC.
    expect(calls.map((c) => c.url)).toEqual([net.rpcUrl])
  })

  it('sign-transaction refuses when the factory cannot be asked (fail closed)', async () => {
    replies[net.rpcUrl] = () => new Response('bad gateway', { status: 502 })
    const res = await worker.fetch(post('sign-transaction', { walletId: WALLET_ID, transaction: signTx(CAMPAIGN) }, cookie), env())
    expect(res.status).toBe(403)
    expect(circleCalls()).toEqual([])
  })

  it('sign-transaction refuses a transaction that is not JSON with 400, not 500', async () => {
    const res = await worker.fetch(post('sign-transaction', { walletId: WALLET_ID, transaction: '{not json' }, cookie), env())
    expect(res.status).toBe(400)
    expect(circleCalls()).toEqual([])
  })

  it('sign-transaction sends an allowed campaign call to Circle and returns the challenge id', async () => {
    replies[net.rpcUrl] = () => Response.json({ jsonrpc: '2.0', id: 1, result: encodeFunctionResult({ abi: factoryAbi, functionName: 'isCampaign', result: true }) })
    const transaction = signTx(CAMPAIGN)
    const res = await worker.fetch(post('sign-transaction', { walletId: WALLET_ID, transaction, memo: 'Give 5 USDC' }, cookie), env())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ challengeId: 'ch-1' })
    const rpc = calls.find((c) => c.url === net.rpcUrl)
    expect(JSON.parse(String(rpc?.init.body))).toMatchObject({ method: 'eth_call', params: [{ to: FACTORY }, 'latest'] })
    const [c] = circleCalls()
    expect(JSON.parse(String(c!.init.body))).toEqual({ walletId: WALLET_ID, transaction, memo: 'Give 5 USDC' })
    expect(header(c!, 'x-user-token')).toBe(COOKIE_UT)
  })

  it('forwards X-User-Token from the cookie, never from the body', async () => {
    const res = await worker.fetch(post('wallets', { userToken: BODY_UT }, cookie), env())
    expect(res.status).toBe(200)
    const [c] = circleCalls()
    expect(c!.url).toBe('https://api.circle.com/v1/w3s/wallets?blockchain=EVM-TESTNET')
    expect(header(c!, 'x-user-token')).toBe(COOKIE_UT)
    expect(JSON.stringify(c!.init)).not.toContain(BODY_UT)

    // No cookie: refused even with a token in the body.
    calls = []
    const none = await worker.fetch(post('wallets', { userToken: BODY_UT }), env())
    expect(none.status).toBe(401)
    expect(circleCalls()).toEqual([])
  })

  it('initialize asks Circle for an EOA of the network wallet type', async () => {
    replies['https://api.circle.com/v1/w3s/user/initialize'] = () =>
      Response.json({ code: 155106, message: 'User already initialized', extra: 'dropped' }, { status: 409, headers: { 'x-request-id': 'r1', 'set-cookie': 'circle=1' } })
    const res = await worker.fetch(post('initialize', {}, cookie), env())
    const [c] = circleCalls()
    expect(JSON.parse(String(c!.init.body))).toMatchObject({ accountType: 'EOA', blockchains: ['EVM-TESTNET'] })
    // Circle's status, code and message pass through so the app can map them. Nothing else does.
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ code: 155106, message: 'User already initialized' })
    expect(res.headers.get('x-request-id')).toBeNull()
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('login sets the cookies from valid tokens and echoes none of them', async () => {
    const res = await worker.fetch(post('login', { userToken: COOKIE_UT, encryptionKey: 'encryption-key-0123456789', refreshToken: COOKIE_RT }), env())
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ ok: true })
    expect(text).not.toContain(COOKIE_UT)
    const set = res.headers.getSetCookie()
    expect(set.some((c) => c.startsWith(`ucw_ut=${COOKIE_UT};`))).toBe(true)
    expect(set.some((c) => c.startsWith(`ucw_rt=${COOKIE_RT};`))).toBe(true)

    const bad = await worker.fetch(post('login', { userToken: 'x', encryptionKey: 'y', refreshToken: 'z;Path=/' }), env())
    expect(bad.status).toBe(400)
    expect(bad.headers.getSetCookie()).toEqual([])
    expect(calls).toEqual([])
  })

  it('session refreshes with the cookies, sets new ones and returns the pair', async () => {
    replies['https://api.circle.com/v1/w3s/users/token/refresh'] = () =>
      Response.json({ data: { userToken: 'new-user-token-0123456789', encryptionKey: 'new-encryption-key-012345', refreshToken: 'new-refresh-token-0123456789', userId: 'u' } })
    const res = await worker.fetch(post('session', { deviceId: 'device-12345' }, cookie), env())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userToken: 'new-user-token-0123456789', encryptionKey: 'new-encryption-key-012345' })
    const [c] = circleCalls()
    expect(header(c!, 'x-user-token')).toBe(COOKIE_UT)
    expect(JSON.parse(String(c!.init.body))).toMatchObject({ refreshToken: COOKIE_RT, deviceId: 'device-12345' })
    const set = res.headers.getSetCookie()
    expect(set.some((s) => s.startsWith('ucw_ut=new-user-token-0123456789;'))).toBe(true)
    expect(set.some((s) => s.startsWith('ucw_rt=new-refresh-token-0123456789;'))).toBe(true)
  })

  it('session is 401 without cookies, and 401 with cleared cookies when Circle refuses the refresh', async () => {
    expect((await worker.fetch(post('session', { deviceId: 'device-12345' }), env())).status).toBe(401)
    expect(circleCalls()).toEqual([])

    replies['https://api.circle.com/v1/w3s/users/token/refresh'] = () => Response.json({ code: 155104, message: 'Invalid user token' }, { status: 403 })
    const res = await worker.fetch(post('session', { deviceId: 'device-12345' }, cookie), env())
    expect(res.status).toBe(401)
    expect(res.headers.getSetCookie().every((s) => s.includes('Max-Age=0'))).toBe(true)
    expect(res.headers.getSetCookie()).toHaveLength(2)
  })

  it('signout clears both cookies', async () => {
    const res = await worker.fetch(post('signout', {}), env())
    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie().map((s) => s.split('=')[0])).toEqual(['ucw_ut', 'ucw_rt'])
  })

  it('refuses a foreign Origin', async () => {
    for (const origin of ['https://evil.example', 'https://fundit.fun.evil.example', 'http://fundit.fun', 'null']) {
      const res = await worker.fetch(post('wallets', {}, { ...cookie, origin }), env())
      expect(res.status, origin).toBe(403)
    }
    const noOrigin = new Request(`${ORIGIN}/api/ucw/signout`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })
    expect((await worker.fetch(noOrigin, env())).status).toBe(403)
    expect(calls).toEqual([])
  })

  it('refuses GET, non-JSON and oversized bodies', async () => {
    expect((await worker.fetch(new Request(`${ORIGIN}/api/ucw/wallets`, { headers: { origin: ORIGIN, ...cookie } }), env())).status).toBe(405)
    expect((await worker.fetch(post('wallets', {}, { ...cookie, 'content-type': 'text/plain' }), env())).status).toBe(415)
    const big = await worker.fetch(post('sign-transaction', { walletId: WALLET_ID, transaction: 'x'.repeat(70_000) }, cookie), env())
    expect(big.status).toBe(413)
    const broken = new Request(`${ORIGIN}/api/ucw/wallets`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...cookie }, body: '{' })
    expect((await worker.fetch(broken, env())).status).toBe(400)
    expect(calls).toEqual([])
  })

  it('refuses every API call when the Worker is not configured', async () => {
    const res = await worker.fetch(post('wallets', {}, cookie), env({ FACTORY_ADDRESS: '' }))
    expect(res.status).toBe(503)
    expect((await worker.fetch(post('wallets', {}, cookie), env({ NETWORK: 'devnet' }))).status).toBe(503)
    expect(calls).toEqual([])
  })

  it('non-API paths go to ASSETS', async () => {
    for (const path of ['/', '/c/0xabc', '/api/other']) {
      const res = await worker.fetch(new Request(`${ORIGIN}${path}`), env())
      expect(await res.text()).toBe('static')
    }
    expect(assets).toHaveBeenCalledTimes(3)
    expect(calls).toEqual([])
  })
})

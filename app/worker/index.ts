// Fundit's Worker. It serves the static site and answers /api/ucw/* for email accounts (Circle user-controlled
// wallets) by calling Circle's API with the API key, which never reaches the browser.
//
// The key cannot move money on its own: every transaction is a challenge the person approves in Circle's window.
// The Worker still limits what it can be used for: Turnstile before any login code is sent, Circle's tokens only
// in HttpOnly cookies, and sign requests only for Fundit's own contracts on the configured network (policy.ts).
//
// Never log a request or response body, a token, the API key or the Turnstile secret.
import { decodeFunctionResult, encodeFunctionData, isAddress, parseAbi, type Address } from 'viem'
import { clearTokenCookies, readTokens, TOKEN, tokenCookies } from './cookies'
import { NETWORKS_WORKER, type WorkerNetwork, type WorkerNetworkConfig } from './networks'
import { checkSignRequest, type PolicyContext } from './policy'

// Cloudflare's rate limiting binding (wrangler.jsonc ratelimits).
type RateLimit = { limit(options: { key: string }): Promise<{ success: boolean }> }

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  // Optional: without the binding, Turnstile and Circle's own OTP limits stand alone.
  UCW_LIMIT?: RateLimit
  // Secrets.
  CIRCLE_API_KEY: string
  TURNSTILE_SECRET: string
  // Vars.
  NETWORK: string
  FACTORY_ADDRESS: string
  SITE_ORIGIN: string
}

type Config = { net: WorkerNetworkConfig; factory: Address }
type Body = Record<string, unknown>

const CIRCLE = 'https://api.circle.com/v1/w3s'
const TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const MAX_BODY = 32 * 1024
const CIRCLE_TIMEOUT_MS = 15_000
const RPC_TIMEOUT_MS = 4_000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEVICE_ID = /^[A-Za-z0-9._-]{8,256}$/
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/
const TURNSTILE_TOKEN = /^[A-Za-z0-9._:-]{1,2048}$/
// What Circle's window shows above the transaction. Printable text only.
const MEMO = /^[\x20-\x7E]{1,200}$/

const factoryAbi = parseAbi(['function isCampaign(address) view returns (bool)'])

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Body,
  ) {
    super(String(body.error ?? status))
  }
}

function json(status: number, body: unknown, cookies: readonly string[] = []): Response {
  const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  for (const c of cookies) headers.append('set-cookie', c)
  return new Response(JSON.stringify(body), { status, headers })
}

function str(body: Body, key: string, pattern: RegExp): string | null {
  const v = body[key]
  return typeof v === 'string' && pattern.test(v) ? v : null
}

function config(env: Env): Config | null {
  const net = env.NETWORK === 'testnet' || env.NETWORK === 'mainnet' ? NETWORKS_WORKER[env.NETWORK as WorkerNetwork] : null
  if (!net || !isAddress(env.FACTORY_ADDRESS ?? '', { strict: false }) || !env.SITE_ORIGIN || !env.CIRCLE_API_KEY || !env.TURNSTILE_SECRET) return null
  return { net, factory: env.FACTORY_ADDRESS as Address }
}

// Calls Circle and returns its `data` on success. On an error, only Circle's status, code and message go back,
// so the app can map codes such as 155104 or 155133. No upstream header or other field is passed on.
async function circle(env: Env, method: 'GET' | 'POST', path: string, userToken: string | null, body?: Body): Promise<Body> {
  const headers: Record<string, string> = { authorization: `Bearer ${env.CIRCLE_API_KEY}`, accept: 'application/json' }
  if (userToken) headers['x-user-token'] = userToken
  if (body) headers['content-type'] = 'application/json'
  let res: Response
  let parsed: unknown
  try {
    res = await fetch(`${CIRCLE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(CIRCLE_TIMEOUT_MS) })
    parsed = await res.json().catch(() => null)
  } catch {
    throw new HttpError(502, { error: 'Circle unreachable' })
  }
  const obj = typeof parsed === 'object' && parsed !== null ? (parsed as Body) : {}
  if (!res.ok) {
    const out: Body = typeof obj.code === 'number' ? { code: obj.code } : { error: 'Circle refused the request' }
    if (typeof obj.message === 'string') out.message = obj.message.slice(0, 300)
    throw new HttpError(res.status >= 400 ? res.status : 502, out)
  }
  const data = obj.data
  return typeof data === 'object' && data !== null ? (data as Body) : {}
}

async function verifyTurnstile(env: Env, token: string, ip: string): Promise<boolean> {
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token })
  if (ip) form.set('remoteip', ip)
  try {
    const res = await fetch(TURNSTILE, { method: 'POST', body: form, signal: AbortSignal.timeout(CIRCLE_TIMEOUT_MS) })
    const out = (await res.json()) as { success?: unknown; hostname?: unknown }
    // The widget must have been solved on this site.
    return out.success === true && out.hostname === new URL(env.SITE_ORIGIN).hostname
  } catch {
    return false
  }
}

// factory.isCampaign(address) through the network's RPC. Throws on any failure, so the policy refuses.
async function isCampaign(cfg: Config, address: Address): Promise<boolean> {
  const data = encodeFunctionData({ abi: factoryAbi, functionName: 'isCampaign', args: [address] })
  const res = await fetch(cfg.net.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: cfg.factory, data }, 'latest'] }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`RPC ${res.status}`)
  const out = (await res.json()) as { result?: unknown }
  if (typeof out.result !== 'string') throw new Error('RPC gave no result')
  return decodeFunctionResult({ abi: factoryAbi, functionName: 'isCampaign', data: out.result as `0x${string}` })
}

async function rateLimit(env: Env, keys: string[]): Promise<void> {
  if (!env.UCW_LIMIT) return
  for (const key of keys) {
    if (!(await env.UCW_LIMIT.limit({ key })).success) throw new HttpError(429, { error: 'Too many requests' })
  }
}

async function readBody(request: Request): Promise<Body> {
  const type = request.headers.get('content-type') ?? ''
  if (!/^application\/json(\s*;|$)/i.test(type)) throw new HttpError(415, { error: 'JSON only' })
  const length = Number(request.headers.get('content-length') ?? '0')
  if (length > MAX_BODY) throw new HttpError(413, { error: 'Body too large' })
  const text = await request.text()
  if (text.length > MAX_BODY) throw new HttpError(413, { error: 'Body too large' })
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new HttpError(400, { error: 'Bad JSON' })
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, { error: 'Body must be an object' })
  return body as Body
}

async function route(name: string, request: Request, env: Env, cfg: Config): Promise<Response> {
  const body = await readBody(request)
  const ip = request.headers.get('cf-connecting-ip') ?? ''
  // X-User-Token only ever comes from the cookie. A token in a body is ignored.
  const { userToken, refreshToken } = readTokens(request.headers.get('cookie'))
  const requireUser = (): string => {
    if (!userToken) throw new HttpError(401, { error: 'Not signed in' })
    return userToken
  }
  const idempotencyKey = crypto.randomUUID()

  switch (name) {
    case 'email-token': {
      const deviceId = str(body, 'deviceId', DEVICE_ID)
      const email = str(body, 'email', EMAIL)
      const turnstile = str(body, 'turnstile', TURNSTILE_TOKEN)
      if (!deviceId || !email || !turnstile) return json(400, { error: 'deviceId, email or turnstile' })
      await rateLimit(env, [`ip:${ip || 'unknown'}`, `email:${email.toLowerCase()}`])
      if (!(await verifyTurnstile(env, turnstile, ip))) return json(403, { error: 'Turnstile check failed' })
      const data = await circle(env, 'POST', '/users/email/token', null, { idempotencyKey, deviceId, email })
      const out = { deviceToken: data.deviceToken, deviceEncryptionKey: data.deviceEncryptionKey, otpToken: data.otpToken }
      if (Object.values(out).some((v) => typeof v !== 'string')) return json(502, { error: 'Circle gave no login values' })
      return json(200, out)
    }
    case 'login': {
      const ut = str(body, 'userToken', TOKEN)
      const ek = str(body, 'encryptionKey', TOKEN)
      const rt = str(body, 'refreshToken', TOKEN)
      if (!ut || !ek || !rt) return json(400, { error: 'userToken, encryptionKey or refreshToken' })
      return json(200, { ok: true }, tokenCookies(ut, rt))
    }
    case 'session': {
      const deviceId = str(body, 'deviceId', DEVICE_ID)
      if (!deviceId) return json(400, { error: 'deviceId' })
      if (!userToken || !refreshToken) return json(401, { error: 'Not signed in' })
      let data: Body
      try {
        data = await circle(env, 'POST', '/users/token/refresh', userToken, { idempotencyKey, refreshToken, deviceId })
      } catch (e) {
        // Circle refused the tokens: the session is over. Anything else (Circle down) keeps the cookies.
        if (e instanceof HttpError && e.status >= 400 && e.status < 500) return json(401, { error: 'Session expired', ...e.body }, clearTokenCookies())
        throw e
      }
      const ut = str(data, 'userToken', TOKEN)
      const ek = str(data, 'encryptionKey', TOKEN)
      const rt = str(data, 'refreshToken', TOKEN)
      if (!ut || !ek || !rt) return json(502, { error: 'Circle gave no tokens' })
      return json(200, { userToken: ut, encryptionKey: ek }, tokenCookies(ut, rt))
    }
    case 'initialize': {
      const data = await circle(env, 'POST', '/user/initialize', requireUser(), { idempotencyKey, accountType: 'EOA', blockchains: [cfg.net.walletType] })
      return json(200, { data })
    }
    case 'wallets': {
      const data = await circle(env, 'GET', `/wallets?blockchain=${cfg.net.walletType}`, requireUser())
      return json(200, { data })
    }
    case 'sign-transaction': {
      const ut = requireUser()
      const walletId = str(body, 'walletId', UUID)
      const transaction = typeof body.transaction === 'string' && body.transaction.length <= 20_000 ? body.transaction : null
      const memo = body.memo === undefined ? null : str(body, 'memo', MEMO)
      if (!walletId || !transaction || (body.memo !== undefined && !memo)) return json(400, { error: 'walletId, transaction or memo' })
      await rateLimit(env, [`ip:${ip || 'unknown'}`])
      let tx: unknown
      try {
        tx = JSON.parse(transaction)
      } catch {
        return json(400, { error: 'transaction is not JSON' })
      }
      const ctx: PolicyContext = {
        chainId: cfg.net.chainId,
        fixedTargets: new Set([cfg.net.usdc, cfg.net.eurc, cfg.factory, cfg.net.tokenMessengerV2, cfg.net.multicall3From]),
        isCampaign: (a) => isCampaign(cfg, a),
      }
      const verdict = await checkSignRequest(tx, ctx)
      if (!verdict.ok) return json(403, { error: verdict.reason })
      const data = await circle(env, 'POST', '/user/sign/transaction', ut, { walletId, transaction, ...(memo && { memo }) })
      if (typeof data.challengeId !== 'string') return json(502, { error: 'Circle gave no challenge' })
      return json(200, { challengeId: data.challengeId })
    }
    case 'signout':
      return json(200, { ok: true }, clearTokenCookies())
    default:
      return json(404, { error: 'Unknown route' })
  }
}

async function api(request: Request, env: Env, name: string): Promise<Response> {
  const cfg = config(env)
  if (!cfg) return json(503, { error: 'Email accounts are not configured' })
  if (request.method !== 'POST') return json(405, { error: 'POST only' })
  // Same-origin page only. A browser always sends Origin on a POST.
  if (request.headers.get('origin') !== env.SITE_ORIGIN) return json(403, { error: 'Wrong origin' })
  try {
    return await route(name, request, env, cfg)
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, e.body)
    // No stack or message: it could hold request data.
    return json(500, { error: 'Internal error' })
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname.startsWith('/api/ucw/')) return api(request, env, pathname.slice('/api/ucw/'.length))
    return env.ASSETS.fetch(request)
  },
}

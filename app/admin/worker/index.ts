// The fundit-admin Worker (admin.fundit.fun). It runs before every file, so the panel is only ever sent to a
// browser holding a session for the wallet that is CampaignFactory.owner() on this Worker's NETWORK.
//
// Sign-in: Turnstile, then a single-use nonce from D1, then a Sign-In with Ethereum message signed by the owner.
// owner() is read fresh at login and again (cached at most OWNER_CACHE_MS) on every session check, so moving
// ownership ends the old owner's session within a minute. Any missing config, secret or RPC answer refuses.
//
// Never log a request or response body, a cookie, a signature, a message or a secret.
import { getAddress, type Address, type Hex } from 'viem'
import { TURNSTILE_TOKEN, verifyTurnstile } from '../../worker/turnstile'
import { loginFiles, MANIFEST_PATH, type ManifestChunk } from './assets'
import { adminChain, type AdminChain } from './chain'
import type { Db } from './db'
import { secure } from './headers'
import { consumeNonce, issueNonce, pruneNonces } from './nonces'
import { cachedOwner, readOwner } from './owner'
import { clearSessionCookie, readSession, secretOk, SESSION_TTL_SEC, sessionCookie, signSession, type Session } from './session'
import { checkLoginMessage, signerMatches } from './siwe'

// Cloudflare's rate limiting binding (wrangler.jsonc ratelimits).
type RateLimit = { limit(options: { key: string }): Promise<{ success: boolean }> }

export interface Env {
  ASSETS: { fetch(r: Request): Promise<Response> }
  ADMIN_DB: Db
  // Optional: without the binding (local dev), Turnstile stands alone.
  ADMIN_LIMIT?: RateLimit
  // Vars.
  NETWORK: string
  ADMIN_ORIGIN: string
  // Secrets.
  ADMIN_SESSION_SECRET: string
  TURNSTILE_SECRET: string
}

type Config = { chain: AdminChain; origin: string; secret: string; turnstileSecret: string; db: Db }
type Body = Record<string, unknown>

const MAX_BODY = 4 * 1024
const SIGNATURE = /^0x[0-9a-fA-F]{2,1024}$/

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
  }
}

function json(status: number, body: unknown, cookies: readonly string[] = []): Response {
  const headers = new Headers({ 'content-type': 'application/json' })
  for (const c of cookies) headers.append('set-cookie', c)
  return new Response(JSON.stringify(body), { status, headers })
}

const fail = (status: number, code: string, cookies: readonly string[] = []) => json(status, { error: code }, cookies)
const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })

function config(env: Env): Config | null {
  const chain = adminChain(env.NETWORK)
  let origin: string | null = null
  try {
    // An exact https origin, nothing after the host.
    if (env.ADMIN_ORIGIN && new URL(env.ADMIN_ORIGIN).origin === env.ADMIN_ORIGIN && env.ADMIN_ORIGIN.startsWith('https://')) origin = env.ADMIN_ORIGIN
  } catch {
    origin = null
  }
  if (!chain || !origin || !secretOk(env.ADMIN_SESSION_SECRET) || !env.TURNSTILE_SECRET || !env.ADMIN_DB) return null
  return { chain, origin, secret: env.ADMIN_SESSION_SECRET, turnstileSecret: env.TURNSTILE_SECRET, db: env.ADMIN_DB }
}

async function rateLimit(env: Env, key: string): Promise<void> {
  if (!env.ADMIN_LIMIT) return
  if (!(await env.ADMIN_LIMIT.limit({ key })).success) throw new HttpError(429, 'rate_limited')
}

async function readBody(request: Request): Promise<Body> {
  if (!/^application\/json(\s*;|$)/i.test(request.headers.get('content-type') ?? '')) throw new HttpError(400, 'bad_input')
  if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY) throw new HttpError(400, 'bad_input')
  const text = await request.text()
  if (text.length > MAX_BODY) throw new HttpError(400, 'bad_input')
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new HttpError(400, 'bad_input')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'bad_input')
  return body as Body
}

type SessionState = { kind: 'ok'; session: Session } | { kind: 'out' } | { kind: 'unavailable' }

// In order: the cookie's MAC and expiry, the network it was made for, and that its address is still owner().
async function checkSession(request: Request, cfg: Config, nowMs: number): Promise<SessionState> {
  const session = await readSession(request.headers.get('cookie'), cfg.secret, Math.floor(nowMs / 1000))
  if (!session) return { kind: 'out' }
  if (session.chainId !== cfg.chain.chainId || session.factory !== cfg.chain.factory.toLowerCase()) return { kind: 'out' }
  let owner: Address
  try {
    owner = await cachedOwner(cfg.chain.rpcUrl, cfg.chain.factory, nowMs)
  } catch {
    return { kind: 'unavailable' }
  }
  return owner.toLowerCase() === session.address ? { kind: 'ok', session } : { kind: 'out' }
}

async function login(request: Request, cfg: Config, nowMs: number): Promise<Response> {
  const body = await readBody(request)
  const { message, signature } = body
  if (typeof message !== 'string' || typeof signature !== 'string' || !SIGNATURE.test(signature)) return fail(400, 'bad_input')
  const check = checkLoginMessage(message, { origin: cfg.origin, chainId: cfg.chain.chainId, nowMs })
  if (!check.ok) return fail(403, check.reason)
  if (!(await signerMatches(message, check.address, signature as Hex))) return fail(403, 'bad_signature')
  // Spent before owner() is read, so a refused login cannot be retried with the same signature.
  if (!(await consumeNonce(cfg.db, check.nonce, nowMs))) return fail(403, 'nonce')
  let owner: Address
  try {
    owner = await readOwner(cfg.chain.rpcUrl, cfg.chain.factory)
  } catch {
    return fail(503, 'unavailable')
  }
  if (owner.toLowerCase() !== check.address.toLowerCase()) return fail(403, 'not_owner')
  const iat = Math.floor(nowMs / 1000)
  const session: Session = {
    v: 1,
    address: check.address.toLowerCase() as Address,
    chainId: cfg.chain.chainId,
    factory: cfg.chain.factory.toLowerCase() as Address,
    iat,
    exp: iat + SESSION_TTL_SEC,
  }
  return json(200, { address: check.address }, [sessionCookie(await signSession(session, cfg.secret))])
}

async function api(request: Request, env: Env, name: string, nowMs: number): Promise<Response> {
  const cfg = config(env)
  if (!cfg) return fail(503, 'unavailable')
  const ip = request.headers.get('cf-connecting-ip') || 'unknown'
  try {
    if (name === 'session') {
      if (request.method !== 'GET') return fail(405, 'method')
      const state = await checkSession(request, cfg, nowMs)
      if (state.kind === 'unavailable') return fail(503, 'unavailable')
      if (state.kind === 'out') return fail(401, 'signed_out', [clearSessionCookie()])
      return json(200, { address: getAddress(state.session.address), network: cfg.chain.network, chainId: cfg.chain.chainId, factory: cfg.chain.factory })
    }
    if (name !== 'nonce' && name !== 'login' && name !== 'logout') return fail(404, 'not_found')
    if (request.method !== 'POST') return fail(405, 'method')
    // Same-origin page only. A browser always sends Origin on a POST.
    if (request.headers.get('origin') !== cfg.origin) return fail(403, 'origin')
    if (name === 'logout') return json(200, { ok: true }, [clearSessionCookie()])
    if (name === 'login') {
      await rateLimit(env, `ip:login:${ip}`)
      return await login(request, cfg, nowMs)
    }
    await rateLimit(env, `ip:nonce:${ip}`)
    const body = await readBody(request)
    const token = body.turnstile
    if (typeof token !== 'string' || !TURNSTILE_TOKEN.test(token)) return fail(400, 'bad_input')
    if (!(await verifyTurnstile(cfg.turnstileSecret, token, ip === 'unknown' ? '' : ip, new URL(cfg.origin).hostname))) return fail(403, 'turnstile')
    await pruneNonces(cfg.db, nowMs)
    return json(200, await issueNonce(cfg.db, nowMs))
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.code)
    // No stack or message: it could hold request data.
    return fail(500, 'internal')
  }
}

// The manifest, read once per isolate. A failed read is not kept, so the next request tries again.
let loginFileSet: Promise<Set<string>> | null = null

function publicFiles(env: Env, request: Request): Promise<Set<string>> {
  loginFileSet ??= (async () => {
    const res = await env.ASSETS.fetch(new Request(new URL(MANIFEST_PATH, request.url)))
    if (!res.ok) throw new Error('no manifest')
    const manifest = (await res.json()) as unknown
    if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) throw new Error('bad manifest')
    return loginFiles(manifest as Record<string, ManifestChunk>)
  })()
  loginFileSet.catch(() => {
    loginFileSet = null
  })
  return loginFileSet
}

// Any spelling of the manifest's path. It lists every panel file, so it is never served.
function isManifest(pathname: string): boolean {
  let path = pathname
  try {
    path = decodeURIComponent(pathname)
  } catch {
    // A bad escape: the raw path is checked.
  }
  return path.toLowerCase().replace(/\/+$/, '').endsWith('manifest.json')
}

async function files(request: Request, env: Env, nowMs: number): Promise<Response> {
  const { pathname } = new URL(request.url)
  if (isManifest(pathname)) return notFound()
  const cfg = config(env)
  const state = cfg ? await checkSession(request, cfg, nowMs) : null
  if (state?.kind === 'ok') {
    if (pathname === '/') return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request))
    return env.ASSETS.fetch(request)
  }
  // Signed out, or the session cannot be checked: only the login page and the files it loads, by exact path.
  const path = pathname === '/' ? '/login.html' : pathname
  let allowed: Set<string>
  try {
    allowed = await publicFiles(env, request)
  } catch {
    return new Response('Unavailable', { status: 503, headers: { 'content-type': 'text/plain' } })
  }
  if (!allowed.has(path)) return notFound()
  return env.ASSETS.fetch(new Request(new URL(path, request.url), { method: request.method === 'HEAD' ? 'HEAD' : 'GET' }))
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const nowMs = Date.now()
    const { pathname } = new URL(request.url)
    if (pathname.startsWith('/api/admin/')) return secure(await api(request, env, pathname.slice('/api/admin/'.length), nowMs))
    try {
      return secure(await files(request, env, nowMs))
    } catch {
      return secure(new Response('Error', { status: 500, headers: { 'content-type': 'text/plain' } }))
    }
  },
}

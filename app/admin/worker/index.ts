// The fundit-admin Worker (admin.fundit.fun). It runs before every file, so the panel is only ever sent to a
// browser holding a session for a wallet that is CampaignFactory.owner() on Arc mainnet or Arc testnet. One
// deployment covers both networks.
//
// Sign-in: Turnstile, then a single-use nonce from D1, then a Sign-In with Ethereum message (for either Arc chain)
// signed by the owner. owner() is read on both networks, fresh at login and again (cached at most OWNER_CACHE_MS)
// on every session check, so moving ownership ends the old owner's session within a minute. The session holds
// while one network confirms the address. A failed read is never taken as an answer: if no network confirms and
// one could not be read, the Worker refuses. Any missing config or secret refuses.
//
// Never log a request or response body, a cookie, a signature, a message or a secret.
import { getAddress, type Address, type Hex } from 'viem'
import { TURNSTILE_TOKEN, verifyTurnstile } from '../../worker/turnstile'
import { loginFiles, MANIFEST_PATH, type ManifestChunk } from './assets'
import { ADMIN_CHAINS } from './chain'
import { runCron } from './cron'
import type { Db } from './db'
import { secure } from './headers'
import { consumeNonce, issueNonce, pruneNonces } from './nonces'
import { cachedOwner, readOwner } from './owner'
import { clearSessionCookie, readSession, secretOk, SESSION_TTL_SEC, sessionCookie, signSession, type Session } from './session'
import { checkLoginMessage, signerMatches } from './siwe'
import type { WorkerNetwork } from '../../worker/networks'

// Cloudflare's rate limiting binding (wrangler.jsonc ratelimits).
type RateLimit = { limit(options: { key: string }): Promise<{ success: boolean }> }

export interface Env {
  ASSETS: { fetch(r: Request): Promise<Response> }
  ADMIN_DB: Db
  // Optional: without the binding (local dev), Turnstile stands alone.
  ADMIN_LIMIT?: RateLimit
  // Vars.
  ADMIN_ORIGIN: string
  // Secrets.
  ADMIN_SESSION_SECRET: string
  TURNSTILE_SECRET: string
  // Optional: without them the cron still runs the checks but sends nothing.
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
}

type Config = { origin: string; secret: string; turnstileSecret: string; db: Db }
type Body = Record<string, unknown>

// The panel's pages. The browser routes between them, so a reload on any of them is sent the panel.
export const PANEL_PATHS = ['/', '/fundits', '/gifts', '/activity', '/health', '/settings'] as const

const NETWORKS = ['mainnet', 'testnet'] as const satisfies readonly WorkerNetwork[]
const CHAIN_IDS = NETWORKS.map((n) => ADMIN_CHAINS[n].chainId)

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
  let origin: string | null = null
  try {
    // An exact https origin, nothing after the host.
    if (env.ADMIN_ORIGIN && new URL(env.ADMIN_ORIGIN).origin === env.ADMIN_ORIGIN && env.ADMIN_ORIGIN.startsWith('https://')) origin = env.ADMIN_ORIGIN
  } catch {
    origin = null
  }
  if (!origin || !secretOk(env.ADMIN_SESSION_SECRET) || !env.TURNSTILE_SECRET || !env.ADMIN_DB) return null
  return { origin, secret: env.ADMIN_SESSION_SECRET, turnstileSecret: env.TURNSTILE_SECRET, db: env.ADMIN_DB }
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

// Per network: true when `address` is owner(), false when another wallet is, null when the read failed.
type Owned = Record<WorkerNetwork, boolean | null>
type SessionState = { kind: 'ok'; session: Session; owned: Owned } | { kind: 'out' } | { kind: 'unavailable' }

async function ownedBy(address: string, read: (rpcUrl: string, factory: Address) => Promise<Address>): Promise<Owned> {
  const answers = await Promise.all(
    NETWORKS.map(async (n) => {
      try {
        return (await read(ADMIN_CHAINS[n].rpcUrl, ADMIN_CHAINS[n].factory)).toLowerCase() === address.toLowerCase()
      } catch {
        return null
      }
    }),
  )
  return Object.fromEntries(NETWORKS.map((n, i) => [n, answers[i] ?? null])) as Owned
}

// In: one network confirms. Out: every network answered and none confirms. Otherwise the answer is unknown.
function decide(owned: Owned): 'in' | 'out' | 'unknown' {
  const values = Object.values(owned)
  if (values.includes(true)) return 'in'
  return values.every((v) => v === false) ? 'out' : 'unknown'
}

// In order: the cookie's MAC, version and expiry, then that its address is still owner() on at least one network.
async function checkSession(request: Request, cfg: Config, nowMs: number): Promise<SessionState> {
  const session = await readSession(request.headers.get('cookie'), cfg.secret, Math.floor(nowMs / 1000))
  if (!session) return { kind: 'out' }
  const owned = await ownedBy(session.address, (rpcUrl, factory) => cachedOwner(rpcUrl, factory, nowMs))
  const verdict = decide(owned)
  if (verdict === 'in') return { kind: 'ok', session, owned }
  return verdict === 'out' ? { kind: 'out' } : { kind: 'unavailable' }
}

async function login(request: Request, cfg: Config, nowMs: number): Promise<Response> {
  const body = await readBody(request)
  const { message, signature } = body
  if (typeof message !== 'string' || typeof signature !== 'string' || !SIGNATURE.test(signature)) return fail(400, 'bad_input')
  const check = checkLoginMessage(message, { origin: cfg.origin, chainIds: CHAIN_IDS, nowMs })
  if (!check.ok) return fail(403, check.reason)
  if (!(await signerMatches(message, check.address, signature as Hex))) return fail(403, 'bad_signature')
  // Spent before owner() is read, so a refused login cannot be retried with the same signature.
  if (!(await consumeNonce(cfg.db, check.nonce, nowMs))) return fail(403, 'nonce')
  const verdict = decide(await ownedBy(check.address, readOwner))
  if (verdict === 'unknown') return fail(503, 'unavailable')
  if (verdict === 'out') return fail(403, 'not_owner')
  const iat = Math.floor(nowMs / 1000)
  const session: Session = { v: 2, address: check.address.toLowerCase() as Address, iat, exp: iat + SESSION_TTL_SEC }
  return json(200, { address: check.address }, [sessionCookie(await signSession(session, cfg.secret))])
}

type HealthRow = { key: string; failing: number; fail_count: number; since: number; last_sent: number }

// The cron's stored state for one network: its alert rows (missing ones left out) and its two meta values.
// Nothing here holds a Telegram secret or a chat id.
async function health(db: Db, network: WorkerNetwork): Promise<unknown> {
  const { results } = await db
    .prepare('SELECT key, failing, fail_count, since, last_sent FROM alert_state WHERE key IN (?, ?, ?, ?) ORDER BY key')
    .bind('site', 'ucw', `rpc:arc-${network}`, `events:arc-${network}`)
    .all<HealthRow>()
  const cursorKey = `owner_events_next:${network}`
  const headKey = `rpc_head:${network}`
  const meta = await db.prepare('SELECT key, value FROM meta WHERE key IN (?, ?)').bind(cursorKey, headKey).all<{ key: string; value: string }>()
  const value = (key: string) => meta.results.find((r) => r.key === key)?.value ?? null
  const lastEventBlock = value(cursorKey)
  return {
    checks: results.map((r) => ({ key: r.key, ok: r.failing !== 1, failCount: r.fail_count, since: r.since, lastSent: r.last_sent })),
    alertsStarted: lastEventBlock !== null,
    lastEventBlock,
    rpcHead: value(headKey),
  }
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
      const networks = Object.fromEntries(
        NETWORKS.map((n) => [n, { chainId: ADMIN_CHAINS[n].chainId, factory: ADMIN_CHAINS[n].factory, owner: state.owned[n] }]),
      )
      return json(200, { address: getAddress(state.session.address), networks })
    }
    // A session is enough: the address owns at least one factory. The rows are the same cron state for both.
    if (name === 'health') {
      if (request.method !== 'GET') return fail(405, 'method')
      const state = await checkSession(request, cfg, nowMs)
      if (state.kind === 'unavailable') return fail(503, 'unavailable')
      if (state.kind === 'out') return fail(401, 'signed_out', [clearSessionCookie()])
      const network = new URL(request.url).searchParams.get('network')
      if (network !== 'mainnet' && network !== 'testnet') return fail(400, 'bad_input')
      return json(200, await health(cfg.db, network))
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

// A panel page, with or without one trailing slash. "/" is itself, and "//" is not a panel page.
function isPanelPath(pathname: string): boolean {
  if (pathname === '/') return true
  const path = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  return path !== '/' && (PANEL_PATHS as readonly string[]).includes(path)
}

async function files(request: Request, env: Env, nowMs: number): Promise<Response> {
  const { pathname } = new URL(request.url)
  if (isManifest(pathname)) return notFound()
  const cfg = config(env)
  const state = cfg ? await checkSession(request, cfg, nowMs) : null
  const panelPage = isPanelPath(pathname)
  if (state?.kind === 'ok') {
    if (panelPage) return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request))
    return env.ASSETS.fetch(request)
  }
  // Signed out, or the session cannot be checked: a panel page gets the login page; otherwise only the login
  // page's own files, by exact path.
  const path = panelPage ? '/login.html' : pathname
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
  // Every 5 minutes (wrangler.jsonc triggers). Awaited, so a thrown error shows as the run's outcome.
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    await runCron(env, Date.now())
  },
}

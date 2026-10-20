// Gate 1 Worker (Plan 7, Circle user-controlled wallets). Temporary: it ships only in the gate build and goes away
// when main is redeployed. It serves the static site as before and answers /api/ucw/* by calling Circle's
// user-controlled wallets API with the API key, which never reaches the browser.
//
// The key cannot move money on its own: every transaction and signature is a challenge the user approves in Circle's
// UI. The allowlist below still limits what the key can be used for: Arc testnet only, EOA wallets only, and contract
// calls only to USDC and Arc's Multicall3From.

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  CIRCLE_API_KEY: string
  // Shared with the tester only. Stops anyone else from using the key (for example to send login codes to any email).
  GATE_PASSPHRASE: string
}

const CIRCLE = 'https://api.circle.com/v1/w3s'
const ORIGIN = 'https://fundit.fun'
const BLOCKCHAIN = 'ARC-TESTNET'
const ALLOWED_CONTRACTS = new Set([
  '0x3600000000000000000000000000000000000000', // USDC
  '0x522faf9a91c41c443c66765030741e4aace147d0', // Multicall3From
])

type Body = Record<string, unknown>

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

function str(body: Body, key: string, pattern: RegExp): string | null {
  const v = body[key]
  return typeof v === 'string' && pattern.test(v) ? v : null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN = /^[A-Za-z0-9._-]{20,4096}$/
const DEVICE_ID = /^[A-Za-z0-9._-]{8,256}$/
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/
const HEX = /^0x[0-9a-fA-F]*$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

async function circle(env: Env, method: string, path: string, userToken: string | null, body?: Body): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${env.CIRCLE_API_KEY}`, accept: 'application/json' }
  if (userToken) headers['x-user-token'] = userToken
  if (body) headers['content-type'] = 'application/json'
  const res = await fetch(`${CIRCLE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  // Circle's own status and body go back as they are, so the gate page records real error codes.
  return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

// Constant-time compare of the SHA-256 digests, so the passphrase length and prefix do not leak through timing.
async function same(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))])
  return crypto.subtle.timingSafeEqual(x, y)
}

async function api(request: Request, env: Env, route: string): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'POST only' })
  // Same-origin page only. A browser always sends Origin on a cross-site POST.
  if (request.headers.get('origin') !== ORIGIN) return json(403, { error: 'Wrong origin' })
  if (!(await same(request.headers.get('x-gate-passphrase') ?? '', env.GATE_PASSPHRASE))) return json(401, { error: 'Wrong gate passphrase' })
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json(400, { error: 'Bad JSON' })
  }
  const userToken = str(body, 'userToken', TOKEN)
  const idempotencyKey = crypto.randomUUID()

  switch (route) {
    case 'social-token': {
      const deviceId = str(body, 'deviceId', DEVICE_ID)
      if (!deviceId) return json(400, { error: 'deviceId' })
      return circle(env, 'POST', '/users/social/token', null, { idempotencyKey, deviceId })
    }
    case 'email-token': {
      const deviceId = str(body, 'deviceId', DEVICE_ID)
      const email = str(body, 'email', EMAIL)
      if (!deviceId || !email) return json(400, { error: 'deviceId or email' })
      return circle(env, 'POST', '/users/email/token', null, { idempotencyKey, deviceId, email })
    }
    case 'initialize': {
      if (!userToken) return json(400, { error: 'userToken' })
      return circle(env, 'POST', '/user/initialize', userToken, { idempotencyKey, accountType: 'EOA', blockchains: [BLOCKCHAIN] })
    }
    case 'wallets': {
      if (!userToken) return json(400, { error: 'userToken' })
      return circle(env, 'GET', `/wallets?blockchain=${BLOCKCHAIN}`, userToken)
    }
    case 'execute': {
      const walletId = str(body, 'walletId', UUID)
      const contractAddress = str(body, 'contractAddress', ADDRESS)
      const callData = str(body, 'callData', HEX)
      if (!userToken || !walletId || !contractAddress || !callData) return json(400, { error: 'userToken, walletId, contractAddress or callData' })
      if (!ALLOWED_CONTRACTS.has(contractAddress.toLowerCase())) return json(403, { error: 'Contract not allowed' })
      return circle(env, 'POST', '/user/transactions/contractExecution', userToken, {
        idempotencyKey,
        walletId,
        contractAddress,
        callData,
        feeLevel: 'MEDIUM',
      })
    }
    case 'sign-message': {
      const walletId = str(body, 'walletId', UUID)
      const message = typeof body.message === 'string' && body.message.length <= 500 ? body.message : null
      if (!userToken || !walletId || !message) return json(400, { error: 'userToken, walletId or message' })
      return circle(env, 'POST', '/user/sign/message', userToken, { walletId, message })
    }
    case 'transaction': {
      const id = str(body, 'id', UUID)
      if (!userToken || !id) return json(400, { error: 'userToken or id' })
      return circle(env, 'GET', `/transactions/${id}`, userToken)
    }
    case 'refresh': {
      const refreshToken = str(body, 'refreshToken', TOKEN)
      const deviceId = str(body, 'deviceId', DEVICE_ID)
      if (!userToken || !refreshToken || !deviceId) return json(400, { error: 'userToken, refreshToken or deviceId' })
      return circle(env, 'POST', '/users/token/refresh', userToken, { idempotencyKey, refreshToken, deviceId })
    }
    default:
      return json(404, { error: 'Unknown route' })
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname.startsWith('/api/ucw/')) {
      if (!env.CIRCLE_API_KEY || !env.GATE_PASSPHRASE) return json(503, { error: 'CIRCLE_API_KEY or GATE_PASSPHRASE is not set' })
      return api(request, env, pathname.slice('/api/ucw/'.length))
    }
    return env.ASSETS.fetch(request)
  },
}

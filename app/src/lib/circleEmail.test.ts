import { getAddress } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ADDRESS = '0x1d5c39510e1144f99dbf69eb0089673438354e22'
const WALLET_ID = '6f1c1b1e-1c1a-4b5e-8a3b-2a1d1e1f1a1b'
const TOKENS = { userToken: 'user-token-'.padEnd(40, 'u'), encryptionKey: 'enc-key-'.padEnd(40, 'k'), refreshToken: 'refresh-token-'.padEnd(40, 'r') }
const LOGIN_VALUES = { deviceToken: 'device-token-'.padEnd(40, 'd'), deviceEncryptionKey: 'device-key-'.padEnd(40, 'e'), otpToken: 'otp-token-'.padEnd(40, 'o') }

type LoginCallback = (error: { code?: number; message: string } | undefined, result: typeof TOKENS | undefined) => void
type ChallengeCallback = (error: { code?: number; message: string } | undefined, result: unknown) => void

// A stand-in for Circle's SDK: verifyOtp answers as if the person typed the right code, execute as if they approved.
const sdk = vi.hoisted(() => {
  const s = {
    onLogin: null as LoginCallback | null,
    setThemeColor: vi.fn(),
    getDeviceId: vi.fn(async () => 'device-id-0001'),
    updateConfigs: vi.fn((_configs: unknown, onLogin: LoginCallback) => {
      s.onLogin = onLogin
    }),
    setOnResendOtpEmail: vi.fn(),
    setAuthentication: vi.fn(),
    verifyOtp: vi.fn(() => s.onLogin?.(undefined, { userToken: '', encryptionKey: '', refreshToken: '' })),
    execute: vi.fn((_id: string, done: ChallengeCallback) => done(undefined, { type: 'INITIALIZE', status: 'COMPLETE' })),
  }
  return s
})
vi.mock('@circle-fin/w3s-pw-web-sdk', () => ({
  W3SSdk: vi.fn(function W3SSdk() {
    return sdk
  }),
}))

const fetchMock = vi.fn()

function answer(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

// Answers each Worker route as the real Worker would for this flow.
function worker(routes: Record<string, (() => Response) | Response[]>) {
  fetchMock.mockImplementation(async (url: string) => {
    const name = url.replace('/api/ucw/', '')
    const r = routes[name]
    if (!r) return answer(404, { error: 'Unknown route' })
    if (Array.isArray(r)) return r.shift() ?? answer(500, { error: 'no more answers' })
    return r()
  })
}

function bodies(route: string): Record<string, unknown>[] {
  return fetchMock.mock.calls.filter(([url]) => url === `/api/ucw/${route}`).map(([, init]) => JSON.parse((init as RequestInit).body as string) as Record<string, unknown>)
}

async function load() {
  vi.resetModules()
  return import('./circleEmail')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  sdk.verifyOtp.mockImplementation(() => sdk.onLogin?.(undefined, { ...TOKENS }))
  // mockReset drops any once-answer a failed test left queued.
  sdk.execute.mockReset()
  sdk.execute.mockImplementation((_id: string, done: ChallengeCallback) => done(undefined, { type: 'INITIALIZE', status: 'COMPLETE' }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
})

const wallets = () => answer(200, { data: { wallets: [{ id: WALLET_ID, address: ADDRESS, blockchain: 'EVM-TESTNET', accountType: 'EOA' }] } })

describe('circleEmail', () => {
  // Circle answers 155106 when the person already has a wallet. Running a create challenge again would fail.
  it('existing person (155106) lists wallets without a challenge', async () => {
    worker({
      'email-token': () => answer(200, LOGIN_VALUES),
      login: () => answer(200, { ok: true }),
      initialize: () => answer(409, { code: 155106, message: 'User already initialized' }),
      wallets,
    })
    const { openEmailAccount, sendEmailCode } = await load()
    await sendEmailCode('ana@example.com', 'turnstile-token')
    const session = await openEmailAccount('ana@example.com')
    expect(sdk.execute).not.toHaveBeenCalled()
    expect(session).toEqual({ address: getAddress(ADDRESS), walletId: WALLET_ID, email: 'ana@example.com' })
  })

  // A new person approves Circle's create step once; only then does the wallet exist to list.
  it('new person runs the create challenge then lists wallets', async () => {
    worker({
      'email-token': () => answer(200, LOGIN_VALUES),
      login: () => answer(200, { ok: true }),
      initialize: () => answer(200, { data: { challengeId: 'create-1' } }),
      wallets: [answer(200, { data: { wallets: [] } }), wallets()],
    })
    const { openEmailAccount, sendEmailCode } = await load()
    await sendEmailCode('ana@example.com', 'turnstile-token')
    // The wallet can take a moment to appear after the create step, so the first empty list is read again.
    const session = await openEmailAccount('ana@example.com')
    expect(sdk.execute).toHaveBeenCalledTimes(1)
    expect(sdk.execute.mock.calls[0]![0]).toBe('create-1')
    // The challenge runs with the tokens from this login.
    expect(sdk.setAuthentication).toHaveBeenCalledWith({ userToken: TOKENS.userToken, encryptionKey: TOKENS.encryptionKey })
    expect(sdk.execute.mock.invocationCallOrder[0]!).toBeLessThan(fetchMock.mock.invocationCallOrder.at(-1)!)
    expect(bodies('wallets')).toHaveLength(2)
    expect(session.walletId).toBe(WALLET_ID)
  })

  // Another tab refreshed the session, so this tab still holds an old user token. The Worker call works on the
  // fresh cookies, but Circle's window refuses the old token with 155104. One refresh and the same challenge again.
  it('runChallenge refreshes once and retries the same challenge after an SDK 155104', async () => {
    const FRESH = { userToken: 'fresh-user-'.padEnd(40, 'f'), encryptionKey: 'fresh-key-'.padEnd(40, 'g') }
    worker({ session: () => answer(200, FRESH) })
    const { runChallenge } = await load()
    const { saveEmailTokens, readEmailTokens } = await import('./emailAccount')
    saveEmailTokens({ userToken: TOKENS.userToken, encryptionKey: TOKENS.encryptionKey })
    sdk.execute
      .mockImplementationOnce((_id: string, done: ChallengeCallback) => done({ code: 155104, message: 'Token expired' }, undefined))
      .mockImplementationOnce((_id: string, done: ChallengeCallback) => done(undefined, { data: { signedTransaction: '0xabc' } }))
    const outcome = await runChallenge('sign-1')
    expect(outcome).toEqual({ kind: 'done', data: { signedTransaction: '0xabc' } })
    expect(sdk.execute.mock.calls.map((c) => c[0])).toEqual(['sign-1', 'sign-1'])
    expect(bodies('session')).toHaveLength(1)
    expect(sdk.setAuthentication.mock.calls.map((c) => c[0])).toEqual([
      { userToken: TOKENS.userToken, encryptionKey: TOKENS.encryptionKey },
      FRESH,
    ])
    expect(readEmailTokens()).toEqual(FRESH)
  })

  it('runChallenge throws a second 155104 after one refresh', async () => {
    const FRESH = { userToken: 'fresh-user-'.padEnd(40, 'f'), encryptionKey: 'fresh-key-'.padEnd(40, 'g') }
    worker({ session: () => answer(200, FRESH) })
    const { runChallenge } = await load()
    const { saveEmailTokens } = await import('./emailAccount')
    saveEmailTokens({ userToken: TOKENS.userToken, encryptionKey: TOKENS.encryptionKey })
    sdk.execute.mockImplementation((_id: string, done: ChallengeCallback) => done({ code: 155104, message: 'Token expired' }, undefined))
    await expect(runChallenge('sign-1')).rejects.toMatchObject({ code: 155104 })
    expect(sdk.execute).toHaveBeenCalledTimes(2)
    expect(bodies('session')).toHaveLength(1)
  })

  // localStorage outlives the tab and any script on the origin can read it. The tokens may sit only in memory and
  // sessionStorage, and go to the Worker once, at login, for its HttpOnly cookies.
  it('tokens never reach localStorage', async () => {
    worker({
      'email-token': () => answer(200, LOGIN_VALUES),
      login: () => answer(200, { ok: true }),
      initialize: () => answer(200, { data: { challengeId: 'create-1' } }),
      wallets,
    })
    const { openEmailAccount, sendEmailCode } = await load()
    await sendEmailCode('ana@example.com', 'turnstile-token')
    await openEmailAccount('ana@example.com')
    const secrets = [...Object.values(TOKENS), ...Object.values(LOGIN_VALUES)]
    const stored = Object.keys(localStorage).map((k) => `${k}=${localStorage.getItem(k)}`).join('\n')
    for (const s of secrets) expect(stored).not.toContain(s)
    // The login route is the only one that carries them.
    expect(bodies('login')).toEqual([TOKENS])
    const others = fetchMock.mock.calls.filter(([url]) => url !== '/api/ucw/login').map(([, init]) => String((init as RequestInit).body))
    for (const s of Object.values(TOKENS)) for (const b of others) expect(b).not.toContain(s)
    expect(bodies('email-token')).toEqual([{ deviceId: 'device-id-0001', email: 'ana@example.com', turnstile: 'turnstile-token' }])
  })
})

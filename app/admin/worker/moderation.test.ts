// @vitest-environment node
import { readFileSync } from 'node:fs'
import { encodeFunctionResult, parseAbi, type Address } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NETWORKS_WORKER, type WorkerNetwork } from '../../worker/networks'
import worker, { type Env } from './index'
import { listStates, setState, stateHistory } from './moderation'
import { clearOwnerCache } from './owner'
import { SESSION_COOKIE, SESSION_TTL_SEC, signSession } from './session'
import { sqliteDb } from './testing/sqliteDb'

const ORIGIN = 'https://admin.fundit.fun'
const NOW = Date.UTC(2026, 9, 25, 12, 0, 0)
const MOD_SCHEMA = readFileSync(new URL('../../moderation/migrations/0001_fundit_state.sql', import.meta.url), 'utf8')
const SECRET = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256)))
const ownerAbi = parseAbi(['function owner() view returns (address)'])
const owner = privateKeyToAccount(generatePrivateKey())
const other = privateKeyToAccount(generatePrivateKey())
const FUNDIT = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01'

describe('moderation library', () => {
  it('upserts a state and lists it', async () => {
    const db = sqliteDb(MOD_SCHEMA)
    await setState(db, 'testnet', FUNDIT, 'review', 'looks odd', 1000)
    await setState(db, 'testnet', FUNDIT, 'removed', 'confirmed', 2000)
    expect(await listStates(db, 'testnet')).toEqual([{ address: FUNDIT.toLowerCase(), state: 'removed', note: 'confirmed', updatedAt: 2000 }])
    expect(await listStates(db, 'mainnet')).toEqual([])
  })

  it('logs the old state on a change, null for the first', async () => {
    const db = sqliteDb(MOD_SCHEMA)
    await setState(db, 'testnet', FUNDIT, 'review', 'a', 1000)
    await setState(db, 'testnet', FUNDIT, 'cleared', 'b', 2000)
    const history = await stateHistory(db, 'testnet', FUNDIT)
    expect(history).toEqual([
      { oldState: 'review', newState: 'cleared', note: 'b', at: 2000 },
      { oldState: null, newState: 'review', note: 'a', at: 1000 },
    ])
  })

  it('stores the address lowercase and reads history by any casing', async () => {
    const db = sqliteDb(MOD_SCHEMA)
    await setState(db, 'mainnet', FUNDIT, 'review', '', 1)
    const row = await db.prepare('SELECT address FROM fundit_state').first<{ address: string }>()
    expect(row?.address).toBe(FUNDIT.toLowerCase())
    expect(await stateHistory(db, 'mainnet', FUNDIT.toUpperCase().replace('0X', '0x'))).toHaveLength(1)
  })

  it('returns history newest first even when times tie', async () => {
    const db = sqliteDb(MOD_SCHEMA)
    await setState(db, 'testnet', FUNDIT, 'review', '1', 5)
    await setState(db, 'testnet', FUNDIT, 'removed', '2', 5)
    expect((await stateHistory(db, 'testnet', FUNDIT)).map((h) => h.note)).toEqual(['2', '1'])
  })
})

let owners: Record<WorkerNetwork, Address>
let rpcDown: Set<WorkerNetwork>

beforeEach(() => {
  clearOwnerCache()
  owners = { testnet: owner.address, mainnet: owner.address }
  rpcDown = new Set()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const net: WorkerNetwork = url === NETWORKS_WORKER.testnet.rpcUrl ? 'testnet' : 'mainnet'
      if (url !== NETWORKS_WORKER.testnet.rpcUrl && url !== NETWORKS_WORKER.mainnet.rpcUrl) throw new Error('unexpected fetch')
      if (rpcDown.has(net)) throw new TypeError('fetch failed')
      return Response.json({ jsonrpc: '2.0', id: 1, result: encodeFunctionResult({ abi: ownerAbi, functionName: 'owner', result: owners[net] }) })
    }),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function env(over: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('x') },
    ADMIN_DB: sqliteDb(''),
    MOD_DB: sqliteDb(MOD_SCHEMA),
    ADMIN_ORIGIN: ORIGIN,
    ADMIN_SESSION_SECRET: SECRET,
    TURNSTILE_SECRET: 'turnstile-secret',
    ...over,
  }
}

async function cookie(address: Address = owner.address): Promise<string> {
  const iat = Math.floor(NOW / 1000)
  const value = await signSession({ v: 2, address: address.toLowerCase() as Address, iat, exp: iat + SESSION_TTL_SEC }, SECRET)
  return `${SESSION_COOKIE}=${value}`
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/admin/moderation`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}
const get = (path: string, c?: string) => new Request(`${ORIGIN}/api/admin/${path}`, { headers: c ? { cookie: c } : {} })
const valid = { network: 'testnet', address: FUNDIT, state: 'review', note: 'why' }

describe('moderation endpoints', () => {
  it('refuses POST without a session with 401', async () => {
    expect((await worker.fetch(post(valid), env())).status).toBe(401)
  })

  it('refuses POST from another origin with 403', async () => {
    const res = await worker.fetch(post(valid, { cookie: await cookie(), origin: 'https://evil.example' }), env())
    expect(res.status).toBe(403)
  })

  it('refuses a change on a network the session does not own with 403', async () => {
    owners.mainnet = other.address
    const e = env()
    const res = await worker.fetch(post({ ...valid, network: 'mainnet' }, { cookie: await cookie() }), e)
    expect(res.status).toBe(403)
    expect(await listStates(e.MOD_DB!, 'mainnet')).toEqual([])
    const ok = await worker.fetch(post(valid, { cookie: await cookie() }), e)
    expect(ok.status).toBe(200)
  })

  it('refuses reads on a network the session does not own, and answers 503 when the owner read failed', async () => {
    owners.mainnet = other.address
    const e = env()
    expect((await worker.fetch(get('moderation?network=mainnet', await cookie()), e)).status).toBe(403)
    expect((await worker.fetch(get(`moderation/history?network=mainnet&address=${FUNDIT}`, await cookie()), e)).status).toBe(403)
    clearOwnerCache()
    rpcDown.add('mainnet')
    expect((await worker.fetch(get('moderation?network=mainnet', await cookie()), e)).status).toBe(503)
  })

  it('rejects state "hidden", a non-address, a long note and a bad network with 400', async () => {
    const c = await cookie()
    for (const bad of [{ state: 'hidden' }, { address: '0x123' }, { note: 'x'.repeat(501) }, { note: 5 }, { network: 'devnet' }]) {
      const res = await worker.fetch(post({ ...valid, ...bad }, { cookie: c }), env())
      expect(res.status).toBe(400)
    }
  })

  it('accepts an empty note and a 500 character note', async () => {
    const c = await cookie()
    expect((await worker.fetch(post({ ...valid, note: '' }, { cookie: c }), env())).status).toBe(200)
    expect((await worker.fetch(post({ ...valid, note: 'x'.repeat(500) }, { cookie: c }), env())).status).toBe(200)
  })

  it('writes, lists and returns history', async () => {
    const e = env()
    const c = await cookie()
    const res = await worker.fetch(post(valid, { cookie: c }), e)
    expect(await res.json()).toEqual({ ok: true })
    await worker.fetch(post({ ...valid, state: 'removed', note: 'bad' }, { cookie: c }), e)
    const list = await worker.fetch(get('moderation?network=testnet', c), e)
    expect(await list.json()).toEqual({ states: [{ address: FUNDIT.toLowerCase(), state: 'removed', note: 'bad', updatedAt: NOW }] })
    const hist = (await (await worker.fetch(get(`moderation/history?network=testnet&address=${FUNDIT}`, c), e)).json()) as { history: { oldState: string | null }[] }
    expect(hist.history.map((h) => h.oldState)).toEqual(['review', null])
    expect((await worker.fetch(get('moderation/history?network=testnet&address=nope', c), e)).status).toBe(400)
  })

  it('answers 503 when MOD_DB is missing, and leaves other endpoints alone', async () => {
    const e = env({ MOD_DB: undefined })
    const c = await cookie()
    expect((await worker.fetch(post(valid, { cookie: c }), e)).status).toBe(503)
    expect((await worker.fetch(get('moderation?network=testnet', c), e)).status).toBe(503)
    expect((await worker.fetch(get('session', c), e)).status).toBe(200)
  })
})

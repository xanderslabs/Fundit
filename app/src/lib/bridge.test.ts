import { type Address, type EIP1193Provider, getAddress, type Hex } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearBridge, clearPendingArc, donateCrossChain, pendingArc, pendingBridges, savePendingArc } from './bridge'
import { explainError } from './errors'

const CAMPAIGN = getAddress('0x00000000000000000000000000000000000000a1')
const OTHER = getAddress('0x00000000000000000000000000000000000000b2')
const BURN = `0x${'cd'.repeat(32)}` as Hex
const KEY = 'fundit.pendingBridges'

type Handler = (payload: { values: Record<string, unknown> }) => void
type BridgeFn = (params: Record<string, unknown>, emit: (name: string, values: Record<string, unknown>) => void) => Promise<unknown>

const kit: { config?: unknown; params?: Record<string, unknown>; bridge: BridgeFn } = {
  bridge: () => new Promise(() => {}),
}

vi.mock('@circle-fin/bridge-kit', () => ({
  BridgeKit: class {
    handlers = new Map<string, Handler[]>()
    constructor(config: unknown) {
      kit.config = config
    }
    on(name: string, h: Handler) {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), h])
    }
    off(name: string, h: Handler) {
      this.handlers.set(name, (this.handlers.get(name) ?? []).filter((x) => x !== h))
    }
    bridge(params: Record<string, unknown>) {
      kit.params = params
      return kit.bridge(params, (name, values) => this.handlers.get(name)?.forEach((h) => h({ values })))
    }
  },
}))
vi.mock('@circle-fin/adapter-viem-v2', () => ({
  createViemAdapterFromProvider: async (p: unknown) => ({ fake: 'adapter', params: p }),
}))

const provider = { request: async () => null } as unknown as EIP1193Provider

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  kit.bridge = () => new Promise(() => {})
  kit.params = undefined
})

describe('pending store', () => {
  // Private windows and blocked storage throw on access. The page must still load and donate.
  it('pendingBridges survives a localStorage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(pendingBridges()).toEqual([])
    expect(() => clearBridge(BURN)).not.toThrow()
    expect(pendingArc(CAMPAIGN)).toBeNull()
  })

  it('ignores corrupt or foreign data under the key', () => {
    localStorage.setItem(KEY, '{not json')
    expect(pendingBridges()).toEqual([])
    localStorage.setItem(KEY, JSON.stringify([{ kind: 'bridge', campaign: 'javascript:alert(1)', burnTx: 'x' }, 42, null]))
    expect(pendingBridges()).toEqual([])
  })

  // An unconfirmed Arc donation must still block a second donation after a reload.
  it('keeps one unconfirmed Arc donation per campaign, apart from bridges', () => {
    savePendingArc({ campaign: CAMPAIGN, hash: BURN, approve: false })
    expect(pendingArc(CAMPAIGN)).toMatchObject({ kind: 'arc', campaign: CAMPAIGN, hash: BURN, approve: false })
    expect(pendingArc(OTHER)).toBeNull()
    expect(pendingBridges()).toEqual([])
    clearPendingArc(CAMPAIGN)
    expect(pendingArc(CAMPAIGN)).toBeNull()
  })
})

describe('donateCrossChain', () => {
  const run = (over: Partial<Parameters<typeof donateCrossChain>[0]> = {}) =>
    donateCrossChain({ provider, sourceKey: 'Base', campaign: CAMPAIGN, amount: '25', fast: true, ...over })

  // The mint can take 20 minutes. The donor must get the burn hash (and a tracker) as soon as it exists,
  // and the record must be saved then, because the mint still happens if the tab closes.
  it('returns at the burn and saves it, while the bridge is still running', async () => {
    kit.bridge = (_p, emit) => {
      emit('approve', { name: 'approve', state: 'success', txHash: `0x${'aa'.repeat(32)}` })
      emit('burn', { name: 'burn', state: 'success', txHash: BURN })
      return new Promise(() => {})
    }
    const res = await run()
    expect(res).toEqual({ burnTx: BURN, srcDomain: 6 })
    expect(pendingBridges()).toEqual([
      expect.objectContaining({ kind: 'bridge', campaign: CAMPAIGN, burnTx: BURN, srcDomain: 6, amount: '25' }),
    ])
  })

  // The USDC must mint straight to the campaign contract on Arc, via the forwarder, with telemetry off.
  it('sends to the campaign on Arc with the forwarder and the chosen speed', async () => {
    kit.bridge = (_p, emit) => {
      emit('burn', { name: 'burn', state: 'success', txHash: BURN })
      return new Promise(() => {})
    }
    await run({ sourceKey: 'Polygon', fast: false, amount: '10.5' })
    expect(kit.config).toEqual({ disableErrorReporting: true })
    expect(kit.params).toMatchObject({
      from: { chain: 'Polygon' },
      to: { chain: 'Arc', recipientAddress: CAMPAIGN, useForwarder: true },
      amount: '10.5',
      config: { transferSpeed: 'SLOW' },
    })
    expect(pendingBridges()[0]).toMatchObject({ srcDomain: 7 })
  })

  it('refuses Fast on a chain where CCTP does not offer it', async () => {
    await expect(run({ sourceKey: 'Avalanche', fast: true })).rejects.toThrow(/Fast/)
    expect(kit.params).toBeUndefined()
  })

  it('rejects, and saves nothing, when the donor cancels in the wallet', async () => {
    kit.bridge = async () => ({
      state: 'error',
      steps: [{ name: 'approve', state: 'error', errorCategory: 'user_rejected', errorMessage: 'User rejected the request.' }],
    })
    const err = await run().catch((e: unknown) => e)
    expect(explainError(err)).toBe('You cancelled the request.')
    expect(pendingBridges()).toEqual([])
  })

  // A burn that reverted moved no money, so it must not be tracked as an incoming donation.
  it('rejects on a reverted burn and saves nothing', async () => {
    kit.bridge = async (_p, emit) => {
      const burn = { name: 'burn', state: 'error', txHash: BURN, errorCategory: 'reverted_onchain', errorMessage: 'Transaction reverted' }
      emit('burn', burn)
      return { state: 'error', steps: [burn] }
    }
    await expect(run()).rejects.toThrow(/reverted/)
    expect(pendingBridges()).toEqual([])
  })

  // A burn whose receipt wait timed out may still be mined. Track it rather than invite a second donation.
  it('tracks a burn whose confirmation timed out', async () => {
    kit.bridge = async (_p, emit) => {
      const burn = { name: 'burn', state: 'error', txHash: BURN, errorCategory: 'polling_timeout' }
      emit('burn', burn)
      return { state: 'error', steps: [burn] }
    }
    expect(await run()).toEqual({ burnTx: BURN, srcDomain: 6 })
    expect(pendingBridges()).toHaveLength(1)
  })

  it('still returns the burn when saving it fails', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    kit.bridge = (_p, emit) => {
      emit('burn', { name: 'burn', state: 'success', txHash: BURN })
      return new Promise(() => {})
    }
    expect(await run()).toEqual({ burnTx: BURN, srcDomain: 6 })
  })

  it('clearBridge removes only that transfer', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { kind: 'bridge', campaign: CAMPAIGN, burnTx: BURN, srcDomain: 6, amount: '1', createdAt: 1 },
        { kind: 'bridge', campaign: OTHER, burnTx: `0x${'ee'.repeat(32)}`, srcDomain: 0, amount: '2', createdAt: 2 },
      ]),
    )
    clearBridge(BURN)
    expect(pendingBridges().map((b) => b.campaign as Address)).toEqual([OTHER])
  })
})

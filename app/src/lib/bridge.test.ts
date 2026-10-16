import { type Address, type EIP1193Provider, getAddress, type Hex, UserRejectedRequestError } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearBridge, clearPendingArc, donateCrossChain, pendingArc, pendingBridges, pendingCrossChain, savePendingArc } from './bridge'
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
const adapterCalls: { provider: EIP1193Provider }[] = []
vi.mock('@circle-fin/adapter-viem-v2', () => ({
  createViemAdapterFromProvider: async (p: { provider: EIP1193Provider }) => {
    adapterCalls.push(p)
    return { fake: 'adapter', params: p }
  },
}))

// What the wallet would do: the adapter sends through the wrapped provider it was given.
const walletSend = (method = 'eth_sendTransaction') =>
  adapterCalls.at(-1)!.provider.request({ method, params: [] } as never)

const newProvider = () => ({ request: async () => `0x${'aa'.repeat(32)}` }) as unknown as EIP1193Provider
let provider = newProvider()

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  kit.bridge = () => new Promise(() => {})
  kit.params = undefined
  provider = newProvider()
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
  // Old reminders must not pile up forever.
  it('prunes entries older than 7 days on read', () => {
    const old = Date.now() - 7 * 24 * 60 * 60 * 1000 - 1
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { kind: 'bridge', campaign: CAMPAIGN, burnTx: BURN, srcDomain: 6, amount: '1', createdAt: old },
        { kind: 'arc', campaign: CAMPAIGN, hash: BURN, approve: false, createdAt: old },
        { kind: 'bridge', campaign: OTHER, burnTx: BURN, srcDomain: 6, amount: '1', createdAt: Date.now() },
      ]),
    )
    expect(pendingArc(CAMPAIGN)).toBeNull()
    expect(pendingBridges().map((b) => b.campaign)).toEqual([OTHER])
  })

  it('keeps the first createdAt when the same Arc transaction is saved again', () => {
    // The age decides the "more than a day ago" warning, so a re-save on mount must not reset it.
    const t = Date.now() - 5000
    localStorage.setItem(KEY, JSON.stringify([{ kind: 'arc', campaign: CAMPAIGN, hash: BURN, approve: false, createdAt: t }]))
    savePendingArc({ campaign: CAMPAIGN, hash: BURN, approve: false })
    expect(pendingArc(CAMPAIGN)!.createdAt).toBe(t)
  })

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

  // Sequential wallets: the adapter wraps the rejection in a KitError, and the step category is only 'unknown'.
  it('reads a rejection wrapped in a KitError trace as a cancel', async () => {
    kit.bridge = async () => ({
      state: 'error',
      steps: [
        {
          name: 'approve',
          state: 'error',
          errorCategory: 'unknown',
          errorMessage: 'Unknown blockchain error on Base',
          error: { name: 'KitError', cause: { trace: { rawError: new UserRejectedRequestError(new Error('x')) } } },
        },
      ],
    })
    const err = await run().catch((e: unknown) => e)
    expect(explainError(err)).toBe('You cancelled the request.')
  })

  // If the tab closes between the wallet sending and the burn event, the donor must still see something.
  it('saves a submitted record on the first wallet send, then upgrades it with the burn hash', async () => {
    let emitBurn: () => void = () => {}
    kit.bridge = (_p, emit) => {
      emitBurn = () => emit('burn', { name: 'burn', state: 'success', txHash: BURN })
      return walletSend().then(() => new Promise(() => {}))
    }
    const pending = run()
    await vi.waitFor(() => expect(pendingCrossChain()).toHaveLength(1))
    const submitted = pendingCrossChain()[0]!
    expect(submitted).toMatchObject({ kind: 'submitted', campaign: CAMPAIGN, srcDomain: 6 })
    emitBurn()
    await pending
    expect(pendingCrossChain()).toEqual([
      expect.objectContaining({ kind: 'bridge', burnTx: BURN, createdAt: submitted.createdAt }),
    ])
  })

  it('clears the submitted record when the flow fails before the burn', async () => {
    kit.bridge = async () => {
      await walletSend()
      expect(pendingCrossChain()).toHaveLength(1)
      return { state: 'error', steps: [{ name: 'burn', state: 'error', errorCategory: 'user_rejected', errorMessage: 'rejected' }] }
    }
    await expect(run()).rejects.toThrow()
    expect(pendingCrossChain()).toEqual([])
  })

  it('creates the kit and adapter once per wallet', async () => {
    kit.bridge = (_p, emit) => {
      emit('burn', { name: 'burn', state: 'success', txHash: BURN })
      return new Promise(() => {})
    }
    const before = adapterCalls.length
    await run()
    await run({ sourceKey: 'Ethereum' })
    expect(adapterCalls.length - before).toBe(1)
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
        { kind: 'bridge', campaign: CAMPAIGN, burnTx: BURN, srcDomain: 6, amount: '1', createdAt: Date.now() },
        { kind: 'bridge', campaign: OTHER, burnTx: `0x${'ee'.repeat(32)}`, srcDomain: 0, amount: '2', createdAt: Date.now() },
      ]),
    )
    clearBridge(BURN)
    expect(pendingBridges().map((b) => b.campaign as Address)).toEqual([OTHER])
  })
})

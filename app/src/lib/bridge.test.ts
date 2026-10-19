import { type Address, type EIP1193Provider, getAddress, type Hex, UserRejectedRequestError } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  blockingEntry,
  clearBridge,
  clearPendingArc,
  donateCrossChain,
  markBridgeMinted,
  pendingArc,
  pendingBridges,
  pendingCrossChain,
  pendingPayoutFrom,
  pendingPayouts,
  savePendingArc,
  savePendingPayout,
} from './bridge'
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

const ACCOUNT_A = '0x1111111111111111111111111111111111111111'
const ACCOUNT_B = '0x2222222222222222222222222222222222222222'
// The account the fake wallet reports. A wallet keeps one provider object across account switches.
const wallet = { account: ACCOUNT_A }
const newProvider = () =>
  ({
    request: async ({ method }: { method: string }) => (method === 'eth_accounts' ? [wallet.account] : `0x${'aa'.repeat(32)}`),
  }) as unknown as EIP1193Provider
let provider = newProvider()

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  kit.bridge = () => new Promise(() => {})
  kit.params = undefined
  provider = newProvider()
  wallet.account = ACCOUNT_A
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

  // Testnet entries on domains 0 and 6 look valid on mainnet, which would then poll mainnet Iris for them.
  it('keeps testnet entries under their own key, apart from mainnet ones', async () => {
    const entry = { kind: 'arc', campaign: CAMPAIGN, hash: BURN, approve: false, createdAt: Date.now() }
    localStorage.setItem(KEY, JSON.stringify([entry]))
    vi.stubEnv('VITE_ARC_NETWORK', 'testnet')
    vi.resetModules()
    try {
      const fresh = await import('./bridge')
      expect(fresh.pendingArc(CAMPAIGN)).toBeNull()
      localStorage.setItem('fundit.testnet.pendingBridges', JSON.stringify([entry]))
      expect(fresh.pendingArc(CAMPAIGN)).toMatchObject({ hash: BURN })
      fresh.clearPendingArc(CAMPAIGN)
      expect(localStorage.getItem('fundit.testnet.pendingBridges')).toBeNull()
      expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual([entry])
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
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

// A payout burns on Arc and mints to the organiser's address on another chain. It is tracked like a
// transfer into Arc but is money leaving the campaign, so it must never block a donation.
describe('pending payouts', () => {
  afterEach(() => localStorage.clear())

  it('saves a payout from Arc (domain 26) and lists it apart from cross-chain donations', () => {
    savePendingPayout({ campaign: CAMPAIGN, burnTx: BURN, destDomain: 6, amount: '9.9' })
    expect(pendingPayouts()).toMatchObject([{ kind: 'payout', campaign: CAMPAIGN, burnTx: BURN, srcDomain: 26, destDomain: 6, amount: '9.9' }])
    expect(pendingCrossChain()).toEqual([])
    expect(pendingBridges()).toEqual([])
  })

  it('never blocks a donation to the campaign', () => {
    savePendingPayout({ campaign: CAMPAIGN, burnTx: BURN, destDomain: 6, amount: '9.9' })
    expect(blockingEntry(CAMPAIGN)).toBeNull()
  })

  it('is marked minted and cleared by its burn hash', () => {
    savePendingPayout({ campaign: CAMPAIGN, burnTx: BURN, destDomain: 6, amount: '9.9' })
    markBridgeMinted(BURN)
    expect(pendingPayouts()[0]!.minted).toBe(true)
    clearBridge(BURN)
    expect(pendingPayouts()).toEqual([])
  })

  // A Fundit account's own send to another chain is saved the same way, keyed by the account. While it has not
  // arrived, a second one waits, so the person does not send twice by mistake.
  it('finds the unarrived payout from an address, and lets go once it arrived', () => {
    expect(pendingPayoutFrom(CAMPAIGN)).toBeNull()
    savePendingPayout({ campaign: CAMPAIGN, burnTx: BURN, destDomain: 6, amount: '9.9' })
    expect(pendingPayoutFrom(CAMPAIGN.toLowerCase() as Address)).toMatchObject({ burnTx: BURN })
    expect(pendingPayoutFrom(OTHER)).toBeNull()
    markBridgeMinted(BURN)
    expect(pendingPayoutFrom(CAMPAIGN)).toBeNull()
  })

  it('ignores a payout entry with an unknown destination', () => {
    localStorage.setItem(KEY, JSON.stringify([{ kind: 'payout', campaign: CAMPAIGN, burnTx: BURN, srcDomain: 26, destDomain: 99, amount: '1', createdAt: Date.now() }]))
    expect(pendingPayouts()).toEqual([])
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

  // Bridge Kit names testnet chains differently. 'Base' and 'Arc' there would mean the mainnets.
  it('uses the testnet Bridge Kit chain names on testnet', async () => {
    vi.stubEnv('VITE_ARC_NETWORK', 'testnet')
    vi.resetModules()
    try {
      const fresh = await import('./bridge')
      kit.bridge = (_p, emit) => {
        emit('burn', { name: 'burn', state: 'success', txHash: BURN })
        return new Promise(() => {})
      }
      await fresh.donateCrossChain({ provider, sourceKey: 'Base', campaign: CAMPAIGN, amount: '25', fast: true })
      expect(kit.params).toMatchObject({ from: { chain: 'Base_Sepolia' }, to: { chain: 'Arc_Testnet' } })
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
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
    expect(explainError(err)).toBe("You cancelled the request. Try again when you're ready.")
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
    expect(explainError(err)).toBe("You cancelled the request. Try again when you're ready.")
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

  // The adapter caches the account it first sees. After a switch it must not estimate or send as the old one.
  it('builds a new adapter after the wallet switches account, and bridges with it', async () => {
    kit.bridge = (_p, emit) => {
      emit('burn', { name: 'burn', state: 'success', txHash: BURN })
      return new Promise(() => {})
    }
    const before = adapterCalls.length
    await run()
    const first = (kit.params!.from as { adapter: unknown }).adapter
    wallet.account = ACCOUNT_B
    await run()
    expect(adapterCalls.length - before).toBe(2)
    const second = (kit.params!.from as { adapter: unknown }).adapter
    expect(second).not.toBe(first)
    // The new adapter's provider answers with the new account.
    const accounts = await adapterCalls.at(-1)!.provider.request({ method: 'eth_accounts' } as never)
    expect(accounts).toEqual([ACCOUNT_B])
  })

  // Some wallets throw on eth_accounts while locked. That must not stop the donation from starting.
  it('still bridges when eth_accounts throws', async () => {
    provider = {
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_accounts') throw new Error('locked')
        return `0x${'aa'.repeat(32)}`
      },
    } as unknown as EIP1193Provider
    kit.bridge = (_p, emit) => {
      emit('burn', { name: 'burn', state: 'success', txHash: BURN })
      return new Promise(() => {})
    }
    expect(await run()).toEqual({ burnTx: BURN, srcDomain: 6 })
  })

  // The provider can still report the old account after a switch. The account wagmi shows wins.
  it('keys the adapter on the given account, not on eth_accounts', async () => {
    kit.bridge = (_p, emit) => {
      emit('burn', { name: 'burn', state: 'success', txHash: BURN })
      return new Promise(() => {})
    }
    const before = adapterCalls.length
    await run({ account: ACCOUNT_A })
    // eth_accounts still says A, but the connected account is now B.
    await run({ account: ACCOUNT_B })
    expect(adapterCalls.length - before).toBe(2)
    await run({ account: ACCOUNT_B })
    expect(adapterCalls.length - before).toBe(2)
  })

  // A frozen provider object must still work: a plain wrapper, not a Proxy with invariants to break.
  it('works with a frozen wallet provider', async () => {
    provider = Object.freeze(newProvider())
    kit.bridge = (_p, emit) => walletSend().then(() => {
      emit('burn', { name: 'burn', state: 'success', txHash: BURN })
      return new Promise(() => {})
    })
    expect(await run()).toEqual({ burnTx: BURN, srcDomain: 6 })
  })

  // Batched sends can fail with no hash after the wallet already sent. The outcome is unknown, so keep the record.
  it('keeps the submitted record when a step fails without a hash after a send', async () => {
    kit.bridge = async () => {
      await walletSend('wallet_sendCalls')
      return { state: 'error', steps: [{ name: 'burn', state: 'error', errorCategory: 'polling_timeout', errorMessage: 'Timed out' }] }
    }
    await expect(run()).rejects.toThrow()
    expect(pendingCrossChain()).toEqual([expect.objectContaining({ kind: 'submitted', campaign: CAMPAIGN })])
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

import { type EIP1193Provider, getAddress, type Hex } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  donateFromUnified,
  fetchGatewayTransfer,
  fetchUnifiedBalance,
  isSafeToRetry,
  maxSendable,
  pickAllocations,
  planSpend,
  staticReserve,
  UnifiedSpendError,
} from './unified'

const ME = getAddress('0x1111111111111111111111111111111111111111')
const CAMPAIGN = getAddress('0x00000000000000000000000000000000000000a1')
const ARC_TX = `0x${'ef'.repeat(32)}` as Hex

const kit = vi.hoisted(() => ({
  contextConfig: undefined as unknown,
  balances: undefined as unknown,
  balanceParams: undefined as unknown,
  spendParams: undefined as Record<string, unknown> | undefined,
  spendResult: undefined as unknown,
  // What spend does: by default it returns spendResult; a test can make it sign first and then throw.
  spend: null as null | ((params: Record<string, unknown>) => Promise<unknown>),
  // Circle's fee per chain for any allocation, or a function that throws to simulate an estimate failure.
  feePerChain: '0.05',
  estimate: null as null | (() => never),
  estimates: 0,
  walletProvider: null as null | { request: (a: { method: string }) => Promise<unknown> },
}))

vi.mock('@circle-fin/unified-balance-kit', () => ({
  createUnifiedBalanceKitContext: (config: unknown) => {
    kit.contextConfig = config
    return { providers: [] }
  },
  getBalances: async (_ctx: unknown, params: unknown) => {
    kit.balanceParams = params
    return kit.balances
  },
  spend: async (_ctx: unknown, params: Record<string, unknown>) => {
    kit.spendParams = params
    if (kit.spend) return kit.spend(params)
    return kit.spendResult
  },
  estimateSpend: async (_ctx: unknown, params: { from: { allocations: { chain: string }[] } }) => {
    kit.estimates++
    if (kit.estimate) kit.estimate()
    const allocations = params.from.allocations.map((a) => ({ chain: a.chain, amount: kit.feePerChain }))
    return { fees: [{ type: 'gasFee', token: 'USDC', amount: '0', allocations }] }
  },
}))
vi.mock('@circle-fin/adapter-viem-v2', () => ({
  createViemAdapterFromProvider: async (p: { provider: { request: (a: { method: string }) => Promise<unknown> } }) => {
    kit.walletProvider = p.provider
    return { fake: 'adapter' }
  },
}))

// The wallet returning the burn intent signature, through the provider the adapter was given.
const walletSigns = () => kit.walletProvider!.request({ method: 'eth_signTypedData_v4' })

const provider = { request: async () => [ME] } as unknown as EIP1193Provider

afterEach(() => {
  vi.restoreAllMocks()
  kit.spend = null
  kit.estimate = null
  kit.estimates = 0
  kit.feePerChain = '0.05'
})

const ARB_BASE = [
  { chain: 'Base', amount: 10_000000n },
  { chain: 'Arbitrum', amount: 30_000000n },
]

describe('pickAllocations', () => {
  // The donor's balance sits on several chains. Taking the largest first keeps the number of burn intents,
  // and so the per-chain fees, as low as possible.
  it('takes the largest balance first, then the next, until the amount is covered', () => {
    const byChain = [
      { chain: 'Base', amount: 10_000000n },
      { chain: 'Arbitrum', amount: 30_000000n },
    ]
    expect(pickAllocations(byChain, 35_000000n)).toEqual([
      { chain: 'Arbitrum', amount: 30_000000n },
      { chain: 'Base', amount: 5_000000n },
    ])
  })

  // Asking Circle for more than the balance would only fail after the donor signed.
  it('throws "Not enough unified balance" when the chains together fall short', () => {
    const byChain = [
      { chain: 'Base', amount: 10_000000n },
      { chain: 'Arbitrum', amount: 30_000000n },
    ]
    expect(() => pickAllocations(byChain, 41_000000n)).toThrow('Not enough unified balance')
  })
})

describe('fee reserves', () => {
  // Gateway checks amount plus fee against each chain's balance. Taking a chain's whole balance always fails.
  it('leaves room for the fee on each chain it draws from', () => {
    const reserves = new Map([
      ['Arbitrum', 50_000n],
      ['Base', 50_000n],
    ])
    expect(pickAllocations(ARB_BASE, 35_000000n, reserves)).toEqual([
      { chain: 'Arbitrum', amount: 29_950000n },
      { chain: 'Base', amount: 5_050000n },
    ])
  })

  it('caps the sendable amount at each balance minus its fee', () => {
    const reserves = new Map([
      ['Arbitrum', 50_000n],
      ['Base', 50_000n],
    ])
    expect(maxSendable(ARB_BASE, reserves)).toBe(39_900000n)
    expect(() => pickAllocations(ARB_BASE, 39_900001n, reserves)).toThrow('Not enough unified balance')
  })

  // The first allocation takes all 30 from Arbitrum. Circle's estimate shows the 0.05 fee, so the plan must
  // move 0.05 of the amount to Base before anything is signed.
  it('plans a split from Circle estimates that never takes the full 30 from Arbitrum', async () => {
    const { allocations } = await planSpend({ provider, campaign: CAMPAIGN, byChain: ARB_BASE, amount: 35_000000n })
    expect(allocations).toEqual([
      { chain: 'Arbitrum', amount: 29_950000n },
      { chain: 'Base', amount: 5_050000n },
    ])
    expect(kit.estimates).toBe(2)
  })

  it('falls back to the static fee table when Circle cannot be asked', async () => {
    kit.estimate = () => {
      throw new Error('estimate down')
    }
    const { allocations } = await planSpend({ provider, campaign: CAMPAIGN, byChain: ARB_BASE, amount: 35_000000n })
    const arb = allocations.find((a) => a.chain === 'Arbitrum')!
    expect(arb.amount).toBe(30_000000n - staticReserve('Arbitrum', 30_000000n))
    expect(allocations.reduce((s, a) => s + a.amount, 0n)).toBe(35_000000n)
  })

  it('refuses before signing when the fees leave too little', async () => {
    await expect(planSpend({ provider, campaign: CAMPAIGN, byChain: ARB_BASE, amount: 40_000000n })).rejects.toThrow(
      'Not enough unified balance',
    )
  })
})

describe('isSafeToRetry', () => {
  const signed = (cause: unknown) => new UnifiedSpendError(true, cause)
  const kitError = (name: string, message = 'x', cause?: unknown) => Object.assign(new Error(message), { name, cause })

  it('allows a retry for anything before the signature', () => {
    expect(isSafeToRetry(new UnifiedSpendError(false, kitError('NETWORK_GATEWAY_API_ERROR')))).toBe(true)
  })

  it('allows a retry when Gateway refused for balance, or the forwarder failed or expired', () => {
    expect(isSafeToRetry(signed(kitError('BALANCE_INSUFFICIENT_TOKEN')))).toBe(true)
    expect(isSafeToRetry(signed(kitError('ONCHAIN_TRANSACTION_REVERTED', 'Forwarder transfer failed: reason')))).toBe(true)
    expect(
      isSafeToRetry(signed(kitError('ONCHAIN_TRANSACTION_REVERTED', 'Transfer attestation expired before forwarding completed.'))),
    ).toBe(true)
  })

  // After the signature Circle may have accepted the transfer. These errors say nothing about whether it did.
  it('keeps everything else after the signature blocked', () => {
    expect(isSafeToRetry(signed(kitError('NETWORK_GATEWAY_API_ERROR')))).toBe(false)
    expect(isSafeToRetry(signed(kitError('INPUT_VALIDATION_FAILED', 'Gateway API error: something')))).toBe(false)
    expect(isSafeToRetry(signed(kitError('ONCHAIN_TRANSACTION_REVERTED', 'Forwarder completed but did not return a transaction hash.')))).toBe(false)
  })
})

describe('fetchUnifiedBalance', () => {
  // A float conversion would turn 12.345678 into 12.345677 or similar. Amounts must be exact 6-decimal units.
  it('maps the kit decimal strings to exact 6-decimal bigints', async () => {
    kit.balances = {
      token: 'USDC',
      totalConfirmedBalance: '12.345678',
      breakdown: [
        {
          depositor: ME,
          totalConfirmed: '12.345678',
          breakdown: [
            { chain: 'Base', confirmedBalance: '12.345678' },
            { chain: 'Arc', confirmedBalance: '0.000000' },
          ],
        },
      ],
    }
    const res = await fetchUnifiedBalance(ME)
    expect(res.total).toBe(12345678n)
    expect(res.byChain).toEqual([{ chain: 'Base', amount: 12345678n }])
  })

  // Chains outside this list have no RPC the CSP allows, so the kit could not check the signer there.
  // The telemetry flags are defensive: kit 1.8.0's functional API ignores them and sends nothing.
  it('asks only for USDC on Arc and the six CCTP chains, and passes the telemetry flags defensively', async () => {
    kit.balances = { token: 'USDC', totalConfirmedBalance: '0.000000', breakdown: [] }
    await fetchUnifiedBalance(ME)
    expect(kit.balanceParams).toEqual({
      token: 'USDC',
      sources: { address: ME, chains: ['Arc', 'Ethereum', 'Avalanche', 'Optimism', 'Arbitrum', 'Base', 'Polygon'] },
    })
    expect(kit.contextConfig).toEqual({ disableAnalytics: true, disableErrorReporting: true })
  })

  // A value the parser does not understand must fail loudly, never show a wrong balance.
  it('rejects a balance string with more than 6 decimals', async () => {
    kit.balances = { token: 'USDC', totalConfirmedBalance: '1.0000001', breakdown: [] }
    await expect(fetchUnifiedBalance(ME)).rejects.toThrow()
  })
})

describe('donateFromUnified', () => {
  // The forwarder mints straight to the campaign contract on Arc. Without useForwarder the kit would try
  // to mint to the donor, and the campaign would never get the money.
  it('spends to the campaign on Arc through the forwarder, with the chosen allocations', async () => {
    kit.spendResult = { txHash: ARC_TX, explorerUrl: `https://arcscan.app/tx/${ARC_TX}`, recipientAddress: CAMPAIGN, destinationChain: 'Arc' }
    const res = await donateFromUnified({
      provider,
      campaign: CAMPAIGN,
      amount: '35',
      allocations: [
        { chain: 'Arbitrum', amount: '30' },
        { chain: 'Base', amount: '5' },
      ],
    })
    expect(res.txHash).toBe(ARC_TX)
    expect(kit.spendParams).toMatchObject({
      token: 'USDC',
      amount: '35',
      from: {
        adapter: { fake: 'adapter' },
        allocations: [
          { chain: 'Arbitrum', amount: '30' },
          { chain: 'Base', amount: '5' },
        ],
      },
      to: { chain: 'Arc', recipientAddress: CAMPAIGN, useForwarder: true },
    })
  })

  // The signature is the point after which Circle may hold the transfer, so the error must say so.
  it('marks an error after the wallet signed as signed', async () => {
    kit.spend = async () => {
      await walletSigns()
      throw Object.assign(new Error('Gateway down'), { name: 'NETWORK_GATEWAY_API_ERROR' })
    }
    const err = await donateFromUnified({ provider, campaign: CAMPAIGN, amount: '1', allocations: [{ chain: 'Base', amount: '1' }] }).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(UnifiedSpendError)
    expect((err as UnifiedSpendError).signed).toBe(true)
    expect(isSafeToRetry(err)).toBe(false)
  })

  it('marks an error before any signature as unsigned', async () => {
    kit.spend = async () => {
      throw Object.assign(new Error('estimate failed'), { name: 'NETWORK_GATEWAY_API_ERROR' })
    }
    const err = await donateFromUnified({ provider, campaign: CAMPAIGN, amount: '1', allocations: [{ chain: 'Base', amount: '1' }] }).catch(
      (e: unknown) => e,
    )
    expect((err as UnifiedSpendError).signed).toBe(false)
    expect(isSafeToRetry(err)).toBe(true)
  })

  it('fails loudly when Circle returns no Arc transaction hash', async () => {
    kit.spendResult = { txHash: 'nope', recipientAddress: CAMPAIGN, destinationChain: 'Arc' }
    await expect(
      donateFromUnified({ provider, campaign: CAMPAIGN, amount: '1', allocations: [{ chain: 'Base', amount: '1' }] }),
    ).rejects.toThrow()
  })
})

describe('fetchGatewayTransfer', () => {
  it('reads a finished transfer and its Arc transaction from the Gateway API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'confirmed', transactionHash: ARC_TX }), { status: 200 }),
    )
    expect(await fetchGatewayTransfer('t-1')).toEqual({ status: 'done', txHash: ARC_TX })
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://gateway-api.circle.com/v1/transfer/t-1')
  })

  it('reports a transfer still on its way as pending', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'pending' }), { status: 200 }))
    expect(await fetchGatewayTransfer('t-1')).toEqual({ status: 'pending' })
  })

  it('reports a failed or expired transfer as failed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'expired' }), { status: 200 }))
    expect(await fetchGatewayTransfer('t-1')).toEqual({ status: 'failed' })
  })
})

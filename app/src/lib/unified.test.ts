import { type EIP1193Provider, getAddress, type Hex } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { donateFromUnified, fetchGatewayTransfer, fetchUnifiedBalance, pickAllocations } from './unified'

const ME = getAddress('0x1111111111111111111111111111111111111111')
const CAMPAIGN = getAddress('0x00000000000000000000000000000000000000a1')
const ARC_TX = `0x${'ef'.repeat(32)}` as Hex

const kit = vi.hoisted(() => ({
  contextConfig: undefined as unknown,
  balances: undefined as unknown,
  balanceParams: undefined as unknown,
  spendParams: undefined as Record<string, unknown> | undefined,
  spendResult: undefined as unknown,
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
    return kit.spendResult
  },
}))
vi.mock('@circle-fin/adapter-viem-v2', () => ({
  createViemAdapterFromProvider: async () => ({ fake: 'adapter' }),
}))

const provider = { request: async () => [ME] } as unknown as EIP1193Provider

afterEach(() => {
  vi.restoreAllMocks()
})

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
  it('asks only for USDC on Arc and the six CCTP chains, with Circle telemetry off', async () => {
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

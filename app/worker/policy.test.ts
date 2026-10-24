// @vitest-environment node
import { type Address, encodeFunctionData, type Hex, parseAbi } from 'viem'
import { describe, expect, it } from 'vitest'
import { NETWORKS_WORKER } from './networks'
import { checkSignRequest, type PolicyContext } from './policy'

const net = NETWORKS_WORKER.testnet
const FACTORY: Address = '0x6890D40a9A472D0d05aDb5938D85B07059ad54ab'
const CAMPAIGN: Address = '0x00000000000000000000000000000000000000Ca'
const OTHER: Address = '0x00000000000000000000000000000000000000Bb'

const ctx: PolicyContext = {
  chainId: net.chainId,
  fixedTargets: new Set([net.usdc, net.eurc, FACTORY, net.tokenMessengerV2, net.multicall3From]),
  isCampaign: async (a) => a.toLowerCase() === CAMPAIGN.toLowerCase(),
}

const multicallAbi = parseAbi([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])',
  'function aggregate3Value((address target, bool allowFailure, uint256 value, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])',
])

function batch(targets: Address[]): Hex {
  return encodeFunctionData({
    abi: multicallAbi,
    functionName: 'aggregate3',
    args: [targets.map((target) => ({ target: target.toLowerCase() as Address, allowFailure: false, callData: '0x095ea7b3' as Hex }))],
  })
}

// The shape the gate page sent and Circle signed on Arc testnet (research note, Run 3).
function tx(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chainId: net.chainId,
    nonce: '3',
    to: net.usdc,
    value: '0',
    data: '0x095ea7b3',
    gas: '86681',
    maxFeePerGas: '41000000000',
    maxPriorityFeePerGas: '1000000000',
    ...over,
  }
}

describe('checkSignRequest', () => {
  it('allows USDC, EURC, the factory, TokenMessengerV2 and a Fundit campaign', async () => {
    for (const to of [net.usdc, net.eurc, FACTORY, net.tokenMessengerV2, CAMPAIGN, CAMPAIGN.toLowerCase()]) {
      expect(await checkSignRequest(tx({ to }), ctx), to).toEqual({ ok: true })
    }
    // Numbers as well as decimal strings, and no value at all.
    expect(await checkSignRequest(tx({ nonce: 3, value: 0 }), ctx)).toEqual({ ok: true })
    const { value: _value, ...noValue } = tx()
    expect(await checkSignRequest(noValue, ctx)).toEqual({ ok: true })
  })

  it('allows Multicall3From whose inner targets are all allowed', async () => {
    const data = batch([net.usdc, CAMPAIGN, FACTORY, net.eurc, net.tokenMessengerV2])
    expect(await checkSignRequest(tx({ to: net.multicall3From, data }), ctx)).toEqual({ ok: true })
  })

  // Multicall3From runs inner calls as the sender. A nested one would hide its targets from a one-level check.
  it('refuses Multicall3From inside Multicall3From', async () => {
    const data = batch([net.usdc, net.multicall3From])
    expect(await checkSignRequest(tx({ to: net.multicall3From, data }), ctx)).toMatchObject({ ok: false })
  })

  it('refuses an inner target that is not allowed', async () => {
    const data = batch([net.usdc, OTHER])
    expect(await checkSignRequest(tx({ to: net.multicall3From, data }), ctx)).toMatchObject({ ok: false })
  })

  it('refuses a Multicall3From call that is not aggregate3, or calldata that does not decode', async () => {
    const value = encodeFunctionData({
      abi: multicallAbi,
      functionName: 'aggregate3Value',
      args: [[{ target: net.usdc, allowFailure: false, value: 0n, callData: '0x' }]],
    })
    for (const data of [value, '0x', '0x82ad56cb', `${batch([net.usdc]).slice(0, 80)}`, 'not hex']) {
      expect(await checkSignRequest(tx({ to: net.multicall3From, data }), ctx), data).toMatchObject({ ok: false })
    }
    const { data: _data, ...noData } = tx({ to: net.multicall3From })
    expect(await checkSignRequest(noData, ctx)).toMatchObject({ ok: false })
  })

  // A campaign from another factory (or any contract) could take an approval and drain it.
  it('refuses a campaign the factory does not know', async () => {
    expect(await checkSignRequest(tx({ to: OTHER }), ctx)).toMatchObject({ ok: false })
  })

  // Fail closed: an RPC failure must never let an unchecked target through.
  it('refuses when the campaign check fails', async () => {
    const failing: PolicyContext = { ...ctx, isCampaign: () => Promise.reject(new Error('RPC down')) }
    expect(await checkSignRequest(tx({ to: CAMPAIGN }), failing)).toMatchObject({ ok: false })
    const data = batch([net.usdc, CAMPAIGN])
    expect(await checkSignRequest(tx({ to: net.multicall3From, data }), failing)).toMatchObject({ ok: false })
  })

  it('refuses non-zero value', async () => {
    for (const value of ['1', 1, '0x0', '0x1', '-0', '00', 'abc', null]) {
      expect(await checkSignRequest(tx({ value }), ctx), String(value)).toMatchObject({ ok: false })
    }
  })

  it('refuses the wrong chain id', async () => {
    for (const chainId of [NETWORKS_WORKER.mainnet.chainId, String(NETWORKS_WORKER.mainnet.chainId), 1, '5042002.0', '0x4cef52', undefined]) {
      expect(await checkSignRequest(tx({ chainId }), ctx), String(chainId)).toMatchObject({ ok: false })
    }
    // The right chain id as a decimal string is fine.
    expect(await checkSignRequest(tx({ chainId: String(net.chainId) }), ctx)).toEqual({ ok: true })
  })

  it('refuses a missing to', async () => {
    const { to: _to, ...noTo } = tx()
    expect(await checkSignRequest(noTo, ctx)).toMatchObject({ ok: false })
    for (const to of [null, '', '0x1234', 42]) {
      expect(await checkSignRequest(tx({ to }), ctx), String(to)).toMatchObject({ ok: false })
    }
  })

  // An EIP-7702 authorization would hand the account to any code, and an access list or type has no use here.
  it('refuses fields outside a plain EIP-1559 call', async () => {
    for (const extra of [
      { authorizationList: [{ address: OTHER, chainId: net.chainId, nonce: 0 }] },
      { accessList: [] },
      { type: 'eip7702' },
      { from: OTHER },
    ]) {
      expect(await checkSignRequest(tx(extra), ctx), Object.keys(extra)[0]).toMatchObject({ ok: false })
    }
    for (const bad of [{ gas: '-1' }, { maxFeePerGas: '1e9' }, { nonce: 1.5 }, { data: 'zz' }]) {
      expect(await checkSignRequest(tx(bad), ctx), JSON.stringify(bad)).toMatchObject({ ok: false })
    }
  })

  it('refuses JSON that is not an object', async () => {
    for (const value of [null, [], 'tx', 42, true, [tx()]]) {
      expect(await checkSignRequest(value, ctx), JSON.stringify(value)).toMatchObject({ ok: false })
    }
  })
})

// @vitest-environment node
import { type Address, encodeFunctionData, erc20Abi, type Hex, maxUint256, pad, parseAbi } from 'viem'
import { describe, expect, it } from 'vitest'
import { NETWORKS_WORKER } from './networks'
import { canonicalTransaction, checkSignRequest, type PolicyContext } from './policy'

const net = NETWORKS_WORKER.testnet
const FACTORY: Address = '0x6890D40a9A472D0d05aDb5938D85B07059ad54ab'
const CAMPAIGN: Address = '0x00000000000000000000000000000000000000ca'
const OTHER: Address = '0x00000000000000000000000000000000000000bb'

const ctx: PolicyContext = {
  chainId: net.chainId,
  usdc: net.usdc,
  eurc: net.eurc,
  tokenMessengerV2: net.tokenMessengerV2,
  factory: FACTORY,
  isCampaign: async (a) => a.toLowerCase() === CAMPAIGN,
}

const multicallAbi = parseAbi([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])',
  'function aggregate3Value((address target, bool allowFailure, uint256 value, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])',
])
const messengerAbi = parseAbi([
  'function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)',
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)',
])
const campaignAbi = parseAbi(['function donate(uint256 amount, uint256 tip, string message)'])

const approve = (spender: Address, amount = 5_000_000n): Hex => encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] })
const transfer = (to: Address): Hex => encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, 1_000_000n] })
const transferFrom = encodeFunctionData({ abi: erc20Abi, functionName: 'transferFrom', args: [OTHER, OTHER, 1n] })
const donate = encodeFunctionData({ abi: campaignAbi, functionName: 'donate', args: [5_000_000n, 0n, 'hi'] })
const burn = (token: Address): Hex =>
  encodeFunctionData({
    abi: messengerAbi,
    functionName: 'depositForBurnWithHook',
    args: [1_000_000n, 6, pad(OTHER), token, pad('0x'), 100n, 1000, '0x636374702d666f7277617264'],
  })

type Inner = { to: Address; data: Hex }
function batch(calls: Inner[]): Hex {
  return encodeFunctionData({ abi: multicallAbi, functionName: 'aggregate3', args: [calls.map((c) => ({ target: c.to.toLowerCase() as Address, allowFailure: false, callData: c.data }))] })
}

// The shape the gate page sent and Circle signed on Arc testnet (research note, Run 3).
function tx(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chainId: net.chainId,
    nonce: '3',
    to: net.usdc,
    value: '0',
    data: transfer(OTHER),
    gas: '86681',
    maxFeePerGas: '41000000000',
    maxPriorityFeePerGas: '1000000000',
    ...over,
  }
}

const allowed = { ok: true }
const refused = { ok: false }

describe('checkSignRequest', () => {
  it('allows USDC, EURC, the factory, TokenMessengerV2 and a Fundit campaign', async () => {
    for (const call of [
      { to: net.usdc, data: transfer(OTHER) },
      { to: net.eurc, data: transfer(OTHER) },
      { to: FACTORY, data: '0x12345678' },
      { to: net.tokenMessengerV2, data: burn(net.usdc) },
      { to: CAMPAIGN, data: donate },
      { to: '0x00000000000000000000000000000000000000CA', data: donate },
    ]) {
      expect(await checkSignRequest(tx(call), ctx), call.to).toEqual(allowed)
    }
    // Numbers as well as decimal strings, and no value at all.
    expect(await checkSignRequest(tx({ nonce: 3, value: 0 }), ctx)).toEqual(allowed)
    const { value: _value, ...noValue } = tx()
    expect(await checkSignRequest(noValue, ctx)).toEqual(allowed)
  })

  // Send out on Arc and Add money are plain transfers to any address.
  it('allows a token transfer to any address', async () => {
    expect(await checkSignRequest(tx({ to: net.usdc, data: transfer(OTHER) }), ctx)).toEqual(allowed)
    expect(await checkSignRequest(tx({ to: net.eurc, data: transfer(CAMPAIGN) }), ctx)).toEqual(allowed)
  })

  // approve(attacker, max) on USDC would let anyone take the balance later, with no further approval.
  it('allows approve only to a Fundit campaign, or USDC to TokenMessengerV2', async () => {
    expect(await checkSignRequest(tx({ to: net.usdc, data: approve(CAMPAIGN) }), ctx)).toEqual(allowed)
    expect(await checkSignRequest(tx({ to: net.eurc, data: approve(CAMPAIGN) }), ctx)).toEqual(allowed)
    expect(await checkSignRequest(tx({ to: net.usdc, data: approve(net.tokenMessengerV2) }), ctx)).toEqual(allowed)
    expect(await checkSignRequest(tx({ to: net.usdc, data: approve(OTHER, maxUint256) }), ctx)).toMatchObject(refused)
    expect(await checkSignRequest(tx({ to: net.eurc, data: approve(OTHER) }), ctx)).toMatchObject(refused)
    // The app never burns EURC, so EURC is never approved to TokenMessengerV2.
    expect(await checkSignRequest(tx({ to: net.eurc, data: approve(net.tokenMessengerV2) }), ctx)).toMatchObject(refused)
  })

  it('refuses any other token function, a short selector or no data', async () => {
    for (const data of [transferFrom, '0x', '0x095ea7', '0x095ea7b3', `${approve(CAMPAIGN)}00`]) {
      expect(await checkSignRequest(tx({ to: net.usdc, data }), ctx), data).toMatchObject(refused)
    }
    const { data: _d, ...noData } = tx()
    expect(await checkSignRequest(noData, ctx)).toMatchObject(refused)
  })

  it('allows only depositForBurnWithHook of USDC on TokenMessengerV2', async () => {
    expect(await checkSignRequest(tx({ to: net.tokenMessengerV2, data: burn(net.usdc) }), ctx)).toEqual(allowed)
    expect(await checkSignRequest(tx({ to: net.tokenMessengerV2, data: burn(net.eurc) }), ctx)).toMatchObject(refused)
    const plain = encodeFunctionData({ abi: messengerAbi, functionName: 'depositForBurn', args: [1n, 6, pad(OTHER), net.usdc, pad('0x'), 0n, 1000] })
    expect(await checkSignRequest(tx({ to: net.tokenMessengerV2, data: plain }), ctx)).toMatchObject(refused)
  })

  it('allows Multicall3From whose inner calls are all allowed', async () => {
    // A gift (approve + donate) and Send out to another chain (approve + burn), as the app batches them.
    const gift = batch([{ to: net.usdc, data: approve(CAMPAIGN) }, { to: CAMPAIGN, data: donate }])
    const sendOut = batch([{ to: net.usdc, data: approve(net.tokenMessengerV2) }, { to: net.tokenMessengerV2, data: burn(net.usdc) }])
    const mixed = batch([{ to: FACTORY, data: '0x12345678' }, { to: net.eurc, data: transfer(OTHER) }])
    for (const data of [gift, sendOut, mixed]) {
      expect(await checkSignRequest(tx({ to: net.multicall3From, data }), ctx)).toEqual(allowed)
    }
  })

  it('applies the same function checks inside aggregate3', async () => {
    for (const inner of [
      { to: net.usdc, data: approve(OTHER) },
      { to: net.usdc, data: transferFrom },
      { to: net.eurc, data: approve(net.tokenMessengerV2) },
      { to: net.tokenMessengerV2, data: burn(net.eurc) },
    ]) {
      const data = batch([{ to: net.usdc, data: transfer(OTHER) }, inner])
      expect(await checkSignRequest(tx({ to: net.multicall3From, data }), ctx), inner.data.slice(0, 10)).toMatchObject(refused)
    }
  })

  // Multicall3From runs inner calls as the sender. A nested one would hide its targets from a one-level check.
  it('refuses Multicall3From inside Multicall3From', async () => {
    const nested = batch([{ to: net.usdc, data: approve(OTHER) }])
    const data = batch([{ to: net.usdc, data: transfer(OTHER) }, { to: net.multicall3From, data: nested }])
    expect(await checkSignRequest(tx({ to: net.multicall3From, data }), ctx)).toMatchObject(refused)
  })

  it('refuses an inner target that is not allowed', async () => {
    const data = batch([{ to: net.usdc, data: transfer(OTHER) }, { to: OTHER, data: donate }])
    expect(await checkSignRequest(tx({ to: net.multicall3From, data }), ctx)).toMatchObject(refused)
  })

  it('refuses a Multicall3From call that is not aggregate3, or calldata that does not decode', async () => {
    const value = encodeFunctionData({ abi: multicallAbi, functionName: 'aggregate3Value', args: [[{ target: net.usdc, allowFailure: false, value: 0n, callData: '0x' }]] })
    const good = batch([{ to: net.usdc, data: transfer(OTHER) }])
    for (const data of [value, '0x', '0x82ad56cb', good.slice(0, 80), `${good}00`, batch([])]) {
      expect(await checkSignRequest(tx({ to: net.multicall3From, data }), ctx), data.slice(0, 12)).toMatchObject(refused)
    }
    const { data: _data, ...noData } = tx({ to: net.multicall3From })
    expect(await checkSignRequest(noData, ctx)).toMatchObject(refused)
  })

  // A campaign from another factory (or any contract) could take an approval and drain it.
  it('refuses a campaign the factory does not know', async () => {
    expect(await checkSignRequest(tx({ to: OTHER, data: donate }), ctx)).toMatchObject(refused)
  })

  // Fail closed: an RPC failure must never let an unchecked target or spender through.
  it('refuses when the campaign check fails', async () => {
    const failing: PolicyContext = { ...ctx, isCampaign: () => Promise.reject(new Error('RPC down')) }
    expect(await checkSignRequest(tx({ to: CAMPAIGN, data: donate }), failing)).toMatchObject(refused)
    expect(await checkSignRequest(tx({ to: net.usdc, data: approve(CAMPAIGN) }), failing)).toMatchObject(refused)
    const data = batch([{ to: net.usdc, data: transfer(OTHER) }, { to: CAMPAIGN, data: donate }])
    expect(await checkSignRequest(tx({ to: net.multicall3From, data }), failing)).toMatchObject(refused)
  })

  it('refuses non-zero value', async () => {
    for (const value of ['1', 1, -0, '0x0', '0x1', '-0', '00', '0.0', 'abc', null, 0.5]) {
      expect(await checkSignRequest(tx({ value }), ctx), String(value)).toMatchObject(refused)
    }
  })

  it('refuses the wrong chain id', async () => {
    for (const chainId of [NETWORKS_WORKER.mainnet.chainId, String(NETWORKS_WORKER.mainnet.chainId), 1, '5042002.0', 5042002.5, '0x4cef52', -0, undefined]) {
      expect(await checkSignRequest(tx({ chainId }), ctx), String(chainId)).toMatchObject(refused)
    }
    // The right chain id as a decimal string is fine.
    expect(await checkSignRequest(tx({ chainId: String(net.chainId) }), ctx)).toEqual(allowed)
  })

  it('refuses a missing to', async () => {
    const { to: _to, ...noTo } = tx()
    expect(await checkSignRequest(noTo, ctx)).toMatchObject(refused)
    for (const to of [null, '', '0x1234', 42]) {
      expect(await checkSignRequest(tx({ to }), ctx), String(to)).toMatchObject(refused)
    }
  })

  // An EIP-7702 authorization would hand the account to any code, and an access list or type has no use here.
  it('refuses fields outside a plain EIP-1559 call, and numbers that are not plain integers', async () => {
    for (const extra of [{ authorizationList: [{ address: OTHER, chainId: net.chainId, nonce: 0 }] }, { accessList: [] }, { type: 'eip7702' }, { from: OTHER }]) {
      expect(await checkSignRequest(tx(extra), ctx), Object.keys(extra)[0]).toMatchObject(refused)
    }
    for (const bad of [{ gas: '-1' }, { maxFeePerGas: '1e9' }, { nonce: 1.5 }, { nonce: -0 }, { gasLimit: '07' }, { data: 'zz' }]) {
      expect(await checkSignRequest(tx(bad), ctx), JSON.stringify(bad)).toMatchObject(refused)
    }
  })

  it('refuses JSON that is not an object', async () => {
    for (const value of [null, [], 'tx', 42, true, [tx()]]) {
      expect(await checkSignRequest(value, ctx), JSON.stringify(value)).toMatchObject(refused)
    }
  })
})

describe('canonicalTransaction', () => {
  it('writes only the allowed fields, in a fixed order', () => {
    const t = { maxPriorityFeePerGas: '1', to: net.usdc, chainId: net.chainId, data: '0x', nonce: 0 }
    expect(canonicalTransaction(t)).toBe(`{"chainId":${net.chainId},"nonce":0,"to":"${net.usdc}","data":"0x","maxPriorityFeePerGas":"1"}`)
  })
})

import {
  BaseError,
  encodeErrorResult,
  RawContractError,
  UserRejectedRequestError,
  zeroAddress,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { campaignAbi } from '../abi/campaign'
import { factoryAbi } from '../abi/factory'
import { explainError } from './errors'

const GENERIC = 'Something went wrong. Nothing was sent.'

type AbiError = Extract<(typeof campaignAbi)[number] | (typeof factoryAbi)[number], { type: 'error' }>

// Wraps revert data the way viem does when a wallet call fails: a BaseError with the raw data in its cause.
function revertWith(abiError: AbiError) {
  const args = (abiError.inputs as readonly { type: string }[]).map((i) => (i.type === 'address' ? zeroAddress : 0n))
  const data = encodeErrorResult({ abi: [abiError], errorName: abiError.name, args } as never)
  return new BaseError('Execution reverted', { cause: new RawContractError({ data }) })
}

describe('explainError', () => {
  // A new custom error in either contract must get plain text, not the generic fallback.
  const abiErrors = [...campaignAbi, ...factoryAbi].filter((x): x is AbiError => x.type === 'error')
  it.each(abiErrors.map((e) => [e.name, e] as const))('explains %s', (_name, abiError) => {
    const text = explainError(revertWith(abiError))
    expect(text).not.toContain(GENERIC)
    expect(text.length).toBeGreaterThan(0)
  })

  it('uses the agreed wording for two key errors', () => {
    const find = (name: string) => campaignAbi.find((x) => x.type === 'error' && x.name === name) as AbiError
    expect(explainError(revertWith(find('UnsupportedPayoutDomain')))).toBe('EURC can only be paid out on Arc.')
    expect(explainError(revertWith(find('CampaignClosed')))).toBe('This campaign is closed.')
  })

  // MetaMask-style wallets put the revert hex one or two levels down instead of at error.data.
  it('finds revert data nested at data.data and data.originalError.data', () => {
    const closed = campaignAbi.find((x) => x.type === 'error' && x.name === 'CampaignClosed') as AbiError
    const hex = encodeErrorResult({ abi: [closed], errorName: 'CampaignClosed' } as never)
    const nested = { code: -32603, message: 'Internal JSON-RPC error.', data: { code: 3, data: hex } }
    expect(explainError(nested)).toBe('This campaign is closed.')
    const original = { code: -32603, message: 'Internal JSON-RPC error.', data: { originalError: { code: 3, data: hex } } }
    expect(explainError(original)).toBe('This campaign is closed.')
  })

  it('maps a wallet rejection to a cancel message', () => {
    const rejected = new BaseError('Request failed', { cause: new UserRejectedRequestError(new Error('User denied')) })
    expect(explainError(rejected)).toBe('You cancelled the request.')
    expect(explainError({ code: 4001, message: 'User rejected the request.' })).toBe('You cancelled the request.')
  })

  it('falls back to a generic message with a short detail', () => {
    const text = explainError(new Error('network down'))
    expect(text.startsWith(GENERIC)).toBe(true)
    expect(text).toContain('network down')
    expect(explainError(new Error('x'.repeat(1000))).length).toBeLessThan(250)
  })
  // Bridge Kit wraps wallet errors in a KitError whose cause is { trace: { rawError } }, not an Error chain.
  it('finds a wallet rejection under a KitError trace.rawError', () => {
    const kitError = Object.assign(new Error('Unknown blockchain error on Base: User rejected the request.'), {
      name: 'ONCHAIN_UNKNOWN_BLOCKCHAIN_ERROR',
      cause: { trace: { chain: 'Base', rawError: new UserRejectedRequestError(new Error('x')) } },
    })
    expect(explainError(kitError)).toBe('You cancelled the request.')
  })

  // A balance problem is the donor's to fix. It needs plain words, not the generic "Nothing was sent." text.
  it('explains a Bridge Kit insufficient balance error in plain words', () => {
    const token = Object.assign(new Error('Insufficient USDC balance on Base'), {
      name: 'BALANCE_INSUFFICIENT_TOKEN',
      cause: { trace: { chain: 'Base', token: 'USDC' } },
    })
    expect(explainError(token)).toBe('You do not have enough USDC on Base.')
    const gas = Object.assign(new Error('Insufficient ETH on Base to cover gas fees'), {
      name: 'BALANCE_INSUFFICIENT_GAS',
      cause: { trace: { chain: 'Base' } },
    })
    expect(explainError(gas)).toBe('You do not have enough ETH on Base to pay the network fee.')
    // Wrapped one level down, as a failed bridge step carries it.
    expect(explainError(new Error('Transfer failed', { cause: token }))).toBe('You do not have enough USDC on Base.')
  })
  // Circle's RPC_ENDPOINT_ERROR reuses code 4001, which EIP-1193 means a user rejection. It is a network problem.
  it('does not read a Bridge Kit RPC error with code 4001 as a cancel', () => {
    const rpc = Object.assign(new Error('RPC endpoint error on Base'), {
      name: 'RPC_ENDPOINT_ERROR',
      code: 4001,
      type: 'RPC',
      cause: { trace: { chain: 'Base', rawError: new Error('gas estimation failed') } },
    })
    expect(explainError(rpc)).toBe('The Base network did not answer. Try again in a moment.')
    expect(explainError(new Error('Transfer failed', { cause: rpc }))).toBe('The Base network did not answer. Try again in a moment.')
  })

  // The chain is in the error's trace. A message that does not end in "on <chain>" must still name it.
  it('takes the chain name for a Bridge Kit RPC error from cause.trace.chain', () => {
    const rpc = Object.assign(new Error('RPC endpoint error: request timed out'), {
      name: 'RPC_ENDPOINT_ERROR',
      code: 4001,
      type: 'RPC',
      cause: { trace: { chain: 'Arbitrum', rawError: new Error('timeout') } },
    })
    expect(explainError(rpc)).toBe('The Arbitrum network did not answer. Try again in a moment.')
  })

  it('still reads a real rejection under a KitError as a cancel', () => {
    const kitError = Object.assign(new Error('Unknown blockchain error on Base'), {
      name: 'ONCHAIN_UNKNOWN_BLOCKCHAIN_ERROR',
      code: 5000,
      type: 'ONCHAIN',
      cause: { trace: { chain: 'Base', rawError: Object.assign(new Error('User denied'), { code: 4001 }) } },
    })
    expect(explainError(kitError)).toBe('You cancelled the request.')
  })

  // The SDK falls back to placeholder names. The donor needs the real token to know what to top up.
  it('fills in real symbols when Bridge Kit uses placeholder token names', () => {
    const token = Object.assign(new Error('Insufficient token balance on Polygon'), { name: 'BALANCE_INSUFFICIENT_TOKEN' })
    expect(explainError(token)).toBe('You do not have enough USDC on Polygon.')
    const gas = Object.assign(new Error('Insufficient native token on Polygon to cover gas fees'), { name: 'BALANCE_INSUFFICIENT_GAS' })
    expect(explainError(gas)).toBe('You do not have enough POL on Polygon to pay the network fee.')
    const avax = Object.assign(new Error('Insufficient native token on Avalanche to cover gas fees'), { name: 'BALANCE_INSUFFICIENT_GAS' })
    expect(explainError(avax)).toBe('You do not have enough AVAX on Avalanche to pay the network fee.')
  })
  // Closing the browser's passkey prompt throws a DOMException named NotAllowedError. It is a cancel.
  it('reads a closed passkey prompt as a cancel', () => {
    const cancel = Object.assign(new Error('The operation either timed out or was not allowed.'), { name: 'NotAllowedError' })
    expect(explainError(new Error('Signing failed', { cause: cancel }))).toBe('You cancelled the request.')
  })

  // Bridge Kit names the chain Optimism. People know it as OP Mainnet, the name shown everywhere else.
  it('names Optimism as OP Mainnet in Bridge Kit messages', () => {
    const token = Object.assign(new Error('Insufficient USDC balance on Optimism'), { name: 'BALANCE_INSUFFICIENT_TOKEN' })
    expect(explainError(token)).toBe('You do not have enough USDC on OP Mainnet.')
    const gas = Object.assign(new Error('Insufficient native token on Optimism to cover gas fees'), { name: 'BALANCE_INSUFFICIENT_GAS' })
    expect(explainError(gas)).toBe('You do not have enough ETH on OP Mainnet to pay the network fee.')
  })
})

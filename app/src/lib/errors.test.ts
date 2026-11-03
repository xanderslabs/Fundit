import {
  BaseError,
  encodeErrorResult,
  RawContractError,
  UserRejectedRequestError,
  zeroAddress,
} from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { campaignAbi } from '../abi/campaign'
import { factoryAbi } from '../abi/factory'
import { CANCELLED, explainError, FALLBACK, needsAddMoney, PlainError, WrongWalletAccount } from './errors'

const GENERIC = FALLBACK

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

  // People see "Fundit" everywhere else in the app. Error texts use the same word.
  it.each(abiErrors.map((e) => [e.name, e] as const))('says Fundit, not campaign, for %s', (_name, abiError) => {
    expect(explainError(revertWith(abiError))).not.toMatch(/campaign/i)
  })

  it('uses the agreed wording for two key errors', () => {
    const find = (name: string) => campaignAbi.find((x) => x.type === 'error' && x.name === name) as AbiError
    expect(explainError(revertWith(find('UnsupportedPayoutDomain')))).toBe('EURC can only be paid out on Arc.')
    expect(explainError(revertWith(find('CampaignClosed')))).toBe('This Fundit is closed.')
  })

  // MetaMask-style wallets put the revert hex one or two levels down instead of at error.data.
  it('finds revert data nested at data.data and data.originalError.data', () => {
    const closed = campaignAbi.find((x) => x.type === 'error' && x.name === 'CampaignClosed') as AbiError
    const hex = encodeErrorResult({ abi: [closed], errorName: 'CampaignClosed' } as never)
    const nested = { code: -32603, message: 'Internal JSON-RPC error.', data: { code: 3, data: hex } }
    expect(explainError(nested)).toBe('This Fundit is closed.')
    const original = { code: -32603, message: 'Internal JSON-RPC error.', data: { originalError: { code: 3, data: hex } } }
    expect(explainError(original)).toBe('This Fundit is closed.')
  })

  it('maps a wallet rejection to a cancel message', () => {
    const rejected = new BaseError('Request failed', { cause: new UserRejectedRequestError(new Error('User denied')) })
    expect(explainError(rejected)).toBe("You cancelled the request. Try again when you're ready.")
    expect(explainError({ code: 4001, message: 'User rejected the request.' })).toBe(CANCELLED)
  })

  // The raw text helps debugging, so it goes to the console. The person only ever sees the fallback.
  it('falls back to one plain message and logs the raw error, never showing it', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const raw = new Error('An unknown RPC error occurred. Details: code -32603')
    expect(explainError(raw)).toBe("That didn't work. Check your connection and try again.")
    expect(log).toHaveBeenCalledWith(raw)
    expect(explainError({})).toBe(FALLBACK)
    expect(explainError(undefined)).toBe(FALLBACK)
    log.mockRestore()
  })
})

// The RPC and the network fail in ways people can act on. Each gets its own plain text, matched on the code or
// text viem and the node actually send.
describe('network errors', () => {
  // viem wraps a JSON-RPC answer as "An unknown RPC error occurred." with the real text in details.
  const rpc = (code: number, details: string) =>
    Object.assign(new BaseError('An unknown RPC error occurred.', { details }), { code, cause: Object.assign(new Error(details), { code }) })
  const named = (name: string, message = name) => Object.assign(new Error(message), { name })

  it.each([
    ['a rate limit (-32005)', rpc(-32005, 'Limit exceeded'), 'Too many requests right now. Wait a minute and try again.'],
    ['an HTTP 429', Object.assign(new BaseError('HTTP request failed.'), { name: 'HttpRequestError', status: 429 }), 'Too many requests right now. Wait a minute and try again.'],
    ['a timeout', named('TimeoutError', 'The request took too long to respond.'), 'The network took too long to answer. Try again in a moment.'],
    ['a timed out read', new Error('Reading the account owners timed out.'), 'The network took too long to answer. Try again in a moment.'],
    ['a network that is down', new TypeError('Failed to fetch'), "Fundit couldn't reach the network. Check your connection and try again."],
    ['an HTTP request with no answer', Object.assign(new BaseError('HTTP request failed.'), { name: 'HttpRequestError' }), "Fundit couldn't reach the network. Check your connection and try again."],
  ])('explains %s', (_label, err, text) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(explainError(err)).toBe(text)
    vi.mocked(console.error).mockRestore()
  })

  // Support needs the raw error for a mapped text too, not only for the fallback. A cancel or a PlainError is not
  // a failure, so it is not logged.
  it('logs the raw error behind every mapped text, but not a cancel or a PlainError', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const down = new TypeError('Failed to fetch')
    explainError(down)
    expect(log).toHaveBeenCalledWith(down)
    log.mockClear()
    explainError(new UserRejectedRequestError(new Error('x')))
    explainError(new PlainError('Plain text'))
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })
})

describe('wallet account errors', () => {
  it('maps insufficient funds to the add money fix', () => {
    const e = new Error('RPC failed', { cause: new Error('insufficient funds for gas * price + value') })
    expect(needsAddMoney(e)).toBe(true)
  })

  it('names the short address when the wallet is on another account', () => {
    expect(explainError(new WrongWalletAccount('0x1234567890123456789012345678901234567890'))).toBe(
      'Your wallet is on a different account. Switch back to 0x1234...7890 in your wallet, or sign in again.',
    )
  })
})

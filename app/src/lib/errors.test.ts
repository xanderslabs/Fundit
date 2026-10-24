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
import { CANCELLED, explainAfterApproval, explainError, FALLBACK, NeedsNetworkFee, needsAddMoney, USERNAME_RULE, WrongWalletAccount } from './errors'

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
  // Bridge Kit wraps wallet errors in a KitError whose cause is { trace: { rawError } }, not an Error chain.
  it('finds a wallet rejection under a KitError trace.rawError', () => {
    const kitError = Object.assign(new Error('Unknown blockchain error on Base: User rejected the request.'), {
      name: 'ONCHAIN_UNKNOWN_BLOCKCHAIN_ERROR',
      cause: { trace: { chain: 'Base', rawError: new UserRejectedRequestError(new Error('x')) } },
    })
    expect(explainError(kitError)).toBe("You cancelled the request. Try again when you're ready.")
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
    expect(explainError(kitError)).toBe("You cancelled the request. Try again when you're ready.")
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
    expect(explainError(new Error('Signing failed', { cause: cancel }))).toBe("You cancelled the request. Try again when you're ready.")
  })

  // Bridge Kit names the chain Optimism. People know it as OP Mainnet, the name shown everywhere else.
  it('names Optimism as OP Mainnet in Bridge Kit messages', () => {
    const token = Object.assign(new Error('Insufficient USDC balance on Optimism'), { name: 'BALANCE_INSUFFICIENT_TOKEN' })
    expect(explainError(token)).toBe('You do not have enough USDC on OP Mainnet.')
    const gas = Object.assign(new Error('Insufficient native token on Optimism to cover gas fees'), { name: 'BALANCE_INSUFFICIENT_GAS' })
    expect(explainError(gas)).toBe('You do not have enough ETH on OP Mainnet to pay the network fee.')
  })
})

describe('explainAfterApproval', () => {
  // Adding money from another chain can fail after the wallet already approved. "Nothing was sent"
  // would then be untrue, so the generic text stops at "Something went wrong."
  it('never says "Nothing was sent"', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(explainAfterApproval(new Error('socket hang up'))).toBe(FALLBACK)
    expect(explainAfterApproval({})).toBe(FALLBACK)
    expect(FALLBACK).not.toMatch(/Nothing was sent/)
    vi.mocked(console.error).mockRestore()
  })

  it('keeps the specific texts', () => {
    expect(explainAfterApproval(new UserRejectedRequestError(new Error('x')))).toBe(CANCELLED)
    const token = Object.assign(new Error('Insufficient USDC balance on Base'), { name: 'BALANCE_INSUFFICIENT_TOKEN' })
    expect(explainAfterApproval(token)).toBe('You do not have enough USDC on Base.')
  })
})

// On testnet Bridge Kit names chains Base_Sepolia and so on. Errors must still show the name people know.
describe('Bridge Kit errors on testnet', () => {
  it('maps Base_Sepolia to Base Sepolia and its ETH', async () => {
    vi.stubEnv('VITE_ARC_NETWORK', 'testnet')
    vi.resetModules()
    try {
      const { explainError: explain } = await import('./errors')
      const gas = Object.assign(new Error('Insufficient native token on Base_Sepolia to cover gas fees'), {
        name: 'BALANCE_INSUFFICIENT_GAS',
        cause: { trace: { chain: 'Base_Sepolia' } },
      })
      expect(explain(gas)).toBe('You do not have enough ETH on Base Sepolia to pay the network fee.')
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})

describe('network fee and username errors', () => {
  // -32025 is not known to mean only a bad username, so only Circle's own text maps to the rule.
  it('maps only the username text to the username rule, not any -32025', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const other = Object.assign(new Error('The request is invalid.'), { code: -32025 })
    expect(explainError(other)).not.toContain('Use 5 to 50 letters')
    vi.mocked(console.error).mockRestore()
    const username = Object.assign(new Error('The username is invalid. It should be 5 to 50 characters.'), { code: -32025 })
    expect(explainError(username)).toBe('Use 5 to 50 letters, numbers or _ @ . : + - with no spaces.')
    expect(USERNAME_RULE).not.toMatch(/[()]/)
  })

  it("says AA21 (didn't pay prefund) plainly and asks to add money", () => {
    const err = new Error("UserOperation reverted during simulation with reason: AA21 didn't pay prefund")
    expect(explainError(err)).toBe('Your Fundit account does not have enough USDC for the network fee. Add money and try again.')
    expect(needsAddMoney(err)).toBe(true)
  })

  it('gives the real number when the sender knows it', () => {
    const err = new NeedsNetworkFee(1_620_000n)
    expect(explainError(err)).toBe('Your Fundit account needs at least 1.62 USDC for the network fee. Add money and try again.')
    expect(needsAddMoney(err)).toBe(true)
    expect(needsAddMoney(new Error('network down'))).toBe(false)
  })
})

// Circle's passkey RP, its bundler and the network fail in ways people can act on. Each gets its own plain text,
// matched on the code or text Circle and viem actually send.
describe('Circle, passkey and network errors', () => {
  // viem wraps Circle's JSON-RPC answer as "An unknown RPC error occurred." with the real text in details.
  const rpc = (code: number, details: string) =>
    Object.assign(new BaseError('An unknown RPC error occurred.', { details }), { code, cause: Object.assign(new Error(details), { code }) })
  const named = (name: string, message = name) => Object.assign(new Error(message), { name })

  it.each([
    ['a taken username (-32024)', rpc(-32024, 'The username is duplicated.'), "That username is taken. Pick another one, or sign in if it's yours."],
    ['a taken username by its text alone', new Error('The username is duplicated.'), "That username is taken. Pick another one, or sign in if it's yours."],
    ['an invalid username (-32025)', rpc(-32025, 'The username is invalid. It should be 5 to 50 characters and contain only alphanumeric and _@.:+- characters.'), USERNAME_RULE],
    ['a closed passkey prompt', named('NotAllowedError', 'The operation either timed out or was not allowed.'), CANCELLED],
    ['no passkey for the account', new Error('No credential available.'), "That passkey didn't open a Fundit account. Try another passkey, or create an account."],
    ['a failed login check', new Error('Login verification failed.'), "That passkey didn't open a Fundit account. Try another passkey, or create an account."],
    ['a passkey the browser did not save', new Error('No credential created.'), "Your browser didn't save a passkey. Try again, or use another browser or device."],
    // The SDK throws this on sign-in too, when it cannot read the stored key, so the text fits both flows.
    ['a passkey the SDK could not use', new Error('Credential creation failed.'), "Your passkey didn't work. Try again, or use another browser or device."],
    ['a browser without passkeys', new Error('Credential Management API not supported.'), "This browser can't use passkeys. Open Fundit in an up-to-date browser such as Chrome, Safari or Firefox."],
    ['a passkey already on this device', named('InvalidStateError'), 'This device already has a passkey for this account. Sign in with it instead.'],
    ['a passkey on the wrong site address', named('SecurityError'), "Passkeys can't be used on this page address. Open Fundit at its usual address and try again."],
    ['a failed account registration', new Error('Failed to register the new WebAuthn credential. Please try again.'), "We couldn't finish setting up your account. Try again in a moment."],
    ['a nonce clash (AA25)', new Error('UserOperation reverted during simulation with reason: AA25 invalid account nonce'), 'Another transaction from your account is still going through. Wait a moment and try again.'],
    ['an expired operation (AA22)', new Error('AA22 expired or not due'), 'The request expired before it went out. Nothing was sent. Try again.'],
    ['a rejected signature (AA24)', new Error('AA24 signature error'), "Your passkey's signature was not accepted. Sign out, sign in again and try again."],
    ['a rate limit (-32005)', rpc(-32005, 'Limit exceeded'), 'Too many requests right now. Wait a minute and try again.'],
    ['a throttled bundler (-32504)', rpc(-32504, 'throttled'), 'Too many requests right now. Wait a minute and try again.'],
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

  // -32024 is not known to mean only a taken username, and explainError also runs on sends. Only Circle's text counts.
  it('does not read a bare -32024 as a taken username', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(explainError(rpc(-32024, 'Something else entirely'))).not.toMatch(/username/)
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
    explainError(named('NotAllowedError'))
    explainError(new NeedsNetworkFee(1n))
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

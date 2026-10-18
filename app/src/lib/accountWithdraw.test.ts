import { type Address, decodeFunctionData, getAddress, pad, parseAbi, zeroAddress, zeroHash } from 'viem'
import { describe, expect, it } from 'vitest'
import { erc20Abi } from '../abi/erc20'
import { FORWARD_HOOK_DATA, TOKEN_MESSENGER_V2, TOKENS } from '../config'
import { buildAccountSendCalls, maxAccountSend } from './accountWithdraw'

const ACCOUNT = getAddress('0x00000000000000000000000000000000000000cc')
const FRIEND = getAddress('0x1111111111111111111111111111111111111111') as Address
const USDC = TOKENS.USDC.address
const EURC = TOKENS.EURC.address

// Circle's TokenMessengerV2 signature, as in contracts/src/interfaces/ITokenMessengerV2.sol.
const messengerAbi = parseAbi([
  'function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)',
])

describe('buildAccountSendCalls', () => {
  // On Arc the account holds the tokens itself, so a plain ERC-20 transfer is all it takes.
  it('sends on Arc as one transfer(recipient, amount)', () => {
    const calls = buildAccountSendCalls({ token: EURC, amount: 5_000000n, dest: 'Arc', recipient: FRIEND, fast: true, account: ACCOUNT })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.to).toBe(EURC)
    const call = decodeFunctionData({ abi: erc20Abi, data: calls[0]!.data })
    expect(call.functionName).toBe('transfer')
    expect(call.args).toEqual([FRIEND, 5_000000n])
  })

  // Both calls go in one user operation, so the approval and the burn succeed or fail together.
  it('sends to Base fast as approve then depositForBurnWithHook with the forward hook', () => {
    const calls = buildAccountSendCalls({ token: USDC, amount: 20_000000n, dest: 'Base', recipient: FRIEND, maxFee: 150_000n, fast: true, account: ACCOUNT })
    expect(calls).toHaveLength(2)
    expect(calls[0]!.to).toBe(USDC)
    const approve = decodeFunctionData({ abi: erc20Abi, data: calls[0]!.data })
    expect(approve.functionName).toBe('approve')
    expect(approve.args).toEqual([TOKEN_MESSENGER_V2, 20_000000n])
    expect(calls[1]!.to).toBe(TOKEN_MESSENGER_V2)
    const burn = decodeFunctionData({ abi: messengerAbi, data: calls[1]!.data })
    expect(burn.functionName).toBe('depositForBurnWithHook')
    expect(burn.args).toEqual([20_000000n, 6, pad(FRIEND, { size: 32 }), USDC, zeroHash, 150_000n, 1000, FORWARD_HOOK_DATA])
  })

  it('uses the standard finality threshold when not fast', () => {
    const calls = buildAccountSendCalls({ token: USDC, amount: 20_000000n, dest: 'Polygon', recipient: FRIEND, maxFee: 10_000n, fast: false, account: ACCOUNT })
    const burn = decodeFunctionData({ abi: messengerAbi, data: calls[1]!.data })
    expect(burn.args[1]).toBe(7)
    expect(burn.args[6]).toBe(2000)
  })

  // Sending to itself only burns gas on Arc, and on another chain no one may control the account's address.
  it('refuses the account itself and the zero address', () => {
    const base = { token: USDC, amount: 1_000000n, dest: 'Arc' as const, fast: true, account: ACCOUNT }
    expect(() => buildAccountSendCalls({ ...base, recipient: ACCOUNT.toLowerCase() as Address })).toThrow('Choose a different address.')
    expect(() => buildAccountSendCalls({ ...base, recipient: zeroAddress })).toThrow('Choose a different address.')
  })

  // CCTP only moves USDC. A EURC burn would revert, or worse, so it never gets built.
  it('refuses EURC to another chain', () => {
    expect(() =>
      buildAccountSendCalls({ token: EURC, amount: 1_000000n, dest: 'Base', recipient: FRIEND, maxFee: 1n, fast: true, account: ACCOUNT }),
    ).toThrow('EURC can only be sent on Arc.')
  })

  // The fee comes out of the burned amount, so a fee at or above it would deliver nothing.
  it('refuses an amount that does not cover the transfer fee', () => {
    const p = { token: USDC, amount: 100_000n, dest: 'Base' as const, recipient: FRIEND, fast: true, account: ACCOUNT }
    expect(() => buildAccountSendCalls({ ...p, maxFee: 100_000n })).toThrow('This amount is too small to cover the transfer fee.')
    expect(() => buildAccountSendCalls({ ...p, maxFee: 200_000n })).toThrow('This amount is too small to cover the transfer fee.')
  })

  it('needs a fee quote for another chain', () => {
    expect(() => buildAccountSendCalls({ token: USDC, amount: 1_000000n, dest: 'Base', recipient: FRIEND, fast: true, account: ACCOUNT })).toThrow()
  })
})

describe('buildAccountSendCalls address checks', () => {
  const BAD_CHECKSUM = '0xaBcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD' as Address
  const LOWER = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Address

  // pad() does not check the checksum, so without this a burn would mint to the mistyped address.
  it('refuses a bad checksum before encoding anything', () => {
    const p = { token: USDC, amount: 2_000000n, recipient: BAD_CHECKSUM, maxFee: 1n, fast: true, account: ACCOUNT }
    expect(() => buildAccountSendCalls({ ...p, dest: 'Base' })).toThrow('This address has a typo. Check it and paste it again.')
    expect(() => buildAccountSendCalls({ ...p, dest: 'Arc' })).toThrow('This address has a typo. Check it and paste it again.')
  })

  it('accepts an all-lowercase address', () => {
    const calls = buildAccountSendCalls({ token: USDC, amount: 2_000000n, dest: 'Base', recipient: LOWER, maxFee: 1n, fast: true, account: ACCOUNT })
    const burn = decodeFunctionData({ abi: messengerAbi, data: calls[1]!.data })
    expect(burn.args[2]).toBe(pad(LOWER, { size: 32 }))
  })
})

describe('maxAccountSend', () => {
  // The account pays Arc gas in USDC, so the buffer always stays behind.
  it('keeps the gas buffer and never goes below zero', () => {
    expect(maxAccountSend(1_000000n, 50_000n)).toBe(950_000n)
    expect(maxAccountSend(50_000n, 50_000n)).toBe(0n)
    expect(maxAccountSend(10_000n, 50_000n)).toBe(0n)
  })
})

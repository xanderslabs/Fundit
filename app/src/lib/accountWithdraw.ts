import { type Address, encodeFunctionData, isAddressEqual, pad, parseAbi, zeroAddress, zeroHash } from 'viem'
import { erc20Abi } from '../abi/erc20'
import { CCTP_CHAINS, CHAIN_LABELS, FORWARD_HOOK_DATA, TOKEN_MESSENGER_V2, TOKENS } from '../config'
import { PlainError } from './errors'
import type { PayoutDest } from './payout'
import type { Call } from './sender'

// CCTP finality thresholds: 1000 is a Fast transfer, 2000 is Standard.
const FAST_THRESHOLD = 1000
const STANDARD_THRESHOLD = 2000

export const OWN_ADDRESS = 'Choose a different address.'
export const EURC_ARC_ONLY = 'EURC can only be sent on Arc.'
export const TOO_SMALL = 'This amount is too small to cover the transfer fee.'

// Circle's TokenMessengerV2, the same signature as contracts/src/interfaces/ITokenMessengerV2.sol.
const tokenMessengerAbi = parseAbi([
  'function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)',
])

// The calls that send money out of a Fundit account. They go in one user operation, so one passkey tap.
// On Arc it is a plain transfer. To another chain the account burns USDC through CCTP with the forward hook,
// and Circle's forwarder mints amount minus the fee to the recipient there.
export function buildAccountSendCalls(p: {
  token: Address
  amount: bigint
  dest: PayoutDest
  recipient: Address
  maxFee?: bigint
  fast: boolean
  account: Address
}): Call[] {
  if (isAddressEqual(p.recipient, zeroAddress) || isAddressEqual(p.recipient, p.account)) throw new PlainError(OWN_ADDRESS)
  if (p.dest === 'Arc') {
    return [{ to: p.token, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [p.recipient, p.amount] }) }]
  }
  if (!isAddressEqual(p.token, TOKENS.USDC.address)) throw new PlainError(EURC_ARC_ONLY)
  if (p.maxFee === undefined) throw new Error('A fee quote is needed to send to another chain.')
  if (p.maxFee >= p.amount) throw new PlainError(TOO_SMALL)
  const chain = CCTP_CHAINS.find((c) => c.key === p.dest)!
  if (p.fast && !chain.fast) throw new Error(`Fast transfers are not available to ${CHAIN_LABELS[chain.key]}.`)
  const args = [
    p.amount,
    chain.domain,
    pad(p.recipient, { size: 32 }),
    TOKENS.USDC.address,
    zeroHash,
    p.maxFee,
    p.fast ? FAST_THRESHOLD : STANDARD_THRESHOLD,
    FORWARD_HOOK_DATA,
  ] as const
  return [
    { to: TOKENS.USDC.address, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [TOKEN_MESSENGER_V2, p.amount] }) },
    { to: TOKEN_MESSENGER_V2, data: encodeFunctionData({ abi: tokenMessengerAbi, functionName: 'depositForBurnWithHook', args }) },
  ]
}

// The most USDC that can leave: the account pays Arc gas in USDC, so the gas buffer stays behind.
export function maxAccountSend(balance: bigint, gasBuffer: bigint): bigint {
  return balance > gasBuffer ? balance - gasBuffer : 0n
}

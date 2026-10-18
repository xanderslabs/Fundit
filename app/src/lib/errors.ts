import { BaseError, decodeErrorResult, type Hex, UserRejectedRequestError } from 'viem'
import { campaignAbi } from '../abi/campaign'
import { factoryAbi } from '../abi/factory'
import { CCTP_CHAINS, CHAIN_LABELS, NETWORK } from '../config'
import { formatAmount } from './format'

// Plain text for every custom error in Campaign and CampaignFactory. errors.test.ts checks none is missing.
const ERROR_TEXT: Record<string, string> = {
  // Campaign
  AlreadyInitialized: 'This Fundit is already set up.',
  CampaignClosed: 'This Fundit is closed.',
  CannotSweepCampaignToken: "The Fundit's own token cannot be returned this way. Use withdraw instead.",
  FeeTooHighForAmount: 'This amount is too small to cover the fee. Try a larger amount.',
  InsufficientBalance: 'There is not enough balance for this.',
  InvalidBackup: 'The backup address must be different from the organiser address.',
  InvalidGoal: 'The goal must be above 0.',
  InvalidMetadata: 'The title, description, image or links are over the limits. Check each field.',
  InvalidRecipient: 'That recipient address is not valid.',
  MessageTooLong: 'The message is too long. Keep it to 280 bytes.',
  NoRecoveryPending: 'There is no recovery in progress.',
  NotBackup: 'Only the backup address can do this.',
  NotCreator: 'Only the organiser can do this.',
  RecoveryNotReady: 'The 7-day recovery wait has not passed yet.',
  RecoveryPending: 'A recovery is already in progress.',
  ReentrancyGuardReentrantCall: 'The Fundit refused a nested call.',
  SafeERC20FailedOperation: 'The token transfer failed. Check your balance and approval.',
  UnsupportedPayoutDomain: 'EURC can only be paid out on Arc.',
  ZeroAddress: 'An address is missing.',
  ZeroAmount: 'Enter an amount above 0.',
  // CampaignFactory
  CreationPaused: 'Creating new Fundits is paused right now. Try again later.',
  FailedDeployment: 'The Fundit could not be created. Try again.',
  FeeTooHigh: 'That fee is above the allowed maximum.',
  InvalidDomain: 'That destination chain is not supported.',
  NotCampaign: 'That address is not a Fundit.',
  OwnableInvalidOwner: 'That owner address is not valid.',
  OwnableUnauthorizedAccount: 'Only the Fundit owner can do this.',
  RenounceDisabled: 'Ownership cannot be given up.',
  UnsupportedToken: 'Only USDC and EURC are supported.',
}

const ABI = [...campaignAbi, ...factoryAbi]
const GENERIC = 'Something went wrong. Nothing was sent.'
const MAX_DETAIL = 160

// Every link in the error's cause chain, outermost first. Circle's kits wrap the original error as
// cause: { trace: { rawError } }, so a link with no cause continues at its trace.rawError.
function chain(e: unknown): unknown[] {
  const out: unknown[] = []
  let cur = e
  while (cur && typeof cur === 'object' && out.length < 20) {
    out.push(cur)
    const x = cur as { cause?: unknown; trace?: { rawError?: unknown } }
    cur = x.cause ?? x.trace?.rawError
  }
  return out
}

// Circle's KitError for an RPC failure (RPC_ENDPOINT_ERROR) reuses code 4001, which EIP-1193 uses for a
// user rejection. Such a link is a network problem, never a cancel.
function isKitRpcError(x: unknown): boolean {
  const { name, type } = x as { name?: unknown; type?: unknown }
  return type === 'RPC' || (typeof name === 'string' && name.startsWith('RPC_'))
}

// Bridge Kit chain names (Base, or Base_Sepolia on testnet). Its messages fall back to 'token' and 'native token'.
function nativeSymbol(chainName: string): string {
  return CCTP_CHAINS.find((c) => c.bridgeKitChain === chainName)?.viemChain.nativeCurrency.symbol ?? 'native token'
}

// The name people know, for a Bridge Kit chain name (OP Mainnet for Optimism, Base Sepolia for Base_Sepolia).
function chainLabel(chainName: string): string {
  if (chainName === NETWORK.bridgeKitChain) return CHAIN_LABELS.Arc
  const chain = CCTP_CHAINS.find((c) => c.bridgeKitChain === chainName)
  return chain ? CHAIN_LABELS[chain.key] : chainName
}

// Plain text for Circle Bridge Kit errors, by KitError name. The messages name the token and chain.
function kitText(e: unknown): string | null {
  for (const x of chain(e)) {
    const { name, message } = x as { name?: unknown; message?: unknown }
    if (typeof message !== 'string') continue
    if (name === 'BALANCE_INSUFFICIENT_TOKEN') {
      const m = /^Insufficient (\S+) balance on (.+)$/.exec(message)
      // Only USDC moves on this path, so the 'token' placeholder means USDC.
      if (m) return `You do not have enough ${m[1] === 'token' ? 'USDC' : m[1]} on ${chainLabel(m[2]!)}.`
    }
    if (name === 'BALANCE_INSUFFICIENT_GAS') {
      const m = /^Insufficient (.+) on (.+) to cover gas fees$/.exec(message)
      if (m) return `You do not have enough ${m[1] === 'native token' ? nativeSymbol(m[2]!) : m[1]} on ${chainLabel(m[2]!)} to pay the network fee.`
    }
    if (isKitRpcError(x)) {
      const traced = (x as { cause?: { trace?: { chain?: unknown } } }).cause?.trace?.chain
      const chainName = typeof traced === 'string' && traced !== '' ? traced : / on (.+)$/.exec(message)?.[1]
      return chainName
        ? `The ${chainLabel(chainName)} network did not answer. Try again in a moment.`
        : 'The network did not answer. Try again in a moment.'
    }
  }
  return null
}

// A message written for the person, shown as it is. explainError adds no generic prefix to it.
export class PlainError extends Error {}

// NotAllowedError is what the browser throws when someone closes the passkey prompt.
export function isUserRejection(e: unknown): boolean {
  return chain(e).some(
    (x) =>
      x instanceof UserRejectedRequestError ||
      (x as { name?: unknown }).name === 'NotAllowedError' ||
      (!isKitRpcError(x) && (x as { code?: unknown }).code === UserRejectedRequestError.code),
  )
}

// Circle's rule for a passkey username: 5 to 50 characters, only letters, digits and _ @ . : + -. Its RPC
// refuses any other name with error -32025, "The username is invalid. It should be 5 to 50 characters and
// contain only alphanumeric and _@.:+- characters.", which viem shows as "An unknown RPC error occurred."
export const USERNAME_PATTERN = /^[A-Za-z0-9_@.:+-]{5,50}$/
export const USERNAME_RULE = 'Use 5 to 50 letters, numbers or _ @ . : + - (no spaces).'

// The text of every link in the chain: message, details and viem's shortMessage.
function texts(e: unknown): string[] {
  return chain(e).flatMap((x) => {
    const { message, details, shortMessage } = x as { message?: unknown; details?: unknown; shortMessage?: unknown }
    return [message, details, shortMessage].filter((t): t is string => typeof t === 'string')
  })
}

// Matched on Circle's text, not on -32025 alone: that code is not known to mean only a bad username.
export function isInvalidUsername(e: unknown): boolean {
  return texts(e).some((t) => /username is invalid/i.test(t))
}

// A Fundit account pays its own gas, so the EntryPoint takes the prefund from its USDC first. The person sees the
// real number (passkeySender works it out) and a way to add money.
export class NeedsNetworkFee extends PlainError {
  constructor(readonly reserve: bigint) {
    super(`Your Fundit account needs at least ${formatAmount(reserve, 'USDC')} for the network fee. Add money and try again.`)
  }
}
const NO_NETWORK_FEE = 'Your Fundit account does not have enough USDC for the network fee. Add money and try again.'

// AA21 is the EntryPoint's "didn't pay prefund": the account could not cover the operation's gas.
export function isPrefundError(e: unknown): boolean {
  return texts(e).some((t) => /\bAA21\b|didn't pay prefund/i.test(t))
}

// Circle's bundler answered "Missing or invalid parameters" when a short account tried to create a Fundit on
// Arc testnet. The text is not specific to gas, so callers check the balance before reading it that way.
export function isMissingParams(e: unknown): boolean {
  return texts(e).some((t) => /Missing or invalid parameters/i.test(t))
}

// True when the fix is to add money, so the page can link to Add money.
export function needsAddMoney(e: unknown): boolean {
  return chain(e).some((x) => x instanceof NeedsNetworkFee) || isPrefundError(e)
}

function revertName(e: unknown): string | null {
  for (const x of chain(e)) {
    const named = (x as { data?: { errorName?: unknown } }).data?.errorName
    if (typeof named === 'string') return named
    // Injected wallets nest the revert hex at data, data.data or data.originalError.data.
    const data = (x as { data?: { data?: unknown; originalError?: { data?: unknown } } }).data
    for (const candidate of [data, data?.data, data?.originalError?.data]) {
      if (typeof candidate !== 'string' || !/^0x[0-9a-fA-F]{8}/.test(candidate)) continue
      try {
        return decodeErrorResult({ abi: ABI, data: candidate as Hex }).errorName
      } catch {
        // Not one of ours. Keep looking further down the chain.
      }
    }
  }
  return null
}

function detail(e: unknown): string {
  const text =
    e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e)
  const line = text.split('\n')[0]!.trim()
  return line.length > MAX_DETAIL ? `${line.slice(0, MAX_DETAIL)}...` : line
}

// generic is the fallback text for an error we cannot name.
export function explainError(e: unknown, generic = GENERIC): string {
  if (isUserRejection(e)) return 'You cancelled the request.'
  if (e instanceof PlainError) return e.message
  if (isInvalidUsername(e)) return USERNAME_RULE
  if (isPrefundError(e)) return NO_NETWORK_FEE
  const kit = kitText(e)
  if (kit) return kit
  const name = revertName(e)
  if (name && ERROR_TEXT[name]) return ERROR_TEXT[name]
  const d = detail(e)
  return d ? `${generic} (${d})` : generic
}

// For adding money from another chain, which can fail after the wallet already approved something.
// "Nothing was sent" may be untrue there.
export function explainAfterApproval(e: unknown): string {
  return explainError(e, 'Something went wrong.')
}

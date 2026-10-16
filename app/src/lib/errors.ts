import { BaseError, decodeErrorResult, type Hex, UserRejectedRequestError } from 'viem'
import { campaignAbi } from '../abi/campaign'
import { factoryAbi } from '../abi/factory'
import { CCTP_CHAINS } from '../config'

// Plain text for every custom error in Campaign and CampaignFactory. errors.test.ts checks none is missing.
const ERROR_TEXT: Record<string, string> = {
  // Campaign
  AlreadyInitialized: 'This campaign is already set up.',
  CampaignClosed: 'This campaign is closed.',
  CannotSweepCampaignToken: "The campaign's own token cannot be returned this way. Use withdraw instead.",
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
  ReentrancyGuardReentrantCall: 'The campaign refused a nested call.',
  SafeERC20FailedOperation: 'The token transfer failed. Check your balance and approval.',
  UnsupportedPayoutDomain: 'EURC can only be paid out on Arc.',
  ZeroAddress: 'An address is missing.',
  ZeroAmount: 'Enter an amount above 0.',
  // CampaignFactory
  CreationPaused: 'Creating new fundraisers is paused right now. Try again later.',
  FailedDeployment: 'The fundraiser could not be created. Try again.',
  FeeTooHigh: 'That fee is above the allowed maximum.',
  InvalidDomain: 'That destination chain is not supported.',
  NotCampaign: 'That address is not a Fundit campaign.',
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

// Bridge Kit chain names match our CCTP chain keys. Its messages fall back to 'token' and 'native token'.
function nativeSymbol(chainName: string): string {
  return CCTP_CHAINS.find((c) => c.key === chainName)?.viemChain.nativeCurrency.symbol ?? 'native token'
}

// Plain text for Circle Bridge Kit errors, by KitError name. The messages name the token and chain.
function kitText(e: unknown): string | null {
  for (const x of chain(e)) {
    const { name, message } = x as { name?: unknown; message?: unknown }
    if (typeof message !== 'string') continue
    if (name === 'BALANCE_INSUFFICIENT_TOKEN') {
      const m = /^Insufficient (\S+) balance on (.+)$/.exec(message)
      // Only USDC moves on this path, so the 'token' placeholder means USDC.
      if (m) return `You do not have enough ${m[1] === 'token' ? 'USDC' : m[1]} on ${m[2]}.`
    }
    if (name === 'BALANCE_INSUFFICIENT_GAS') {
      const m = /^Insufficient (.+) on (.+) to cover gas fees$/.exec(message)
      if (m) return `You do not have enough ${m[1] === 'native token' ? nativeSymbol(m[2]!) : m[1]} on ${m[2]} to pay the network fee.`
    }
    if (isKitRpcError(x)) {
      const traced = (x as { cause?: { trace?: { chain?: unknown } } }).cause?.trace?.chain
      const name = typeof traced === 'string' && traced !== '' ? traced : / on (.+)$/.exec(message)?.[1]
      return name ? `The ${name} network did not answer. Try again in a moment.` : 'The network did not answer. Try again in a moment.'
    }
  }
  return null
}

export function isUserRejection(e: unknown): boolean {
  return chain(e).some(
    (x) =>
      x instanceof UserRejectedRequestError || (!isKitRpcError(x) && (x as { code?: unknown }).code === UserRejectedRequestError.code),
  )
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

export function explainError(e: unknown): string {
  if (isUserRejection(e)) return 'You cancelled the request.'
  const kit = kitText(e)
  if (kit) return kit
  const name = revertName(e)
  if (name && ERROR_TEXT[name]) return ERROR_TEXT[name]
  const d = detail(e)
  return d ? `${GENERIC} (${d})` : GENERIC
}

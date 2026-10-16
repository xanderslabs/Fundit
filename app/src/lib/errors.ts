import { BaseError, decodeErrorResult, type Hex, UserRejectedRequestError } from 'viem'
import { campaignAbi } from '../abi/campaign'
import { factoryAbi } from '../abi/factory'

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

// Every link in the error's cause chain, outermost first.
function chain(e: unknown): unknown[] {
  const out: unknown[] = []
  let cur = e
  while (cur && typeof cur === 'object' && out.length < 20) {
    out.push(cur)
    cur = (cur as { cause?: unknown }).cause
  }
  return out
}

export function isUserRejection(e: unknown): boolean {
  return chain(e).some(
    (x) => x instanceof UserRejectedRequestError || (x as { code?: unknown }).code === UserRejectedRequestError.code,
  )
}

function revertName(e: unknown): string | null {
  for (const x of chain(e)) {
    const named = (x as { data?: { errorName?: unknown } }).data?.errorName
    if (typeof named === 'string') return named
    const data = (x as { data?: unknown }).data
    if (typeof data === 'string' && /^0x[0-9a-fA-F]{8}/.test(data)) {
      try {
        return decodeErrorResult({ abi: ABI, data: data as Hex }).errorName
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
  const name = revertName(e)
  if (name && ERROR_TEXT[name]) return ERROR_TEXT[name]
  const d = detail(e)
  return d ? `${GENERIC} (${d})` : GENERIC
}

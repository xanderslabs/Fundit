import type { Address, Hex } from 'viem'
import { type AdminNetwork, ADMIN_NETWORKS } from './networks'
import type { OwnerAction } from './ownerActions'

// How much the owner must do before the wallet is asked to sign, scaled to the risk of the change.
export type ConfirmKind = 'none' | 'dialog' | 'typed'

export function confirmKind(action: OwnerAction): ConfirmKind {
  switch (action.kind) {
    case 'setFeatured':
      return 'none'
    case 'setTreasury':
      return 'typed'
    default:
      return 'dialog'
  }
}

// The treasury confirm: the last 4 characters of the new address, in any case.
export function typedConfirmOk(input: string, address: Address): boolean {
  return input.trim().toLowerCase() === address.slice(-4).toLowerCase()
}

export type FlowStep = 'edit' | 'switchChain' | 'simulating' | 'simulateFailed' | 'confirm' | 'waitingWallet' | 'sent' | 'confirmed' | 'failed'

// request is what the simulation returned; it is the only thing the wallet is ever asked to sign.
export type FlowState = { step: FlowStep; action?: OwnerAction; request?: unknown; hash?: Hex; error?: string }

export type FlowEvent =
  | { type: 'review'; action: OwnerAction; network: AdminNetwork; walletChainId: number | undefined }
  | { type: 'switched' }
  | { type: 'simulated'; request: unknown }
  | { type: 'simulateFailed'; error: string }
  | { type: 'sign'; typed?: string }
  | { type: 'sent'; hash: Hex }
  | { type: 'confirmed' }
  | { type: 'failed'; error: string }
  | { type: 'cancel' }

export const IDLE: FlowState = { step: 'edit' }

// While one of these is under way, no other change can start.
export function inFlight(step: FlowStep): boolean {
  return step === 'switchChain' || step === 'simulating' || step === 'waitingWallet' || step === 'sent'
}

// One owner change, from Review to the receipt. The only way to waitingWallet is a successful simulation: through
// confirm (and, for the treasury, the typed check), or straight from simulating when the change needs no confirm.
// An event that does not fit the current step returns the state unchanged.
export function flow(state: FlowState, event: FlowEvent): FlowState {
  const { step, action } = state
  switch (event.type) {
    case 'review':
      if (inFlight(step) || step === 'confirm') return state
      return {
        step: event.walletChainId === ADMIN_NETWORKS[event.network].chainId ? 'simulating' : 'switchChain',
        action: event.action,
      }
    case 'switched':
      return step === 'switchChain' ? { step: 'simulating', action } : state
    case 'simulated':
      if (step !== 'simulating' || !action) return state
      return { step: confirmKind(action) === 'none' ? 'waitingWallet' : 'confirm', action, request: event.request }
    case 'simulateFailed':
      return step === 'simulating' ? { step: 'simulateFailed', action, error: event.error } : state
    case 'sign':
      if (step !== 'confirm' || !action) return state
      if (action.kind === 'setTreasury' && !typedConfirmOk(event.typed ?? '', action.treasury)) return state
      return { ...state, step: 'waitingWallet' }
    case 'sent':
      return step === 'waitingWallet' ? { ...state, step: 'sent', hash: event.hash } : state
    case 'confirmed':
      return step === 'sent' ? { ...state, step: 'confirmed' } : state
    case 'failed':
      // A refused chain switch goes back to the form; a failed signature or receipt keeps the hash if there is one.
      if (step === 'switchChain') return { step: 'edit', action, error: event.error }
      if (step === 'waitingWallet' || step === 'sent') return { ...state, step: 'failed', error: event.error }
      return state
    case 'cancel':
      return step === 'confirm' ? IDLE : state
  }
}

import { type Address, isAddress, isAddressEqual, zeroAddress } from 'viem'
import { factoryAbi } from '../../../src/abi/factory'
import { ARC_CHAIN_ID } from '../../../src/config'
import type { FactoryState } from './factoryState'

// The five CampaignFactory calls the owner can make from the panel. Ownership transfer and renounce are left out.
export type OwnerAction =
  | { kind: 'setFees'; donationBps: number; withdrawBps: number }
  | { kind: 'setTreasury'; treasury: Address }
  | { kind: 'setFeatured'; campaign: Address }
  | { kind: 'pauseCreation' }
  | { kind: 'unpauseCreation' }

type Refused = { ok: false; reason: string }

const MAX_FEE_BPS = 500

function same(a: Address, b: Address): boolean {
  return isAddressEqual(a, b)
}

// Whether the connected wallet may send an owner call: it must be the account the server signed in, still the
// factory's owner on chain, and on Arc. The contract enforces ownership too; this keeps a wrong click from reaching it.
export function canAct(
  account: Address | undefined,
  chainId: number | undefined,
  sessionAddress: Address,
  s: FactoryState,
): { ok: true } | Refused {
  if (!account || !same(account, sessionAddress) || !same(account, s.owner)) {
    return { ok: false, reason: `Connect the owner wallet ending ${sessionAddress.slice(-4).toLowerCase()} to make changes.` }
  }
  if (chainId !== ARC_CHAIN_ID) return { ok: false, reason: 'Switch your wallet to Arc.' }
  return { ok: true }
}

function bps(label: string, input: string): { ok: true; value: number } | Refused {
  if (!/^\d+$/.test(input.trim()) || input !== input.trim()) return { ok: false, reason: `${label} must be a whole number of bps, such as 250.` }
  const value = Number(input)
  if (value > MAX_FEE_BPS) return { ok: false, reason: `${label} cannot be above ${MAX_FEE_BPS} bps (5%).` }
  return { ok: true, value }
}

export function checkFees(
  donation: string,
  withdraw: string,
): { ok: true; donationBps: number; withdrawBps: number } | Refused {
  const d = bps('The donation fee', donation)
  if (!d.ok) return d
  const w = bps('The withdraw fee', withdraw)
  if (!w.ok) return w
  return { ok: true, donationBps: d.value, withdrawBps: w.value }
}

export async function checkTreasury(
  input: string,
  confirm: string,
  factory: Address,
  isCampaign: (a: Address) => Promise<boolean>,
): Promise<{ ok: true; address: Address } | Refused> {
  const a = input.trim()
  const b = confirm.trim()
  if (!isAddress(a)) return { ok: false, reason: 'Enter a valid treasury address.' }
  if (!isAddress(b) || !same(a, b)) return { ok: false, reason: 'The two addresses do not match.' }
  if (same(a, zeroAddress)) return { ok: false, reason: 'The treasury cannot be the zero address.' }
  if (same(a, factory)) return { ok: false, reason: 'The treasury cannot be the factory.' }
  if (await isCampaign(a)) return { ok: false, reason: 'The treasury cannot be a Fundit.' }
  return { ok: true, address: a }
}

// An empty input clears the featured Fundit.
export async function checkFeatured(
  input: string,
  isCampaign: (a: Address) => Promise<boolean>,
): Promise<{ ok: true; campaign: Address } | Refused> {
  const a = input.trim()
  if (a === '') return { ok: true, campaign: zeroAddress }
  if (!isAddress(a)) return { ok: false, reason: 'Enter a valid Fundit address.' }
  if (!(await isCampaign(a))) return { ok: false, reason: 'That address is not a Fundit.' }
  return { ok: true, campaign: a }
}

// The factory comes from the signed-in session and the chain is Arc, never from a form field.
export function buildCall(
  action: OwnerAction,
  factory: Address,
): {
  address: Address
  abi: typeof factoryAbi
  functionName: 'setFees' | 'setTreasury' | 'setFeatured' | 'pauseCreation' | 'unpauseCreation'
  args: readonly unknown[]
  chainId: number
} {
  const base = { address: factory, abi: factoryAbi, chainId: ARC_CHAIN_ID }
  switch (action.kind) {
    case 'setFees':
      return { ...base, functionName: 'setFees', args: [action.donationBps, action.withdrawBps] }
    case 'setTreasury':
      return { ...base, functionName: 'setTreasury', args: [action.treasury] }
    case 'setFeatured':
      return { ...base, functionName: 'setFeatured', args: [action.campaign] }
    case 'pauseCreation':
      return { ...base, functionName: 'pauseCreation', args: [] }
    case 'unpauseCreation':
      return { ...base, functionName: 'unpauseCreation', args: [] }
  }
}

function fee(n: number): string {
  return `${n} bps (${n / 100}%)`
}

function featured(a: Address): string {
  return same(a, zeroAddress) ? 'None' : a
}

// What the confirm step shows: the function, the value now and the value after.
export function describe(action: OwnerAction, s: FactoryState): { functionName: string; current: string; next: string; note?: string } {
  switch (action.kind) {
    case 'setFees':
      return {
        functionName: 'setFees',
        current: `Donation ${fee(s.donationFeeBps)}, withdraw ${fee(s.withdrawFeeBps)}`,
        next: `Donation ${fee(action.donationBps)}, withdraw ${fee(action.withdrawBps)}`,
        note: 'Applies to new Fundits only.',
      }
    case 'setTreasury':
      return { functionName: 'setTreasury', current: s.treasury, next: action.treasury }
    case 'setFeatured':
      return { functionName: 'setFeatured', current: featured(s.featured), next: featured(action.campaign) }
    case 'pauseCreation':
      return {
        functionName: 'pauseCreation',
        current: s.paused ? 'Paused' : 'Open',
        next: 'Paused',
        note: 'Stops new Fundits only. Existing Fundits keep working.',
      }
    case 'unpauseCreation':
      return { functionName: 'unpauseCreation', current: s.paused ? 'Paused' : 'Open', next: 'Open' }
  }
}

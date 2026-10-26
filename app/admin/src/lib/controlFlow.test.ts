import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { confirmKind, flow, type FlowEvent, type FlowState, type FlowStep, IDLE, typedConfirmOk } from './controlFlow'
import { ADMIN_NETWORKS } from './networks'
import type { OwnerAction } from './ownerActions'

const TESTNET = ADMIN_NETWORKS.testnet.chainId
const MAINNET = ADMIN_NETWORKS.mainnet.chainId
const TREASURY = '0x333333333333333333333333333333333333aBcD' as Address
const HASH = `0x${'ab'.repeat(32)}` as const
const fees: OwnerAction = { kind: 'setFees', donationBps: 100, withdrawBps: 50 }
const treasury: OwnerAction = { kind: 'setTreasury', treasury: TREASURY }
const featured: OwnerAction = { kind: 'setFeatured', campaign: TREASURY }

function run(events: FlowEvent[], from: FlowState = IDLE): FlowState {
  return events.reduce(flow, from)
}

const review = (action: OwnerAction, walletChainId: number | undefined = TESTNET): FlowEvent => ({ type: 'review', action, network: 'testnet', walletChainId })

// The wallet is only ever asked to sign a call that has just simulated against the selected network's factory.
// A path to waitingWallet that skips the simulation would let a reverting or wrong-chain call reach the owner's wallet.
describe('flow', () => {
  it('never reaches waitingWallet without a successful simulation', () => {
    const failed = run([review(fees), { type: 'simulateFailed', error: 'Only the Fundit owner can do this.' }])
    expect(failed.step).toBe('simulateFailed')
    expect(failed.error).toBe('Only the Fundit owner can do this.')
    expect(flow(failed, { type: 'sign' }).step).toBe('simulateFailed')
    // No step but confirm moves to waitingWallet on sign, and "simulated" only counts while simulating.
    const steps: FlowStep[] = ['edit', 'switchChain', 'simulating', 'simulateFailed', 'confirm', 'waitingWallet', 'sent', 'confirmed', 'failed']
    for (const step of steps) {
      const s: FlowState = { step, action: fees }
      const signed = flow(s, { type: 'sign' })
      if (step === 'confirm') expect(signed.step).toBe('waitingWallet')
      else expect(signed).toBe(s)
      if (step !== 'simulating') expect(flow(s, { type: 'simulated', request: {} })).toBe(s)
    }
    // A sign event with no action under review does nothing either.
    expect(flow({ step: 'confirm' }, { type: 'sign' }).step).toBe('confirm')
  })

  it('featured skips the confirm step, fees and pause use a dialog, treasury needs typing', () => {
    expect(confirmKind(featured)).toBe('none')
    expect(confirmKind(fees)).toBe('dialog')
    expect(confirmKind({ kind: 'pauseCreation' })).toBe('dialog')
    expect(confirmKind({ kind: 'unpauseCreation' })).toBe('dialog')
    expect(confirmKind(treasury)).toBe('typed')

    expect(run([review(featured), { type: 'simulated', request: {} }]).step).toBe('waitingWallet')
    expect(run([review(fees), { type: 'simulated', request: {} }]).step).toBe('confirm')

    // The treasury signs only once the last 4 characters are typed.
    const atConfirm = run([review(treasury), { type: 'simulated', request: {} }])
    expect(atConfirm.step).toBe('confirm')
    expect(flow(atConfirm, { type: 'sign' }).step).toBe('confirm')
    expect(flow(atConfirm, { type: 'sign', typed: '1234' }).step).toBe('confirm')
    expect(flow(atConfirm, { type: 'sign', typed: 'abcd' }).step).toBe('waitingWallet')
  })

  it('typedConfirmOk accepts the last 4 characters in any case and refuses others', () => {
    expect(typedConfirmOk('aBcD', TREASURY)).toBe(true)
    expect(typedConfirmOk('ABCD', TREASURY)).toBe(true)
    expect(typedConfirmOk(' abcd ', TREASURY)).toBe(true)
    for (const bad of ['', 'abc', 'bcd', '3abcd', 'abce', '0x3333']) expect(typedConfirmOk(bad, TREASURY)).toBe(false)
  })

  it('asks to switch chain when the wallet is on the other Arc network', () => {
    const s = flow(IDLE, { type: 'review', action: fees, network: 'mainnet', walletChainId: TESTNET })
    expect(s.step).toBe('switchChain')
    // Nothing simulates until the switch is done.
    expect(flow(s, { type: 'simulated', request: {} })).toBe(s)
    expect(flow(s, { type: 'switched' }).step).toBe('simulating')
    // A refused switch goes back to the form with the reason.
    expect(flow(s, { type: 'failed', error: 'refused' })).toMatchObject({ step: 'edit', error: 'refused' })
    // On the right chain, review goes straight to the simulation.
    expect(flow(IDLE, { type: 'review', action: fees, network: 'mainnet', walletChainId: MAINNET }).step).toBe('simulating')
    expect(flow(IDLE, { type: 'review', action: fees, network: 'mainnet', walletChainId: undefined }).step).toBe('switchChain')
  })

  it('keeps the hash when waiting for the receipt fails', () => {
    const sent = run([review(fees), { type: 'simulated', request: {} }, { type: 'sign' }, { type: 'sent', hash: HASH }])
    expect(sent).toMatchObject({ step: 'sent', hash: HASH })
    expect(flow(sent, { type: 'failed', error: 'timed out' })).toMatchObject({ step: 'failed', hash: HASH, error: 'timed out' })
    expect(flow(sent, { type: 'confirmed' })).toMatchObject({ step: 'confirmed', hash: HASH })
  })

  it('ignores a new review while a change is in flight', () => {
    for (const step of ['switchChain', 'simulating', 'waitingWallet', 'sent'] as const) {
      const s: FlowState = { step, action: fees }
      expect(flow(s, review(featured))).toBe(s)
    }
    const cancelled = flow(run([review(fees), { type: 'simulated', request: {} }]), { type: 'cancel' })
    expect(cancelled.step).toBe('edit')
  })
})

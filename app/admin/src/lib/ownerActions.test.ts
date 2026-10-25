import { type Address, encodeFunctionData, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { factoryAbi } from '../../../src/abi/factory'
import { ARC_CHAIN_ID } from '../../../src/config'
import type { FactoryState } from './factoryState'
import { buildCall, canAct, checkFees, checkFeatured, checkTreasury, describe as describeAction } from './ownerActions'

const OWNER = '0x3552E9c14C7b6050839009A5B160A4446a1e916D' as Address
const OTHER = '0x1111111111111111111111111111111111111111' as Address
const FACTORY = '0x6890D40a9A472D0d05aDb5938D85B07059ad54ab' as Address
const FUNDIT = '0x2222222222222222222222222222222222222222' as Address
const NEW_TREASURY = '0x3333333333333333333333333333333333333333' as Address

const state: FactoryState = {
  owner: OWNER,
  pendingOwner: zeroAddress,
  donationFeeBps: 100,
  withdrawFeeBps: 50,
  treasury: '0x4444444444444444444444444444444444444444',
  featured: zeroAddress,
  paused: false,
  treasuryBalance: { USDC: 0n, EURC: 0n },
}

const isCampaign = async (a: Address) => a === FUNDIT

describe('buildCall', () => {
  it('always targets the given factory on ARC_CHAIN_ID', () => {
    const calls = [
      buildCall({ kind: 'setFees', donationBps: 1, withdrawBps: 2 }, FACTORY),
      buildCall({ kind: 'setTreasury', treasury: NEW_TREASURY }, FACTORY),
      buildCall({ kind: 'setFeatured', campaign: FUNDIT }, FACTORY),
      buildCall({ kind: 'pauseCreation' }, FACTORY),
      buildCall({ kind: 'unpauseCreation' }, FACTORY),
    ]
    for (const c of calls) {
      expect(c.address).toBe(FACTORY)
      expect(c.chainId).toBe(ARC_CHAIN_ID)
      expect(c.abi).toBe(factoryAbi)
    }
    expect(calls.map((c) => c.functionName)).toEqual(['setFees', 'setTreasury', 'setFeatured', 'pauseCreation', 'unpauseCreation'])
  })

  it('encodes setFees(100, 50) exactly', () => {
    const c = buildCall({ kind: 'setFees', donationBps: 100, withdrawBps: 50 }, FACTORY)
    expect(encodeFunctionData({ abi: c.abi, functionName: 'setFees', args: c.args as [number, number] })).toBe(
      encodeFunctionData({ abi: factoryAbi, functionName: 'setFees', args: [100, 50] }),
    )
  })
})

describe('canAct', () => {
  it('write buttons stay disabled for a non-owner account', () => {
    expect(canAct(OTHER, ARC_CHAIN_ID, OWNER, state)).toEqual({ ok: false, reason: 'Connect the owner wallet ending 916d to make changes.' })
    expect(canAct(undefined, ARC_CHAIN_ID, OWNER, state)).toEqual({ ok: false, reason: 'Connect the owner wallet ending 916d to make changes.' })
  })

  it('refuses when the wallet account differs from the signed-in address', () => {
    // The factory owner moved on while the session still names the old owner.
    const moved = { ...state, owner: OTHER }
    expect(canAct(OWNER, ARC_CHAIN_ID, OWNER, moved).ok).toBe(false)
    // Same owner on chain, but the wallet switched to another account.
    expect(canAct(OTHER, ARC_CHAIN_ID, OWNER, { ...state, owner: OTHER }).ok).toBe(false)
  })

  it('accepts the owner on Arc, whatever the address case', () => {
    expect(canAct(OWNER.toLowerCase() as Address, ARC_CHAIN_ID, OWNER.toLowerCase() as Address, state)).toEqual({ ok: true })
  })

  it('refuses a wrong chain', () => {
    expect(canAct(OWNER, 1, OWNER, state)).toEqual({ ok: false, reason: 'Switch your wallet to Arc.' })
    expect(canAct(OWNER, undefined, OWNER, state)).toEqual({ ok: false, reason: 'Switch your wallet to Arc.' })
  })
})

describe('checkFees', () => {
  it('accepts whole numbers up to 500', () => {
    expect(checkFees('100', '500')).toEqual({ ok: true, donationBps: 100, withdrawBps: 500 })
    expect(checkFees('0', '0')).toEqual({ ok: true, donationBps: 0, withdrawBps: 0 })
  })

  it('fees above 500 bps, negative or not whole are refused before sending', () => {
    for (const bad of ['501', '-1', '1.5', '', 'abc', '1e2', ' ']) {
      expect(checkFees(bad, '10').ok).toBe(false)
      expect(checkFees('10', bad).ok).toBe(false)
    }
  })
})

describe('checkTreasury', () => {
  it('accepts a new address entered twice', async () => {
    expect(await checkTreasury(NEW_TREASURY, NEW_TREASURY.toLowerCase(), FACTORY, isCampaign)).toEqual({ ok: true, address: NEW_TREASURY })
  })

  it('treasury refuses zero, the factory, a Fundit, and two inputs that differ', async () => {
    expect((await checkTreasury(zeroAddress, zeroAddress, FACTORY, isCampaign)).ok).toBe(false)
    expect((await checkTreasury(FACTORY, FACTORY, FACTORY, isCampaign)).ok).toBe(false)
    expect((await checkTreasury(FUNDIT, FUNDIT, FACTORY, isCampaign)).ok).toBe(false)
    expect((await checkTreasury(NEW_TREASURY, OTHER, FACTORY, isCampaign)).ok).toBe(false)
    expect((await checkTreasury('not an address', 'not an address', FACTORY, isCampaign)).ok).toBe(false)
  })
})

describe('checkFeatured', () => {
  it('featured refuses an address that is not a Fundit and clears on empty', async () => {
    expect((await checkFeatured(OTHER, isCampaign)).ok).toBe(false)
    expect(await checkFeatured(FUNDIT, isCampaign)).toEqual({ ok: true, campaign: FUNDIT })
    expect(await checkFeatured('', isCampaign)).toEqual({ ok: true, campaign: zeroAddress })
  })
})

describe('describe', () => {
  it('shows "250 bps (2.5%)" and "Applies to new Fundits only."', () => {
    const d = describeAction({ kind: 'setFees', donationBps: 250, withdrawBps: 50 }, state)
    expect(d.functionName).toBe('setFees')
    expect(d.next).toContain('250 bps (2.5%)')
    expect(d.current).toContain('100 bps (1%)')
    expect(d.note).toBe('Applies to new Fundits only.')
  })

  it('pause note reads "Stops new Fundits only. Existing Fundits keep working."', () => {
    expect(describeAction({ kind: 'pauseCreation' }, state).note).toBe('Stops new Fundits only. Existing Fundits keep working.')
  })
})

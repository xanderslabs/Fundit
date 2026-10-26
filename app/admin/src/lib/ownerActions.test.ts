import { type Address, encodeFunctionData, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { factoryAbi } from '../../../src/abi/factory'
import type { FactoryState } from './factoryState'
import { ADMIN_NETWORKS } from './networks'
import { buildCall, canAct, checkFees, checkFeatured, checkTreasury, describe as describeAction } from './ownerActions'

const OWNER = '0x3552E9c14C7b6050839009A5B160A4446a1e916D' as Address
const OTHER = '0x1111111111111111111111111111111111111111' as Address
const FACTORY = ADMIN_NETWORKS.testnet.factory
const TESTNET = ADMIN_NETWORKS.testnet.chainId
const MAINNET = ADMIN_NETWORKS.mainnet.chainId
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
  it("always targets the network's own factory and chain", () => {
    for (const network of ['mainnet', 'testnet'] as const) {
      const calls = [
        buildCall({ kind: 'setFees', donationBps: 1, withdrawBps: 2 }, network),
        buildCall({ kind: 'setTreasury', treasury: NEW_TREASURY }, network),
        buildCall({ kind: 'setFeatured', campaign: FUNDIT }, network),
        buildCall({ kind: 'pauseCreation' }, network),
        buildCall({ kind: 'unpauseCreation' }, network),
      ]
      for (const c of calls) {
        expect(c.address).toBe(ADMIN_NETWORKS[network].factory)
        expect(c.chainId).toBe(ADMIN_NETWORKS[network].chainId)
        expect(c.abi).toBe(factoryAbi)
      }
      expect(calls.map((c) => c.functionName)).toEqual(['setFees', 'setTreasury', 'setFeatured', 'pauseCreation', 'unpauseCreation'])
    }
    expect(buildCall({ kind: 'pauseCreation' }, 'mainnet').address).toBe('0xf1b2AEF82c37fC41D254D8e06BD7780ce34617d9')
    expect(buildCall({ kind: 'pauseCreation' }, 'mainnet').chainId).toBe(5042)
  })

  it('encodes setFees(100, 50) exactly', () => {
    const c = buildCall({ kind: 'setFees', donationBps: 100, withdrawBps: 50 }, 'testnet')
    expect(encodeFunctionData({ abi: c.abi, functionName: 'setFees', args: c.args as [number, number] })).toBe(
      encodeFunctionData({ abi: factoryAbi, functionName: 'setFees', args: [100, 50] }),
    )
  })
})

describe('canAct', () => {
  it('write buttons stay disabled for a non-owner account', () => {
    expect(canAct(OTHER, TESTNET, OWNER, state, 'testnet')).toEqual({ ok: false, reason: 'Connect the owner wallet ending 916d to make changes.' })
    expect(canAct(undefined, TESTNET, OWNER, state, 'testnet')).toEqual({ ok: false, reason: 'Connect the owner wallet ending 916d to make changes.' })
  })

  it('refuses when the wallet account differs from the signed-in address', () => {
    // The factory owner moved on while the session still names the old owner.
    const moved = { ...state, owner: OTHER }
    expect(canAct(OWNER, TESTNET, OWNER, moved, 'testnet').ok).toBe(false)
    // Same owner on chain, but the wallet switched to another account.
    expect(canAct(OTHER, TESTNET, OWNER, { ...state, owner: OTHER }, 'testnet').ok).toBe(false)
  })

  it('accepts the owner on Arc, whatever the address case', () => {
    expect(canAct(OWNER.toLowerCase() as Address, TESTNET, OWNER.toLowerCase() as Address, state, 'testnet')).toEqual({ ok: true })
  })

  it('refuses a wrong chain', () => {
    expect(canAct(OWNER, 1, OWNER, state, 'testnet')).toEqual({ ok: false, reason: 'Switch your wallet to Arc.' })
    expect(canAct(OWNER, undefined, OWNER, state, 'testnet')).toEqual({ ok: false, reason: 'Switch your wallet to Arc.' })
  })

  // A wallet on the other Arc chain would send to an address that is not this network's factory.
  it("refuses the other Arc network's chain", () => {
    expect(canAct(OWNER, MAINNET, OWNER, state, 'testnet').ok).toBe(false)
    expect(canAct(OWNER, TESTNET, OWNER, state, 'mainnet').ok).toBe(false)
    expect(canAct(OWNER, MAINNET, OWNER, state, 'mainnet')).toEqual({ ok: true })
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

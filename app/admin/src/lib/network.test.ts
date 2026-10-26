import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import type { AdminSession } from './api'
import { ADMIN_NETWORKS } from './networks'
import { pickNetwork } from './network'

const OWNER = '0x3552E9c14C7b6050839009A5B160A4446a1e916D' as Address

function session(mainnet: boolean | null, testnet: boolean | null): AdminSession {
  return {
    address: OWNER,
    networks: {
      mainnet: { chainId: ADMIN_NETWORKS.mainnet.chainId, factory: ADMIN_NETWORKS.mainnet.factory, owner: mainnet },
      testnet: { chainId: ADMIN_NETWORKS.testnet.chainId, factory: ADMIN_NETWORKS.testnet.factory, owner: testnet },
    },
  }
}

// The panel must never show a network whose factory the signed-in address does not own: every read and every
// owner control would act for someone who is not the owner there.
describe('pickNetwork', () => {
  it('uses ?network=testnet when the owner owns testnet', () => {
    expect(pickNetwork('?network=testnet', null, session(true, true))).toBe('testnet')
    expect(pickNetwork('?network=testnet', 'mainnet', session(true, true))).toBe('testnet')
  })

  it('refuses ?network=testnet when the owner does not own testnet', () => {
    expect(pickNetwork('?network=testnet', null, session(true, false))).toBe('mainnet')
    expect(pickNetwork('?network=testnet', null, session(true, null))).toBe('mainnet')
  })

  it('uses the stored network when there is no ?network= and it is owned', () => {
    expect(pickNetwork('', 'testnet', session(true, true))).toBe('testnet')
  })

  it('falls back to mainnet when the stored network is not owned', () => {
    expect(pickNetwork('', 'testnet', session(true, false))).toBe('mainnet')
  })

  it('falls back to testnet when only testnet is owned', () => {
    expect(pickNetwork('', 'mainnet', session(null, true))).toBe('testnet')
    expect(pickNetwork('?network=mainnet', null, session(false, true))).toBe('testnet')
  })

  it('returns null when neither network is owned', () => {
    expect(pickNetwork('?network=testnet', 'testnet', session(false, null))).toBeNull()
  })

  it('ignores an unknown ?network= value', () => {
    expect(pickNetwork('?network=goerli', 'testnet', session(true, true))).toBe('testnet')
    expect(pickNetwork('?network=goerli', 'nonsense', session(true, true))).toBe('mainnet')
  })
})

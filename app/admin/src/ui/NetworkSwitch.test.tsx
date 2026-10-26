// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import type { AdminSession } from '../lib/api'
import { SessionContext } from '../lib/network'
import { ADMIN_NETWORKS } from '../lib/networks'
import { NetworkSwitch } from './NetworkSwitch'

afterEach(cleanup)

function show(mainnetOwner: boolean | null) {
  const session: AdminSession = {
    address: '0x3552E9c14C7b6050839009A5B160A4446a1e916D',
    networks: {
      mainnet: { chainId: ADMIN_NETWORKS.mainnet.chainId, factory: ADMIN_NETWORKS.mainnet.factory, owner: mainnetOwner },
      testnet: { chainId: ADMIN_NETWORKS.testnet.chainId, factory: ADMIN_NETWORKS.testnet.factory, owner: true },
    },
  }
  render(
    <SessionContext.Provider value={session}>
      <MemoryRouter initialEntries={['/?network=testnet']}>
        <NetworkSwitch />
      </MemoryRouter>
    </SessionContext.Provider>,
  )
}

// A failed owner() read is not a "no": telling the owner they do not own mainnet when the RPC was down would send
// them looking for the wrong problem.
describe('NetworkSwitch', () => {
  it('says the owner check failed when that network could not be read', async () => {
    show(null)
    await userEvent.click(screen.getByRole('button', { name: /Network/ }))
    const item = screen.getByRole('menuitem', { name: /Arc Mainnet/ })
    expect(item.getAttribute('aria-disabled')).toBe('true')
    expect(item.textContent).toContain("Couldn't check the owner on this network")
    expect(item.textContent).not.toContain('Not the owner on this network')
  })

  it('says not the owner when that network answered no', async () => {
    show(false)
    await userEvent.click(screen.getByRole('button', { name: /Network/ }))
    expect(screen.getByRole('menuitem', { name: /Arc Mainnet/ }).textContent).toContain('Not the owner on this network')
  })
})

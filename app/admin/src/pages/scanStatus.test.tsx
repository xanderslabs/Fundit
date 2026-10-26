// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import type { Address } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminSession } from '../lib/api'
import type { ScanStatus } from '../lib/historyScan'
import { ADMIN_NETWORKS } from '../lib/networks'
import type { FunditSnapshot } from '../lib/snapshot'
import { ActivityPage } from './ActivityPage'
import { FunditsPage } from './FunditsPage'
import { OverviewPage } from './OverviewPage'

// A scan stuck on a rate limit or an error must say so on every page that shows its figures (spec goal 3), never
// look like quiet partial data.

const session: AdminSession = {
  address: '0x3552E9c14C7b6050839009A5B160A4446a1e916D',
  networks: {
    mainnet: { chainId: ADMIN_NETWORKS.mainnet.chainId, factory: ADMIN_NETWORKS.mainnet.factory, owner: true },
    testnet: { chainId: ADMIN_NETWORKS.testnet.chainId, factory: ADMIN_NETWORKS.testnet.factory, owner: true },
  },
}
vi.mock('../ui/Shell', () => ({ usePanel: () => ({ session, network: 'mainnet', showTest: false }) }))

function row(address: Address, createdAtBlock: bigint, createdAt: bigint): FunditSnapshot {
  return {
    address,
    title: 'A Fundit',
    creator: '0x1111111111111111111111111111111111111111',
    token: 'USDC',
    goal: 1_000_000n,
    raised: 0n,
    available: 0n,
    withdrawn: 0n,
    closed: false,
    donationFeeBps: 250,
    createdAt,
    createdAtBlock,
    feesAccrued: 0n,
    unaccounted: 0n,
    isTest: false,
  }
}
const ROWS = [
  row('0x5555555555555555555555555555555555555555', 100n, 1_793_000_000n),
  row('0x6666666666666666666666666666666666666666', 200n, 1_793_001_000n),
]
vi.mock('../lib/queries', () => ({
  STALE_AFTER_MS: 120_000,
  useSnapshot: () => ({ data: ROWS, isError: false, dataUpdatedAt: Date.now(), refetch: vi.fn() }),
  useHealth: () => ({ data: undefined, isError: false, refetch: vi.fn() }),
  useHeadTime: () => ({ data: undefined }),
}))

const scan = vi.hoisted(() => ({ status: { kind: 'scanning' } as ScanStatus }))
vi.mock('../scan/ScanProvider', () => ({
  useScan: () => ({
    // First visit: nothing read yet past the deploy block.
    state: { v: 1, network: 'mainnet', factory: '0x0', scannedTo: 67_870_063n, covered: [], events: [] },
    status: scan.status,
    progress: { readTo: 67_870_063n, head: 70_000_000n },
    canSave: true,
    rescan: vi.fn(),
    nudge: vi.fn(),
  }),
}))

function show(page: ReactElement) {
  return render(<MemoryRouter>{page}</MemoryRouter>)
}

const WAITING = /The RPC asked us to slow down\. Resuming in \d+ s\./

afterEach(() => {
  cleanup()
  scan.status = { kind: 'scanning' }
})

describe('scan status on every page', () => {
  it('Overview says the RPC asked us to slow down while the scan waits', () => {
    scan.status = { kind: 'waiting', resumeAt: Date.now() + 30_000 }
    show(<OverviewPage />)
    expect(screen.getAllByText(WAITING).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Partial: read up to block 67870063').length).toBeGreaterThan(0)
  })

  it('Overview shows the scan error text', () => {
    scan.status = { kind: 'error', message: 'requested data not available', resumeAt: Date.now() + 10_000 }
    show(<OverviewPage />)
    expect(screen.getAllByText(/Couldn't read the history \(requested data not available\)\./).length).toBeGreaterThan(0)
  })

  it('Activity says the RPC asked us to slow down while the scan waits', () => {
    scan.status = { kind: 'waiting', resumeAt: Date.now() + 30_000 }
    show(<ActivityPage />)
    expect(screen.getByText(WAITING)).toBeTruthy()
    expect(screen.getByText('Partial: read up to block 67870063')).toBeTruthy()
  })

  it('Activity does not claim no settings have changed before the scan has caught up', () => {
    scan.status = { kind: 'waiting', resumeAt: Date.now() + 30_000 }
    show(<ActivityPage />)
    expect(screen.queryByText('No settings have changed yet.')).toBeNull()
    expect(screen.getByText('No settings changes found yet. The history is still being read.')).toBeTruthy()
  })

  it('Activity says no settings have changed once the scan has caught up', () => {
    scan.status = { kind: 'caughtUp' }
    show(<ActivityPage />)
    expect(screen.getByText('No settings have changed yet.')).toBeTruthy()
    expect(screen.queryByText(/Partial/)).toBeNull()
  })

  it('Fundits labels its gift counts as partial and shows a waiting scan', () => {
    scan.status = { kind: 'waiting', resumeAt: Date.now() + 30_000 }
    show(<FunditsPage />)
    expect(screen.getByText(WAITING)).toBeTruthy()
    expect(screen.getByText('Partial: read up to block 67870063')).toBeTruthy()
    // Neither Fundit is covered yet, so neither has a count.
    expect(screen.getAllByText('Scanning...')).toHaveLength(2)
  })
})

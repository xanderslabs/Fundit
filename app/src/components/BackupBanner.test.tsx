import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type Address, decodeFunctionData, getAddress, type Hex, type TransactionReceipt } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { campaignAbi } from '../abi/campaign'
import { TOKENS } from '../config'
import type { CampaignView } from '../lib/campaigns'
import type { Call, Sender, TxResult } from '../lib/sender'
import { BackupBanner } from './BackupBanner'

const CAMPAIGN = getAddress('0x00000000000000000000000000000000000000a1')
const CREATOR = getAddress('0x1111111111111111111111111111111111111111') as Address
const BACKUP = getAddress('0x4444444444444444444444444444444444444444') as Address
const HASH = `0x${'ab'.repeat(32)}` as Hex

const state: { sender: Sender | null } = { sender: null }
vi.mock('../hooks/useSender', () => ({ useSender: () => state.sender }))

const success: TxResult = { status: 'success', hash: HASH, receipt: { status: 'success' } as TransactionReceipt }

function fakeSender(address: Address) {
  const send = vi.fn(async (_calls: Call[]) => success)
  state.sender = { kind: 'eoa', address, send }
  return send
}

const now = () => BigInt(Math.floor(Date.now() / 1000))

function view(recoveryReadyAt: bigint): CampaignView {
  return {
    address: CAMPAIGN,
    symbol: 'USDC',
    summary: {
      creator: CREATOR,
      token: TOKENS.USDC.address,
      goal: 1000_000000n,
      raised: 0n,
      available: 0n,
      withdrawn: 0n,
      closed: false,
      donationFeeBps: 250,
      withdrawFeeBps: 100,
      createdAt: 1760000000n,
      createdAtBlock: 1n,
      backup: BACKUP,
      recoveryReadyAt,
      meta: { title: 'Clean water', description: '', imageUrl: '', links: [] },
    },
  }
}

function renderBanner(v: CampaignView) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BackupBanner view={v} />
    </QueryClientProvider>,
  )
}

const fn = (send: ReturnType<typeof fakeSender>) => decodeFunctionData({ abi: campaignAbi, data: send.mock.calls[0]![0][0]!.data }).functionName

afterEach(() => {
  cleanup()
  state.sender = null
})

describe('BackupBanner', () => {
  it('shows nothing to anyone but the backup', () => {
    fakeSender(CREATOR)
    renderBanner(view(0n))
    expect(screen.queryByRole('button', { name: /recovery/ })).toBeNull()
  })

  it('offers Start recovery to the backup when none is pending', async () => {
    const send = fakeSender(BACKUP)
    renderBanner(view(0n))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start recovery' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(fn(send)).toBe('initiateRecovery')
  })

  // completeRecovery reverts RecoveryNotReady before the 7 days are up, so the backup sees a countdown instead.
  it('shows a countdown and no Complete button before the wait is over', () => {
    fakeSender(BACKUP)
    renderBanner(view(now() + 2n * 86400n + 3n * 3600n + 120n))
    expect(screen.getByText(/2 days 3 hours/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Complete recovery' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start recovery' })).toBeNull()
  })

  it('offers Complete recovery once the wait is over', async () => {
    const send = fakeSender(BACKUP)
    renderBanner(view(now() - 10n))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Complete recovery' }))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(fn(send)).toBe('completeRecovery')
  })
})

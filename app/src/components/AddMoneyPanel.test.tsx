import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Address } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddMoneyPanel } from './AddMoneyPanel'

const ACCOUNT = '0x00000000000000000000000000000000000000cc' as Address

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AddMoneyPanel', () => {
  // The only way in is to send to the address on Arc. No wallet connects here.
  it('shows Your address with no tab strip and no connect button', () => {
    render(<AddMoneyPanel account={ACCOUNT} />)
    expect(screen.queryAllByRole('tab')).toEqual([])
    expect(screen.getByText(ACCOUNT)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /connect/i })).toBeNull()
  })

  it('shows the account address, a QR code and a working copy button', async () => {
    // userEvent.setup() puts in its own clipboard, so the spy goes in after it.
    const user = userEvent.setup()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<AddMoneyPanel account={ACCOUNT} />)
    expect(screen.getByText('Send USDC or EURC on Arc to this address from any wallet or exchange.')).toBeTruthy()
    expect(await screen.findByRole('img', { name: 'QR code of your Fundit account address' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Copy address' }))
    expect(writeText).toHaveBeenCalledWith(ACCOUNT)
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
    expect(screen.getByText('Card and bank coming soon.')).toBeTruthy()
  })
})

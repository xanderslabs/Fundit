import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Address } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddMoneyPanel } from './AddMoneyPanel'

// After a deploy, a tab open on the old build asks for a wallet chunk the site no longer serves. Only that tab
// fails: Add money and its other ways to add money keep working.
vi.mock('./WalletTabs', () => {
  throw new TypeError('Failed to fetch dynamically imported module: https://fundit.fun/assets/WalletTabs-old.js')
})

afterEach(cleanup)

const ACCOUNT = '0x00000000000000000000000000000000000000cc' as Address

describe('AddMoneyPanel when the wallet code fails to load', () => {
  it('asks for a reload in the wallet tab and keeps Your address working', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AddMoneyPanel account={ACCOUNT} />
      </QueryClientProvider>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: 'From a wallet' }))
    const wallet = screen.getByRole('tabpanel', { name: 'From a wallet' })
    expect((await screen.findByRole('alert', {}, { timeout: 5000 })).textContent).toContain('Fundit was updated. Reload the page to continue.')
    expect(wallet.contains(screen.getByRole('button', { name: 'Reload' }))).toBe(true)
    await user.click(screen.getByRole('tab', { name: 'Your address' }))
    expect(screen.getByText(ACCOUNT)).toBeTruthy()
    vi.mocked(console.error).mockRestore()
  })
})

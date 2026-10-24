import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Address } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddMoneyPanel } from './AddMoneyPanel'

// After a deploy, a tab open on the old build asks for the bridge chunk the site no longer serves. Only that tab
// fails: Your address keeps working.
vi.mock('../config', async (importOriginal) => ({ ...(await importOriginal<typeof import('../config')>()), CROSSCHAIN_ENABLED: true }))
vi.mock('./WalletTabs', () => {
  throw new TypeError('Failed to fetch dynamically imported module: https://fundit.fun/assets/WalletTabs-old.js')
})

afterEach(cleanup)

const ACCOUNT = '0x00000000000000000000000000000000000000cc' as Address

describe('AddMoneyPanel when the bridge code fails to load', () => {
  it('asks for a reload in the bridge tab and keeps Your address working', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AddMoneyPanel account={ACCOUNT} />
      </QueryClientProvider>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: 'From another chain' }))
    const chain = screen.getByRole('tabpanel', { name: 'From another chain' })
    expect((await screen.findByRole('alert', {}, { timeout: 5000 })).textContent).toContain('Fundit was updated. Reload the page to continue.')
    expect(chain.contains(screen.getByRole('button', { name: 'Reload' }))).toBe(true)
    await user.click(screen.getByRole('tab', { name: 'Your address' }))
    expect(screen.getByText(ACCOUNT)).toBeTruthy()
    vi.mocked(console.error).mockRestore()
  })
})

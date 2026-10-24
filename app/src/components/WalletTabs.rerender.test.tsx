import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useSearchParams } from 'react-router'
import type { Address } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddMoneyPanel } from './AddMoneyPanel'

// Regression for a dead end in Add money: WagmiProvider with reconnectOnMount={false} wiped the wallet connection
// on every re-render of its parent. Opening Send or switching a My page tab re-renders the panel, so the wallet
// vanished, Disconnect went away and connecting again threw ConnectorAlreadyConnectedError. This uses real wagmi
// with its mock connector and saved state, as on the site, and re-renders the panel the way My page does.

const EXTERNAL = '0x1111111111111111111111111111111111111111' as Address
const ACCOUNT = '0x00000000000000000000000000000000000000cc' as Address

vi.mock('../wagmi', async () => {
  const { createConfig, createStorage, custom, mock } = await import('@wagmi/core')
  const { ARC_CHAIN } = await import('../config')
  const wagmiConfig = createConfig({
    chains: [ARC_CHAIN],
    connectors: [mock({ accounts: [EXTERNAL] })],
    // Storage on, as the site's config has it: the wipe happened only with storage.
    storage: createStorage({ storage: localStorage }),
    transports: { [ARC_CHAIN.id]: custom({ request: async () => null }) },
    multiInjectedProviderDiscovery: false,
  })
  return { wagmiConfig }
})
vi.mock('../config', async (importOriginal) => ({ ...(await importOriginal<typeof import('../config')>()), REOWN_PROJECT_ID: 'test-project' }))
vi.mock('../lib/deposit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/deposit')>()),
  fetchAccountBalances: async () => ({ usdc: 10_000000n, eurc: 0n }),
}))
// The sender itself (switch to Arc, then send) is covered in lib/sender.test.ts. Here only whether a deposit can go out.
const sent = vi.hoisted(() => ({ from: [] as Address[], send: vi.fn() }))
vi.mock('../lib/wagmiSender', () => ({
  wagmiSender: (_config: unknown, address: Address) => {
    sent.from.push(address)
    return { kind: 'wallet', address, send: sent.send }
  },
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
})

// My page in small: Send and the dashboard tabs change the URL, which re-renders the Add money panel.
function MyPage() {
  const [params, setParams] = useSearchParams()
  return (
    <>
      <button type="button" onClick={() => setParams({ send: '1' })}>
        Open Send
      </button>
      <p>{params.toString()}</p>
      <AddMoneyPanel account={ACCOUNT} />
    </>
  )
}

describe('the wallet tab across re-renders', () => {
  it('keeps a connected wallet when the page re-renders, can still send a deposit, and Disconnect works', async () => {
    const { wagmiConfig } = await import('../wagmi')
    const { connect, getConnection } = await import('@wagmi/core')
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/me?add=1']}>
          <MyPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: 'From a wallet' }))
    expect(await screen.findByRole('button', { name: 'Connect a wallet' }, { timeout: 5000 })).toBeTruthy()

    await act(async () => {
      await connect(wagmiConfig, { connector: wagmiConfig.connectors[0]! })
    })
    const panel = () => screen.getByRole('tabpanel', { name: 'From a wallet' })
    await waitFor(() => expect(panel().textContent).toContain('0x1111...1111'))

    // Re-render through the URL, then through the tabs.
    await user.click(screen.getByRole('button', { name: 'Open Send' }))
    expect(screen.getByText('send=1')).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: 'Your address' }))
    await user.click(screen.getByRole('tab', { name: 'From a wallet' }))

    expect(getConnection(wagmiConfig).address).toBe(EXTERNAL)
    expect(panel().textContent).toContain('0x1111...1111')
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy()

    // The deposit still goes out from the connected wallet.
    sent.send.mockResolvedValue({ status: 'rejected', completed: 0 })
    await screen.findByText(/^Your wallet holds 10\.00 USDC on Arc\./)
    await user.type(screen.getByLabelText('Amount'), '5')
    await user.click(screen.getByRole('button', { name: 'Add to my Fundit account' }))
    await waitFor(() => expect(sent.send).toHaveBeenCalledTimes(1))
    expect(sent.from.at(-1)).toBe(EXTERNAL)

    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(getConnection(wagmiConfig).status).toBe('disconnected'))
    expect(await screen.findByRole('button', { name: 'Connect a wallet' })).toBeTruthy()
  })
})

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Address } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ARC_CHAIN_ID } from '../config'
import { ConnectWallet } from './ConnectWallet'

const PHONE_WALLET = '0x1111111111111111111111111111111111111111' as Address

// A WalletConnect connector in small: its emitter is how wagmi hands over the pairing link (display_uri).
const wc = vi.hoisted(() => {
  const listeners = new Set<(m: { type: string; data?: unknown }) => void>()
  const connector = {
    id: 'walletConnect',
    uid: 'wc-1',
    name: 'WalletConnect',
    type: 'walletConnect',
    emitter: {
      on: (_e: string, fn: (m: { type: string; data?: unknown }) => void) => listeners.add(fn),
      off: (_e: string, fn: (m: { type: string; data?: unknown }) => void) => listeners.delete(fn),
      emit: (m: { type: string; data?: unknown }) => listeners.forEach((fn) => fn(m)),
    },
  }
  return { connector, listeners, finish: null as ((r: { accounts: string[] }) => void) | null }
})
const core = vi.hoisted(() => ({
  connect: vi.fn(),
  switchChain: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
}))
vi.mock('../wagmi', () => ({ wagmiConfig: {} }))
vi.mock('../config', async (importOriginal) => ({ ...(await importOriginal<typeof import('../config')>()), REOWN_PROJECT_ID: 'test-project' }))
vi.mock('@wagmi/core', () => ({
  getConnectors: () => [wc.connector],
  watchConnectors: () => () => {},
  getAccount: () => ({}),
  connect: core.connect,
  switchChain: core.switchChain,
  disconnect: core.disconnect,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ConnectWallet phone wallet', () => {
  // The phone scans this QR code to pair. WalletConnect's own modal is off, so this is the only QR shown.
  it('shows a QR code when the connector emits a display_uri, then connects on Arc', async () => {
    core.connect.mockImplementation(
      () =>
        new Promise((resolve) => {
          wc.connector.emitter.emit({ type: 'display_uri', data: 'wc:abc@2?relay-protocol=irn&symKey=00' })
          wc.finish = resolve
        }),
    )
    const onConnected = vi.fn()
    render(<ConnectWallet onConnected={onConnected} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Phone wallet (QR code)' }))
    expect(await screen.findByRole('img', { name: 'QR code to connect a phone wallet' })).toBeTruthy()
    expect(screen.getByText('Scan this with your phone wallet, then approve the connection there.')).toBeTruthy()

    wc.finish!({ accounts: [PHONE_WALLET] })
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith(PHONE_WALLET, 'walletConnect'))
    expect(core.switchChain).toHaveBeenCalledWith({}, { chainId: ARC_CHAIN_ID })
    expect(screen.queryByRole('img', { name: 'QR code to connect a phone wallet' })).toBeNull()
    // The listener goes once the connection settles.
    expect(wc.listeners.size).toBe(0)
  })
})

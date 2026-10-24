import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { Address } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { storageKey } from '../config'
import { SignInOptions } from './SignInOptions'

const WALLET = '0x1111111111111111111111111111111111111111' as Address

const flags = vi.hoisted(() => ({ email: false }))
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  get EMAIL_SIGNIN() {
    return flags.email
  },
}))

// The factory runs only when something imports ConnectWallet, so the count shows whether the wallet code loaded.
const connect = vi.hoisted(() => ({ loads: 0, onConnected: null as ((address: Address, connectorId: string) => void) | null }))
vi.mock('./ConnectWallet', () => {
  connect.loads++
  return {
    ConnectWallet: ({ onConnected }: { onConnected: (address: Address, connectorId: string) => void }) => {
      connect.onConnected = onConnected
      return <p>Wallet list</p>
    },
  }
})

afterEach(() => {
  cleanup()
  flags.email = false
  localStorage.clear()
})

function renderOptions(onSignedIn = vi.fn()) {
  render(
    <MemoryRouter>
      <SignInOptions onSignedIn={onSignedIn} />
    </MemoryRouter>,
  )
  return { user: userEvent.setup(), onSignedIn }
}

describe('SignInOptions', () => {
  // Email sign-in is off by default, so a wallet is the only way in until it is turned on.
  it('with email off, only Connect a wallet shows', () => {
    renderOptions()
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Connect a wallet'])
  })

  // Passkey accounts are gone: no sign-in, sign-up or recovery option for them may come back.
  it('no passkey option exists', () => {
    flags.email = true
    renderOptions()
    expect(screen.queryByText(/passkey/i)).toBeNull()
    expect(screen.queryByRole('link', { name: /recover/i })).toBeNull()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Continue with email', 'Connect a wallet'])
  })

  // Email sign-in stays off until its own checks pass on each network.
  it('hides Continue with email unless VITE_EMAIL_SIGNIN is 1', () => {
    renderOptions()
    expect(screen.queryByRole('button', { name: 'Continue with email' })).toBeNull()
    cleanup()
    flags.email = true
    renderOptions()
    expect(screen.getByRole('button', { name: 'Continue with email' })).toBeTruthy()
  })

  // App start must load no wallet code. The wallet list (and wagmi behind it) loads only on this click.
  it('Connect a wallet loads no wallet code until clicked', async () => {
    const { user } = renderOptions()
    expect(connect.loads).toBe(0)
    await user.click(screen.getByRole('button', { name: 'Connect a wallet' }))
    expect(await screen.findByText('Wallet list')).toBeTruthy()
    expect(connect.loads).toBe(1)
  })

  // A wallet sign-in keeps only the wallet account: an older email session would come back after sign-out.
  it('a connected wallet becomes the account and the other sessions end', async () => {
    localStorage.setItem(storageKey('session.email'), JSON.stringify({ address: '0x2222222222222222222222222222222222222222', walletId: 'w-1', email: 'ana@example.com' }))
    const { user, onSignedIn } = renderOptions()
    await user.click(screen.getByRole('button', { name: 'Connect a wallet' }))
    await screen.findByText('Wallet list')
    act(() => connect.onConnected!(WALLET, 'io.metamask'))
    expect(JSON.parse(localStorage.getItem(storageKey('session.wallet'))!)).toEqual({ address: WALLET, connectorId: 'io.metamask' })
    expect(localStorage.getItem(storageKey('session.email'))).toBeNull()
    expect(onSignedIn).toHaveBeenCalledWith('wallet')
  })
})

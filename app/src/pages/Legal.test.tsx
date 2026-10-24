import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Privacy } from './Privacy'
import { Terms } from './Terms'

const flags = vi.hoisted(() => ({ crosschain: false }))
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  get CROSSCHAIN_ENABLED() {
    return flags.crosschain
  },
}))

afterEach(() => {
  cleanup()
  flags.crosschain = false
})

function text(page: 'terms' | 'privacy') {
  const { container } = render(<MemoryRouter>{page === 'terms' ? <Terms /> : <Privacy />}</MemoryRouter>)
  return container.textContent ?? ''
}

describe.each(['terms', 'privacy'] as const)('%s page', (page) => {
  // The rest of the site calls a fundraiser "a Fundit". The legal text keeps "fundraiser", so it says once,
  // before the body, that the two are the same thing.
  it('defines a Fundit right after the heading', () => {
    text(page)
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.nextElementSibling?.textContent).toBe('A Fundit is a fundraiser created on Fundit.')
  })

  // Passkey sign-in is still one of the ways in, so the policy always describes it.
  it('always mentions passkeys', () => {
    expect(text(page)).toMatch(/passkey/i)
  })

  // Sign-in has three methods. A policy that names only some of them would misdescribe the others.
  it('names the three ways to sign in', () => {
    const t = text(page)
    expect(t).toMatch(/passkey/i)
    expect(t).toMatch(/email/i)
    expect(t).toMatch(/sign in[^.]*(with|using) (a|your own|your) wallet|Wallet: your own wallet/i)
    expect(t).not.toMatch(/cannot sign in with a wallet/i)
  })

  // Reown AppKit is gone. Only the WalletConnect protocol stays, for phone wallets.
  it('never mentions Reown AppKit', () => {
    const t = text(page)
    expect(t).not.toMatch(/Reown/i)
    expect(t).not.toMatch(/AppKit/i)
  })

  // Sign-in is a Fundit account only. The old "passkey wallet" wording read as one wallet option among others.
  it('says Fundit account, never passkey wallet', () => {
    const t = text(page)
    expect(t).toMatch(/Fundit account/)
    expect(t).not.toMatch(/passkey wallet/i)
  })

  // Connecting a wallet to add money was dropped. Adding money is sending to the account address.
  it('does not say a wallet is connected to add money', () => {
    const t = text(page)
    expect(t).not.toMatch(/connect (a wallet|one) to add money/i)
    expect(t).not.toMatch(/from a wallet you connect/i)
  })

  // Gateway unified balances are no longer used anywhere, so the policy must not name them.
  it.each([false, true])('never mentions Gateway (cross-chain flag %s)', (on) => {
    flags.crosschain = on
    expect(text(page)).not.toMatch(/Gateway/)
  })

  // fundit.xyz is not our domain, so mail sent there would reach a stranger.
  // The owner removed the governing law section rather than publish a placeholder.
  it('gives hello@fundit.fun as the contact and shows no unset placeholder', () => {
    const t = text(page)
    expect(t).toMatch(/hello@fundit\.fun/)
    expect(t).not.toMatch(/fundit\.xyz/)
    expect(t).not.toMatch(/to be set before launch|Governing law/)
  })

  // The owner took the draft notice off for launch. The rest of the legal text is unchanged.
  it('shows no draft notice', () => {
    expect(text(page)).not.toMatch(/Draft: review before launch|has not had a legal review/)
  })
})

describe('email sign-in text', () => {
  // A person who loses their email address cannot get an email account back. The terms must say so before sign-up.
  it('says Fundit and Circle cannot recover an email account without the email', () => {
    expect(text('terms')).toMatch(/nobody can recover an email account[^.]*including Fundit and Circle/i)
  })

  // The email flow sends mail through Resend and checks the browser with Turnstile. Both see the person's data.
  it('names Resend and Turnstile in Privacy', () => {
    const t = text('privacy')
    expect(t).toMatch(/Resend/)
    expect(t).toMatch(/Turnstile/)
  })
})

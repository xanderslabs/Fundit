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

  // Every account is a Fundit account secured by a passkey, so the policy always describes it.
  it('always mentions passkeys', () => {
    expect(text(page)).toMatch(/passkey/i)
  })

  // Sign-in is a Fundit account only. The old "passkey wallet" wording read as one wallet option among others.
  it('says Fundit account, never passkey wallet', () => {
    const t = text(page)
    expect(t).toMatch(/Fundit account/)
    expect(t).not.toMatch(/passkey wallet/i)
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

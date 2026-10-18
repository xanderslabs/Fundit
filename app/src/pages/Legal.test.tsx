import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Privacy } from './Privacy'
import { Terms } from './Terms'

const flags = vi.hoisted(() => ({ passkeys: false, crosschain: false }))
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  get PASSKEYS_ENABLED() {
    return flags.passkeys
  },
  get CROSSCHAIN_ENABLED() {
    return flags.crosschain
  },
}))

afterEach(() => {
  cleanup()
  flags.passkeys = false
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

  // The legal text has not been reviewed yet and must say so on the page.
  it('shows the draft notice', () => {
    text(page)
    expect(screen.getByText('Draft: review before launch.')).toBeTruthy()
  })

  // Passkey wallets ship behind a flag. The policy must not describe a service the site does not use.
  it('mentions passkey wallets only when they are switched on', () => {
    expect(text(page)).not.toMatch(/passkey/i)
    cleanup()
    flags.passkeys = true
    expect(text(page)).toMatch(/passkey/i)
  })

  // Gateway unified balances ship behind VITE_CROSSCHAIN, like passkeys behind theirs.
  it('mentions Gateway only when cross-chain donations are switched on', () => {
    expect(text(page)).not.toMatch(/Gateway/)
    cleanup()
    flags.crosschain = true
    expect(text(page)).toMatch(/Gateway/)
  })

  // fundit.xyz is not our domain, so mail sent there would reach a stranger.
  it('gives hello@fundit.fun as the contact, keeps the draft notice and the governing law placeholder', () => {
    const t = text(page)
    expect(t).toMatch(/hello@fundit\.fun/)
    expect(t).not.toMatch(/fundit\.xyz/)
    if (page === 'terms') expect(t).toMatch(/\[to be set before launch\]/)
  })
})

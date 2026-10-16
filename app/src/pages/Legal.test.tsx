import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Privacy } from './Privacy'
import { Terms } from './Terms'

const flags = vi.hoisted(() => ({ passkeys: false }))
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  get PASSKEYS_ENABLED() {
    return flags.passkeys
  },
}))

afterEach(() => {
  cleanup()
  flags.passkeys = false
})

function text(page: 'terms' | 'privacy') {
  const { container } = render(<MemoryRouter>{page === 'terms' ? <Terms /> : <Privacy />}</MemoryRouter>)
  return container.textContent ?? ''
}

describe.each(['terms', 'privacy'] as const)('%s page', (page) => {
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
})

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

// Without a boundary React unmounts the whole page on a crash and leaves it blank. The likeliest crash is a lazy
// chunk that is gone after a deploy (a tab open on the old build), and a reload fixes it.

function Throws({ error }: { error: unknown }): never {
  throw error
}

const reload = vi.fn()
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('location', { ...window.location, reload })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  reload.mockReset()
})

describe('ErrorBoundary', () => {
  it.each([
    ['Chrome', new TypeError('Failed to fetch dynamically imported module: https://fundit.fun/assets/WalletTabs-abc.js')],
    ['Firefox', new TypeError('error loading dynamically imported module: https://fundit.fun/assets/WalletTabs-abc.js')],
    ['Safari', new TypeError('Importing a module script failed.')],
    ['a CSS chunk', new Error('Unable to preload CSS for /assets/WalletTabs-abc.css')],
  ])('asks for a reload when a %s chunk is gone after an update', async (_label, error) => {
    render(
      <ErrorBoundary>
        <Throws error={error} />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert').textContent).toContain('Fundit was updated. Reload the page to continue.')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalledWith(error)
  })

  it('shows the plain message for any other crash, never the raw error', () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'address')")
    render(
      <ErrorBoundary>
        <Throws error={error} />
      </ErrorBoundary>,
    )
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain("That didn't work. Reload the page and try again.")
    expect(alert.textContent).not.toMatch(/undefined|address/)
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect(console.error).toHaveBeenCalledWith(error)
  })

  it('links to the report form with the page that crashed', () => {
    vi.stubGlobal('location', { ...window.location, pathname: '/c/0xabc', reload })
    render(
      <ErrorBoundary>
        <Throws error={new Error('x')} />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('link', { name: 'Report a problem' }).getAttribute('href')).toBe('/report?from=%2Fc%2F0xabc')
  })

  it('renders its children when nothing fails', () => {
    render(
      <ErrorBoundary>
        <p>Fine</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('Fine')).toBeTruthy()
  })
})

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ siteKey: 'site-key' }))
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  get TURNSTILE_SITE_KEY() {
    return state.siteKey
  },
}))
// A fake widget that solves at once.
vi.mock('../lib/turnstile', () => ({
  loadTurnstile: async () => ({
    render: (_el: HTMLElement, o: { callback: (t: string) => void }) => {
      o.callback('widget-token')
      return 'w1'
    },
    reset: () => {},
    remove: () => {},
  }),
}))

import { Layout } from '../components/Layout'
import { Report } from './Report'

vi.mock('../lib/walletSession', () => ({ disconnectWallet: () => {} }))

const fetchMock = vi.fn()
beforeEach(() => {
  state.siteKey = 'site-key'
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderAt(path = '/c/0xabc') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Report />
    </MemoryRouter>,
  )
}
const reply = (status: number, body: unknown) => fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }))

describe('Report page', () => {
  it('shows the help text', () => {
    renderAt()
    expect(screen.getByText("Don't include a sign-in code, private key or recovery phrase. Fundit will never ask for them.")).toBeTruthy()
  })

  const pageField = () => (screen.getByLabelText(/^Page/) as HTMLInputElement).value

  it('fills Page with the page the person came from', async () => {
    render(
      <MemoryRouter initialEntries={['/c/0xabc']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="c/:address" element={<p>Fundit</p>} />
            <Route path="report" element={<Report />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole('link', { name: 'Report a problem' }))
    expect(pageField()).toBe('/c/0xabc')
  })

  it('fills Page from the from query after the error screen', () => {
    renderAt('/report?from=%2Fc%2F0xabc')
    expect(pageField()).toBe('/c/0xabc')
  })

  it('leaves Page empty when opened directly or when from is not a path', () => {
    renderAt('/report')
    expect(pageField()).toBe('')
    cleanup()
    renderAt('/report?from=https%3A%2F%2Fevil.example')
    expect(pageField()).toBe('')
    cleanup()
    renderAt(`/report?from=%2F${'a'.repeat(200)}`)
    expect(pageField()).toBe('')
  })

  it('requires What happened', async () => {
    renderAt()
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }))
    expect(screen.getByText('Tell us what happened.')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  async function fillAndSend() {
    renderAt('/report?from=%2Fc%2F0xabc')
    await userEvent.type(screen.getByLabelText('What happened'), 'It broke')
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }))
  }

  it('shows the success text after a 200', async () => {
    reply(200, { ok: true })
    await fillAndSend()
    await waitFor(() => expect(screen.getByText("Thanks. We read every report. If you left an email, we'll reply there.")).toBeTruthy())
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(JSON.parse(String(init.body))).toMatchObject({ what: 'It broke', page: '/c/0xabc', turnstile: 'widget-token' })
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/report')
  })

  it('shows the Turnstile text after a 403 turnstile', async () => {
    reply(403, { error: 'turnstile' })
    await fillAndSend()
    await waitFor(() => expect(screen.getByText("We couldn't confirm you're not a bot. Try again.")).toBeTruthy())
  })

  it('shows the email fallback after a 500', async () => {
    reply(500, { error: 'x' })
    await fillAndSend()
    await waitFor(() => expect(screen.getByText("We couldn't send your report. Email hello@fundit.fun instead.")).toBeTruthy())
  })

  it('shows only the email fallback without a Turnstile site key', () => {
    state.siteKey = ''
    renderAt()
    expect(screen.getByText("We couldn't send your report. Email hello@fundit.fun instead.")).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send report' })).toBeNull()
  })
})

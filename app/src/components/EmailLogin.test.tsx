import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmailError } from '../lib/emailAccount'

const { sendEmailCode, openEmailAccount, loadCircleSdk } = vi.hoisted(() => ({
  sendEmailCode: vi.fn(),
  openEmailAccount: vi.fn(),
  loadCircleSdk: vi.fn(),
}))
vi.mock('../lib/circleEmail', async (orig) => ({ ...(await orig<typeof import('../lib/circleEmail')>()), sendEmailCode, openEmailAccount, loadCircleSdk }))

import { EmailLogin } from './EmailLogin'

type TurnstileOptions = { callback: (token: string) => void; 'error-callback': () => void; 'expired-callback': () => void }
const turnstile = { options: null as TurnstileOptions | null, render: vi.fn(), reset: vi.fn(), remove: vi.fn() }

const SESSION = { address: '0x1D5c39510E1144f99dbf69eb0089673438354e22', walletId: 'w-1', email: 'ana@example.com' }

beforeEach(() => {
  vi.clearAllMocks()
  // Turnstile solves at once, as it does for most people.
  turnstile.render.mockImplementation((_el: HTMLElement, options: TurnstileOptions) => {
    turnstile.options = options
    options.callback('turnstile-token')
    return 'widget-1'
  })
  ;(window as unknown as { turnstile: typeof turnstile }).turnstile = turnstile
  loadCircleSdk.mockResolvedValue({})
  openEmailAccount.mockResolvedValue(SESSION)
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { turnstile?: unknown }).turnstile
})

async function submit(onDone = vi.fn()) {
  render(<EmailLogin onDone={onDone} />)
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Email address'), 'ana@example.com')
  await waitFor(() => expect(turnstile.render).toHaveBeenCalled())
  await user.click(screen.getByRole('button', { name: 'Send code' }))
  return onDone
}

describe('EmailLogin', () => {
  it('sends the code with the Turnstile token, then opens the account', async () => {
    sendEmailCode.mockResolvedValue(undefined)
    const onDone = await submit()
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(SESSION))
    expect(sendEmailCode.mock.calls[0]!.slice(0, 2)).toEqual(['ana@example.com', 'turnstile-token'])
    expect(openEmailAccount).toHaveBeenCalledWith('ana@example.com')
  })

  // Circle's code screen stays open after a wrong code, so the person can type it again there.
  it('wrong code (155133) shows "That code is not right. Check it and try again."', async () => {
    sendEmailCode.mockImplementation((_e: string, _t: string, onWrongCode: (err: EmailError) => void) => {
      onWrongCode(new EmailError('Invalid OTP', null, 155133))
      return new Promise(() => {})
    })
    await submit()
    expect((await screen.findByRole('alert')).textContent).toBe('That code is not right. Check it and try again.')
  })

  it('expired code (155130) shows "That code has expired. Send a new one."', async () => {
    sendEmailCode.mockRejectedValue(new EmailError('OTP expired', null, 155130))
    await submit()
    expect((await screen.findByRole('alert')).textContent).toBe('That code has expired. Send a new one.')
    // A Turnstile token works once, so the next send gets a fresh check.
    expect(turnstile.reset).toHaveBeenCalled()
  })

  it('three wrong codes (155146) shows "Too many tries. Send a new code."', async () => {
    sendEmailCode.mockRejectedValue(new EmailError('Locked', null, 155146))
    const onDone = await submit()
    expect((await screen.findByRole('alert')).textContent).toBe('Too many tries. Send a new code.')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('a failed Turnstile check shows "We could not check this browser. Try again."', async () => {
    sendEmailCode.mockRejectedValue(new EmailError('Turnstile check failed', 403, null))
    await submit()
    expect((await screen.findByRole('alert')).textContent).toBe('We could not check this browser. Try again.')
    cleanup()
    // The widget itself can fail too, before anything is sent.
    turnstile.render.mockImplementation((_el: HTMLElement, options: TurnstileOptions) => {
      options['error-callback']()
      return 'widget-2'
    })
    render(<EmailLogin onDone={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toBe('We could not check this browser. Try again.')
  })

  it('Circle or the Worker unreachable shows "Email sign-in is not available right now. Use a passkey or a wallet."', async () => {
    const text = 'Email sign-in is not available right now. Use a passkey or a wallet.'
    sendEmailCode.mockRejectedValue(new EmailError('Circle unreachable', 502, null))
    await submit()
    expect((await screen.findByRole('alert')).textContent).toBe(text)
    cleanup()
    // No answer at all from the Worker.
    sendEmailCode.mockRejectedValue(new EmailError('Failed to fetch', 0, null))
    await submit()
    expect((await screen.findByRole('alert')).textContent).toBe(text)
    cleanup()
    // Circle's SDK never answered (its own network error code).
    sendEmailCode.mockRejectedValue(new EmailError('Network error', null, 155706))
    await submit()
    expect((await screen.findByRole('alert')).textContent).toBe(text)
  })
})

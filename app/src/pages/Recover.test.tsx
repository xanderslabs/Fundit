import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import type { Address } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlainError } from '../lib/errors'
import { RecoveryNeedsFunds, type StoredPasskey } from '../lib/passkey'
import { Recover } from './Recover'

const ACCOUNT = '0x00000000000000000000000000000000000000Ab' as Address
const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow'
const SESSION = { address: ACCOUNT, credentialId: 'cred-new' }

const recoverWithPhrase = vi.fn()
const checkPendingRecovery = vi.fn()
const discardPendingRecovery = vi.fn()
vi.mock('../lib/passkey', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/passkey')>()),
  recoverWithPhrase: (...a: unknown[]) => recoverWithPhrase(...a),
  checkPendingRecovery: (...a: unknown[]) => checkPendingRecovery(...a),
  discardPendingRecovery: (...a: unknown[]) => discardPendingRecovery(...a),
}))
// The backup prompt has its own tests. Here it only has to appear for the recovered account.
vi.mock('../components/AddBackupPasskey', () => ({
  AddBackupPasskey: ({ stored }: { stored: StoredPasskey }) => <p>Backup prompt for {stored.address}</p>,
}))

afterEach(() => {
  cleanup()
  recoverWithPhrase.mockReset()
  checkPendingRecovery.mockReset()
  discardPendingRecovery.mockReset()
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
})

function Where() {
  const l = useLocation()
  return <p data-testid="where">{`${l.pathname}${l.search}${l.hash}`}</p>
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/recover']}>
      <Recover />
      <Where />
    </MemoryRouter>,
  )
  return userEvent.setup()
}

async function fill(user: UserEvent, phrase = PHRASE, name = 'ana-phone') {
  await user.click(screen.getByLabelText('Word 1'))
  await user.paste(phrase)
  await user.type(screen.getByLabelText('Name for your new passkey'), name)
  await user.click(screen.getByRole('button', { name: 'Recover my account' }))
}

describe('Recover', () => {
  it('explains the recovery in plain words and asks for 12 words and a passkey name', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Recover your Fundit account' })).toBeTruthy()
    expect(
      screen.getByText("Enter the 12 words of your recovery key. We'll make a new passkey on this device and move your account to it."),
    ).toBeTruthy()
    for (let i = 1; i <= 12; i++) expect(screen.getByLabelText(`Word ${i}`)).toBeTruthy()
    expect(screen.getByLabelText('Name for your new passkey')).toBeTruthy()
  })

  // People copy the whole key from where they saved it. One paste fills every field in order.
  it('fills all 12 fields from one pasted phrase', async () => {
    const user = renderPage()
    await user.click(screen.getByLabelText('Word 1'))
    await user.paste(`  ${PHRASE.replace(/ /g, '\n')} `)
    PHRASE.split(' ').forEach((w, i) => expect((screen.getByLabelText(`Word ${i + 1}`) as HTMLInputElement).value).toBe(w))
  })

  // People paste where the cursor happens to be. A whole key goes in from the first box, whichever box it lands in.
  it('fills all 12 fields in order when the full phrase is pasted into a later box', async () => {
    const user = renderPage()
    await user.click(screen.getByLabelText('Word 5'))
    await user.paste(PHRASE)
    PHRASE.split(' ').forEach((w, i) => expect((screen.getByLabelText(`Word ${i + 1}`) as HTMLInputElement).value).toBe(w))
  })

  // A part of the key pasted mid-way still fills from that box on, so a person can fix the second half.
  it('fills from the box onward when only part of the phrase is pasted', async () => {
    const user = renderPage()
    await user.click(screen.getByLabelText('Word 11'))
    await user.paste('thank yellow')
    expect((screen.getByLabelText('Word 11') as HTMLInputElement).value).toBe('thank')
    expect((screen.getByLabelText('Word 12') as HTMLInputElement).value).toBe('yellow')
    expect((screen.getByLabelText('Word 1') as HTMLInputElement).value).toBe('')
  })

  // The words control the account: the browser must not save, correct or capitalise them.
  it('numbers each word box and turns off autocomplete, spellcheck and autocapitalise', () => {
    renderPage()
    const grid = screen.getByRole('group', { name: 'Your recovery key' })
    const inputs = within(grid).getAllByRole('textbox')
    expect(inputs).toHaveLength(12)
    inputs.forEach((input, i) => {
      expect(input.getAttribute('autocomplete')).toBe('off')
      expect(input.getAttribute('spellcheck')).toBe('false')
      expect(input.getAttribute('autocapitalize')).toBe('none')
      // The visible label is the word's number.
      expect(grid.querySelector(`label[for="${input.id}"]`)!.textContent).toBe(`Word ${i + 1}`)
      expect(grid.querySelector(`label[for="${input.id}"] [aria-hidden="true"]`)?.textContent).toBe(`${i + 1}`)
    })
  })

  // Someone who still has their passkey can go back to signing in from here.
  it('has a Back to sign in control that opens the passkey sign-in dialog', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }))
    expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeTruthy()
  })

  it('refuses an incomplete key without starting a recovery', async () => {
    const user = renderPage()
    await fill(user, PHRASE.split(' ').slice(0, 11).join(' '))
    expect(screen.getByRole('alert').textContent).toBe("Those words don't form a valid recovery key. Check the order and spelling.")
    expect(recoverWithPhrase).not.toHaveBeenCalled()
  })

  // The new passkey's name goes to Circle, which takes only 5 to 50 of A-Z, a-z, 0-9 and _@.:+-.
  it("refuses a name Circle would reject, before starting a recovery", async () => {
    const user = renderPage()
    await fill(user, PHRASE, 'my phone')
    expect(screen.getByText('Use 5 to 50 letters, numbers or _ @ . : + - (no spaces).')).toBeTruthy()
    expect(recoverWithPhrase).not.toHaveBeenCalled()
  })

  it('shows the plain message when the words fail the checksum', async () => {
    recoverWithPhrase.mockRejectedValue(new PlainError("Those words don't form a valid recovery key. Check the order and spelling."))
    const user = renderPage()
    await fill(user)
    expect((await screen.findByRole('alert')).textContent).toBe("Those words don't form a valid recovery key. Check the order and spelling.")
  })

  // After a recovery the old key may be in someone else's hands, so the person is asked for a new one.
  it('recovers with the words and the name, then asks for a new recovery key', async () => {
    recoverWithPhrase.mockResolvedValue({ status: 'recovered', session: SESSION })
    const user = renderPage()
    await fill(user)
    expect(recoverWithPhrase).toHaveBeenCalledWith({ phrase: PHRASE, username: 'ana-phone' })
    expect(await screen.findByText('Your account is back.')).toBeTruthy()
    expect(screen.getByText(`Backup prompt for ${ACCOUNT}`)).toBeTruthy()
    expect(screen.queryByLabelText('Word 1')).toBeNull()
  })

  // The words control the account. They must not end up in storage or in the address bar.
  it('never puts the words in storage or the URL', async () => {
    recoverWithPhrase.mockResolvedValue({ status: 'pending', account: ACCOUNT })
    const user = renderPage()
    await fill(user)
    await screen.findByText(/still confirming/)
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) expect(`${store.key(i)} ${store.getItem(store.key(i)!)}`).not.toMatch(/sausage|yellow/)
    }
    expect(screen.getByTestId('where').textContent).toBe('/recover')
    expect(window.location.href).not.toMatch(/sausage|yellow/)
  })

  // The account pays the fee in USDC. The person sees where to send it, with copy and a QR code.
  it('asks to fund the account first, with its address, a copy button and a QR code', async () => {
    recoverWithPhrase.mockRejectedValueOnce(new RecoveryNeedsFunds(ACCOUNT, 500_000n))
    const user = renderPage()
    await fill(user)
    expect(
      await screen.findByText('Recovery needs a small network fee. Send at least 0.50 USDC on Arc to your account address first.'),
    ).toBeTruthy()
    expect(screen.getByText(ACCOUNT)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy address' })).toBeTruthy()
    expect(await screen.findByRole('img', { name: 'QR code of your account address' })).toBeTruthy()
    // The words stay on screen, so the person can try again once the money arrives.
    recoverWithPhrase.mockResolvedValue({ status: 'recovered', session: SESSION })
    await user.click(screen.getByRole('button', { name: 'Recover my account' }))
    expect(recoverWithPhrase).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('Your account is back.')).toBeTruthy()
  })

  // A recovery that may still land is checked, never sent again.
  it('shows a pending recovery with Check again, which rechecks instead of recovering again', async () => {
    recoverWithPhrase.mockResolvedValue({ status: 'pending', account: ACCOUNT })
    checkPendingRecovery.mockResolvedValueOnce({ status: 'pending', account: ACCOUNT })
    const user = renderPage()
    await fill(user)
    expect(await screen.findByText('Your recovery is still confirming. Check again in a minute.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Recover my account' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect(checkPendingRecovery).toHaveBeenCalledWith(ACCOUNT)
    checkPendingRecovery.mockResolvedValueOnce({ status: 'recovered', session: SESSION })
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByText('Your account is back.')).toBeTruthy()
    expect(recoverWithPhrase).toHaveBeenCalledTimes(1)
  })

  // A revert found later must bring the form back, not leave "still confirming" on screen. The words were
  // dropped when the recovery went pending, so the person types them again.
  it('returns to an empty form when Check again finds the recovery reverted', async () => {
    recoverWithPhrase.mockResolvedValue({ status: 'pending', account: ACCOUNT })
    checkPendingRecovery.mockRejectedValueOnce(new PlainError('The recovery did not go through. Nothing changed. Try again.'))
    const user = renderPage()
    await fill(user)
    await user.click(await screen.findByRole('button', { name: 'Check again' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The recovery did not go through. Nothing changed. Try again.')
    expect(screen.queryByText(/still confirming/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
    for (let i = 1; i <= 12; i++) expect((screen.getByLabelText(`Word ${i}`) as HTMLInputElement).value).toBe('')
  })

  // A dropped recovery must not lock the page forever. Start over shows only once Check again calls it stuck,
  // asks first, and forgets only the pending record. A recovery that did land is found on the next try.
  it('offers Start over for a stuck recovery, asks first, then brings the form back', async () => {
    recoverWithPhrase.mockResolvedValue({ status: 'pending', account: ACCOUNT })
    checkPendingRecovery.mockResolvedValue({ status: 'stuck', account: ACCOUNT })
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    const user = renderPage()
    await fill(user)
    await screen.findByText(/still confirming/)
    expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    await user.click(await screen.findByRole('button', { name: 'Start over' }))
    expect(confirm).toHaveBeenCalledWith('If your recovery already went through, starting over is safe: we will find it.')
    expect(discardPendingRecovery).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy()

    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    expect(discardPendingRecovery).toHaveBeenCalledWith(ACCOUNT)
    expect(screen.queryByText(/still confirming/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Recover my account' })).toBeTruthy()
  })
})

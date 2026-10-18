import { cleanup, render, screen } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import type { Address } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlainError } from '../lib/errors'
import { AddBackupPasskey, confirmLeave } from './AddBackupPasskey'

const ADDRESS = '0x00000000000000000000000000000000000000cC' as Address
const STORED = { address: ADDRESS, credentialId: 'cred-1' }
const PHRASE = 'one two three four five six seven eight nine ten eleven twelve'
const WORDS = PHRASE.split(' ')

const state = { funded: true, pending: false }
const addBackupPasskey = vi.fn()
const checkPendingBackup = vi.fn()
const discardPendingBackup = vi.fn((_address: Address) => {
  state.pending = false
})
const newRecoveryPhrase = vi.fn(async () => PHRASE)
vi.mock('../lib/passkey', () => ({
  addBackupPasskey: (...a: unknown[]) => addBackupPasskey(...a),
  checkPendingBackup: (...a: unknown[]) => checkPendingBackup(...a),
  newRecoveryPhrase: () => newRecoveryPhrase(),
  canPayBackupGas: async () => state.funded,
  discardPendingBackup: (a: Address) => discardPendingBackup(a),
  useBackupPending: () => state.pending,
}))

afterEach(() => {
  cleanup()
  addBackupPasskey.mockReset()
  checkPendingBackup.mockReset()
  discardPendingBackup.mockClear()
  newRecoveryPhrase.mockClear()
  state.funded = true
  state.pending = false
  vi.restoreAllMocks()
})

const LEAVE = 'Leave without saving your backup? Your recovery key has not been added yet.'
const LEAVE_PENDING = 'Leave without saving your backup? Keep these words. The backup may still go through.'

function ui(props: Partial<Parameters<typeof AddBackupPasskey>[0]> = {}) {
  return (
    <MemoryRouter initialEntries={['/me']}>
      <Routes>
        <Route
          path="/me"
          element={
            <>
              <Link to="/elsewhere">Elsewhere</Link>
              <AddBackupPasskey stored={STORED} {...props} />
            </>
          }
        />
        <Route path="/elsewhere" element={<p>Another page</p>} />
        <Route path="/fund" element={<p>Fund page</p>} />
      </Routes>
    </MemoryRouter>
  )
}

async function showWords(user: UserEvent) {
  await user.click(await screen.findByRole('button', { name: 'Show my recovery key' }))
}

// Types the requested words. Each field is labelled with the word's number, for example "Word #3".
async function confirmWords(user: UserEvent, wrong = false) {
  const labels = screen.getAllByText(/^Word #\d+$/)
  expect(labels).toHaveLength(3)
  for (const label of labels) {
    const n = Number(label.textContent!.replace('Word #', ''))
    await user.type(screen.getByLabelText(label.textContent!), wrong ? 'nope' : WORDS[n - 1]!)
  }
  await user.click(screen.getByRole('button', { name: 'Add the recovery key' }))
}

describe('AddBackupPasskey', () => {
  // The person has to understand what a recovery key is and that it controls the account.
  it('explains the recovery key', async () => {
    render(ui())
    expect(screen.getByRole('heading', { name: 'Add a recovery key' })).toBeTruthy()
    expect(
      screen.getByText(
        'If you lose every device with your passkey, nobody can recover your Fundit account. A recovery key is 12 words you write down and keep safe. Anyone with these words can control your account.',
      ),
    ).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Show my recovery key' })).toBeTruthy()
  })

  // Nothing goes on chain before the person has the words: they see them, then prove they wrote them down.
  it('shows the words first and adds the key only after three words are typed back correctly', async () => {
    addBackupPasskey.mockResolvedValue('added')
    const onDone = vi.fn()
    render(ui({ onDone }))
    const user = userEvent.setup()
    await showWords(user)
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(WORDS)
    expect(screen.getByText(/Anyone who has these words can control your account/)).toBeTruthy()
    expect(addBackupPasskey).not.toHaveBeenCalled()

    await confirmWords(user, true)
    expect(screen.getByRole('alert').textContent).toBe('Those words do not match. Check what you wrote down and try again.')
    expect(addBackupPasskey).not.toHaveBeenCalled()

    for (const input of screen.getAllByLabelText(/^Word #\d+$/)) await user.clear(input)
    await confirmWords(user)
    expect(addBackupPasskey).toHaveBeenCalledWith(STORED, PHRASE)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  // A retry must register the same address. New words would leave an owner nobody holds the words for.
  it('keeps the same words on screen after a failed send and retries with them', async () => {
    addBackupPasskey.mockRejectedValueOnce(new PlainError('The backup did not go through. Nothing was added. Try again.'))
    addBackupPasskey.mockResolvedValueOnce('added')
    render(ui())
    const user = userEvent.setup()
    await showWords(user)
    await confirmWords(user)
    expect(screen.getByRole('alert').textContent).toBe('The backup did not go through. Nothing was added. Try again.')
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(WORDS)
    await user.click(screen.getByRole('button', { name: 'Add the recovery key' }))
    expect(addBackupPasskey).toHaveBeenCalledTimes(2)
    expect(addBackupPasskey.mock.calls[1]).toEqual([STORED, PHRASE])
    expect(newRecoveryPhrase).toHaveBeenCalledTimes(1)
  })

  // A send that has not confirmed may still land, so the words stay and Check again asks, without resending.
  it('keeps the words after a timeout and offers Check again', async () => {
    addBackupPasskey.mockResolvedValue('pending')
    checkPendingBackup.mockResolvedValue('added')
    const onDone = vi.fn()
    render(ui({ onDone }))
    const user = userEvent.setup()
    await showWords(user)
    await confirmWords(user)
    expect(screen.getByText('Keep these words. The backup may still go through.')).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(12)
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect(checkPendingBackup).toHaveBeenCalledWith(STORED)
    expect(addBackupPasskey).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  // While an earlier backup is unconfirmed, no new words are made.
  it('blocks a new backup while one is pending', async () => {
    state.pending = true
    checkPendingBackup.mockResolvedValue('pending')
    render(ui())
    expect(screen.getByText('Your last backup is still confirming.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show my recovery key' })).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check again' }))
    expect(checkPendingBackup).toHaveBeenCalledWith(STORED)
    expect(newRecoveryPhrase).not.toHaveBeenCalled()
  })

  // Without USDC for the fee the send can only fail, so the prompt sends the person to add money instead.
  it('asks for money first when the account cannot pay the fee', async () => {
    state.funded = false
    render(ui())
    expect(await screen.findByText('Add a little money first. The backup costs a small network fee.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Add money' }).getAttribute('href')).toBe('/fund')
    expect(screen.queryByRole('button', { name: 'Show my recovery key' })).toBeNull()
  })

  it('offers Later only where it can be put off', async () => {
    const onLater = vi.fn()
    const { unmount } = render(ui())
    expect(screen.queryByRole('button', { name: 'Later' })).toBeNull()
    unmount()
    render(ui({ onLater }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Later' }))
    expect(onLater).toHaveBeenCalledTimes(1)
  })
})

describe('a stuck backup', () => {
  const START_OVER = 'Your last backup may still go through. If it does, the words you saved will also work. Start over with new words?'

  // Before the cutoff only Check again is offered: the operation may still land.
  it('offers only Check again while the backup is pending but not stuck', async () => {
    state.pending = true
    checkPendingBackup.mockResolvedValue('pending')
    render(ui())
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check again' }))
    expect(checkPendingBackup).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull()
  })

  // A dropped operation must not block a recovery key forever. Start over asks, then clears the record.
  it('offers Start over once Check again finds it stuck, and clears the record after confirmation', async () => {
    state.pending = true
    checkPendingBackup.mockResolvedValue('stuck')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { rerender } = render(ui())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    expect(confirm).toHaveBeenCalledWith(START_OVER)
    expect(discardPendingBackup).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    expect(discardPendingBackup).toHaveBeenCalledWith(ADDRESS)
    rerender(ui())
    expect(await screen.findByRole('button', { name: 'Show my recovery key' })).toBeTruthy()
  })

  it('offers Start over with the words still on screen after a stuck send', async () => {
    addBackupPasskey.mockResolvedValue('pending')
    checkPendingBackup.mockResolvedValue('stuck')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(ui())
    const user = userEvent.setup()
    await showWords(user)
    await confirmWords(user)
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    expect(discardPendingBackup).toHaveBeenCalledWith(ADDRESS)
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})

describe('leaving with the words on screen', () => {
  // Without a hash nothing is known to have been sent, so the words stay and the warning is the plain one.
  it('keeps the not-added warning after a send that failed without a hash', async () => {
    addBackupPasskey.mockRejectedValue(new Error('Failed to fetch'))
    const onGuardChange = vi.fn()
    render(ui({ onGuardChange }))
    const user = userEvent.setup()
    await showWords(user)
    await confirmWords(user)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(onGuardChange).toHaveBeenLastCalledWith(LEAVE)
    expect(screen.getAllByRole('listitem')).toHaveLength(12)
  })

  // Sign out and other actions outside the prompt ask the same question through confirmLeave.
  it('confirmLeave asks while the words are shown and passes otherwise', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(ui())
    expect(confirmLeave()).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    await showWords(userEvent.setup())
    expect(confirmLeave()).toBe(false)
    expect(confirm).toHaveBeenCalledWith(LEAVE)
  })

  it('reports the leave warning while the words are shown, and the pending one after a send', async () => {
    addBackupPasskey.mockResolvedValue('pending')
    const onGuardChange = vi.fn()
    render(ui({ onGuardChange }))
    const user = userEvent.setup()
    expect(onGuardChange).toHaveBeenLastCalledWith(null)
    await showWords(user)
    expect(onGuardChange).toHaveBeenLastCalledWith(LEAVE)
    await confirmWords(user)
    expect(onGuardChange).toHaveBeenLastCalledWith(LEAVE_PENDING)
  })

  it('asks before the page unloads while the words are shown', async () => {
    render(ui())
    const before = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(before)
    expect(before.defaultPrevented).toBe(false)
    await showWords(userEvent.setup())
    const during = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(during)
    expect(during.defaultPrevented).toBe(true)
  })

  it('asks before following a link in the app, and stays when the person says no', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(ui())
    const user = userEvent.setup()
    await showWords(user)
    await user.click(screen.getByRole('link', { name: 'Elsewhere' }))
    expect(confirm).toHaveBeenCalledWith(LEAVE)
    expect(screen.queryByText('Another page')).toBeNull()
    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('link', { name: 'Elsewhere' }))
    expect(screen.getByText('Another page')).toBeTruthy()
  })
})

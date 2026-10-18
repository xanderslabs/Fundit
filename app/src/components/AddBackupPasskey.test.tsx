import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Address } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddBackupPasskey } from './AddBackupPasskey'

const ADDRESS = '0x00000000000000000000000000000000000000cC' as Address
const STORED = { address: ADDRESS, credentialId: 'cred-1' }
const PHRASE = 'one two three four five six seven eight nine ten eleven twelve'

const addBackupPasskey = vi.fn()
const markBackupSaved = vi.fn()
vi.mock('../lib/passkey', () => ({
  addBackupPasskey: (...a: unknown[]) => addBackupPasskey(...a),
  newRecoveryPhrase: async () => PHRASE,
  markBackupSaved: (a: Address) => markBackupSaved(a),
}))

afterEach(() => {
  cleanup()
  addBackupPasskey.mockReset()
  markBackupSaved.mockReset()
})

describe('AddBackupPasskey', () => {
  // The person has to understand that losing every passkey loses the account for good.
  it('explains why a backup matters', () => {
    render(<AddBackupPasskey stored={STORED} />)
    expect(screen.getByRole('heading', { name: 'Add a backup' })).toBeTruthy()
    expect(
      screen.getByText(
        'If you lose every device with your passkey, nobody can recover your Fundit account. Add a second device or a recovery key now.',
      ),
    ).toBeTruthy()
  })

  // The backup only counts once the person has the words. Saved is recorded when they say so, not before.
  it('Add a backup registers a recovery key, then shows its words until the person saves them', async () => {
    addBackupPasskey.mockResolvedValue(undefined)
    const onDone = vi.fn()
    render(<AddBackupPasskey stored={STORED} onDone={onDone} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add a backup' }))
    expect(addBackupPasskey).toHaveBeenCalledWith(STORED, PHRASE)
    const words = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(words).toEqual(PHRASE.split(' '))
    expect(screen.getByText(/Anyone who has these words can take your account/)).toBeTruthy()
    expect(markBackupSaved).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'I saved my recovery key' }))
    expect(markBackupSaved).toHaveBeenCalledWith(ADDRESS)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  // A failed backup must not look done: no words shown, nothing marked saved, and a reason in plain words.
  it('shows the reason when the backup fails and marks nothing saved', async () => {
    const { PlainError } = await import('../lib/errors')
    addBackupPasskey.mockRejectedValue(new PlainError('Add at least 0.05 USDC to your Fundit account first.'))
    render(<AddBackupPasskey stored={STORED} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add a backup' }))
    expect(screen.getByRole('alert').textContent).toBe('Add at least 0.05 USDC to your Fundit account first.')
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(markBackupSaved).not.toHaveBeenCalled()
  })

  it('offers Later only where it can be put off', async () => {
    const onLater = vi.fn()
    const { rerender } = render(<AddBackupPasskey stored={STORED} />)
    expect(screen.queryByRole('button', { name: 'Later' })).toBeNull()
    rerender(<AddBackupPasskey stored={STORED} onLater={onLater} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Later' }))
    expect(onLater).toHaveBeenCalledTimes(1)
  })
})

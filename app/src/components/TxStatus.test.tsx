import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Hex, TransactionReceipt } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Call, Sender, TxResult } from '../lib/sender'
import { TxStatus, useTx } from './TxStatus'

const OP_HASH = `0x${'1'.repeat(64)}` as Hex
const TX_HASH = `0x${'2'.repeat(64)}` as Hex
const CALL: Call = { to: '0x00000000000000000000000000000000000000a1', data: '0x01' }
const success: TxResult = { status: 'success', hash: TX_HASH, receipt: { status: 'success' } as TransactionReceipt }

const waitForResult = vi.hoisted(() => vi.fn())
vi.mock('../lib/sender', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/sender')>()), waitForResult }))

function Harness({ sender }: { sender: Sender }) {
  const tx = useTx(() => {})
  return (
    <>
      <button type="button" onClick={() => void tx.run(sender, () => CALL, 'Test')}>
        Go
      </button>
      <TxStatus tx={tx} noun="change" successText="Saved." startOverWarning="Start over?" />
    </>
  )
}

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('useTx with TxStatus', () => {
  // A passkey timeout holds a user operation hash. Only the sender's bundler can find it, never the explorer.
  it('rechecks a passkey timeout through sender.recheck and then links the real transaction', async () => {
    const recheck = vi.fn(async () => success)
    const sender: Sender = {
      kind: 'passkey',
      address: '0x00000000000000000000000000000000000000cc',
      send: async () => ({ status: 'timeout', hash: OP_HASH, completed: 0, hashKind: 'userop' }),
      recheck,
    }
    render(<Harness sender={sender} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Go' }))
    expect(await screen.findByText('Your passkey transaction is still processing.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /explorer/i })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByText('Saved.')).toBeTruthy()
    expect(recheck).toHaveBeenCalledWith(OP_HASH)
    expect(waitForResult).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: /explorer/i }).getAttribute('href')).toBe(`https://explorer.arc.io/tx/${TX_HASH}`)
  })

  it('rechecks a wallet timeout with waitForResult', async () => {
    waitForResult.mockResolvedValue(success)
    const sender: Sender = {
      kind: 'eoa',
      address: '0x00000000000000000000000000000000000000cc',
      send: async () => ({ status: 'timeout', hash: TX_HASH, completed: 0 }),
    }
    render(<Harness sender={sender} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Go' }))
    expect(screen.getByRole('link', { name: /explorer/i }).getAttribute('href')).toBe(`https://explorer.arc.io/tx/${TX_HASH}`)
    await user.click(await screen.findByRole('button', { name: 'Check again' }))
    expect(await screen.findByText('Saved.')).toBeTruthy()
    expect(waitForResult).toHaveBeenCalledWith(expect.anything(), TX_HASH, expect.any(Number))
  })

  // A wallet sends a call list one call at a time, so a failed second call could leave an open approval.
  it('refuses several calls for a wallet sender and sends nothing', async () => {
    const send = vi.fn(async () => success)
    const sender: Sender = { kind: 'eoa', address: '0x00000000000000000000000000000000000000cc', send }
    function Many() {
      const tx = useTx(() => {})
      return (
        <>
          <button type="button" onClick={() => void tx.run(sender, () => [CALL, CALL], 'Test')}>
            Go
          </button>
          <TxStatus tx={tx} noun="change" successText="Saved." startOverWarning="Start over?" />
        </>
      )
    }
    render(<Many />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Go' }))
    expect(await screen.findByText(/useTx: several calls need a passkey sender/)).toBeTruthy()
    expect(send).not.toHaveBeenCalled()
  })
})

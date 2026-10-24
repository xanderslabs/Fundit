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

function Harness({ sender, wallet }: { sender: Sender; wallet?: boolean }) {
  const tx = useTx(() => {})
  return (
    <>
      <button type="button" onClick={() => void tx.run(sender, () => CALL, 'Test')}>
        Go
      </button>
      <TxStatus tx={tx} noun="change" successText="Saved." startOverWarning="Start over?" wallet={wallet} />
    </>
  )
}

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('useTx with TxStatus', () => {
  // Sign-in is passkey only, so a send asks for the passkey. Only Add money sends from a regular wallet.
  it('asks for the passkey while sending, or the wallet when told it is one', async () => {
    const sender: Sender = { kind: 'passkey', address: '0x00000000000000000000000000000000000000cc', send: () => new Promise(() => {}) }
    const user = userEvent.setup()
    const { unmount } = render(<Harness sender={sender} />)
    await user.click(screen.getByRole('button', { name: 'Go' }))
    expect(await screen.findByText(/^Confirm with your passkey, then wait for the network\./)).toBeTruthy()
    expect(screen.queryByText(/wallet/)).toBeNull()
    unmount()
    render(<Harness sender={{ ...sender, kind: 'wallet' }} wallet />)
    await user.click(screen.getByRole('button', { name: 'Go' }))
    expect(await screen.findByText(/^Confirm in your wallet, then wait for the network\./)).toBeTruthy()
  })

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
      kind: 'wallet',
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

  // Every sender turns a call list into one send (a wallet batches through Multicall3From), so run never splits it.
  it('passes several calls to a wallet sender in one send', async () => {
    const send = vi.fn(async () => success)
    const sender: Sender = { kind: 'wallet', address: '0x00000000000000000000000000000000000000cc', send }
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
    expect(await screen.findByText('Saved.')).toBeTruthy()
    expect(send).toHaveBeenCalledTimes(1)
    expect((send.mock.calls[0] as unknown[] | undefined)?.[0]).toEqual([CALL, CALL])
  })
})

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Hex, TransactionReceipt } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Call, Sender, TxResult } from '../lib/sender'
import { TxStatus, useTx } from './TxStatus'

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
  // The line names the prompt the sender shows next: Circle's window for email, or the wallet's own.
  it("asks for Circle's window for an email sender, or the wallet for a wallet sender", async () => {
    const sender: Sender = { kind: 'email', address: '0x00000000000000000000000000000000000000cc', send: () => new Promise(() => {}) }
    const user = userEvent.setup()
    const { unmount } = render(<Harness sender={sender} />)
    await user.click(screen.getByRole('button', { name: 'Go' }))
    expect(await screen.findByText(/^Approve in the Circle window, then wait for the network\./)).toBeTruthy()
    expect(screen.queryByText(/wallet/)).toBeNull()
    unmount()
    render(<Harness sender={{ ...sender, kind: 'wallet' }} />)
    await user.click(screen.getByRole('button', { name: 'Go' }))
    expect(await screen.findByText(/^Confirm in your wallet, then wait for the network\./)).toBeTruthy()
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

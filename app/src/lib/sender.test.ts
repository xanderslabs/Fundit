import type { Config } from '@wagmi/core'
import { type Hex, type TransactionReceipt, UserRejectedRequestError } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ARC_CHAIN_ID } from '../config'
import { type ReceiptClient, waitForResult, wagmiSender } from './sender'

const core = vi.hoisted(() => ({
  getChainId: vi.fn(),
  switchChain: vi.fn(),
  sendTransaction: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}))
vi.mock('@wagmi/core', () => core)

const ME = '0x1111111111111111111111111111111111111111'
const A = '0x00000000000000000000000000000000000000a1'
const B = '0x00000000000000000000000000000000000000b2'
const H1 = `0x${'1'.repeat(64)}` as Hex
const H2 = `0x${'2'.repeat(64)}` as Hex
const config = {} as Config

function receipt(hash: Hex, status: 'success' | 'reverted') {
  return { transactionHash: hash, status, logs: [] } as unknown as TransactionReceipt
}

beforeEach(() => {
  vi.resetAllMocks()
  core.getChainId.mockReturnValue(ARC_CHAIN_ID)
  core.waitForTransactionReceipt.mockImplementation(async (_c, { hash }: { hash: Hex }) => receipt(hash, 'success'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('wagmiSender', () => {
  // A wallet left on Base must be moved to Arc first. Sending there would put the call on the wrong chain.
  it('switches to Arc when the wallet is on Base', async () => {
    core.getChainId.mockReturnValue(8453)
    core.switchChain.mockResolvedValue({ id: ARC_CHAIN_ID })
    core.sendTransaction.mockResolvedValue(H1)
    const res = await wagmiSender(config, ME).send([{ to: A, data: '0x01' }])
    expect(core.switchChain).toHaveBeenCalledWith(config, { chainId: ARC_CHAIN_ID })
    expect(core.switchChain.mock.invocationCallOrder[0]!).toBeLessThan(core.sendTransaction.mock.invocationCallOrder[0]!)
    // The chain id on the send makes wagmi refuse if the wallet is still somewhere else.
    expect(core.sendTransaction).toHaveBeenCalledWith(config, expect.objectContaining({ chainId: ARC_CHAIN_ID }))
    expect(res.status).toBe('success')
  })

  it('returns rejected and sends nothing when the switch is refused', async () => {
    core.getChainId.mockReturnValue(8453)
    core.switchChain.mockRejectedValue(new UserRejectedRequestError(new Error('User rejected')))
    const res = await wagmiSender(config, ME).send([{ to: A, data: '0x01' }])
    expect(res).toEqual({ status: 'rejected' })
    expect(core.sendTransaction).not.toHaveBeenCalled()
  })

  it('returns rejected when the wallet refuses to sign', async () => {
    core.sendTransaction.mockRejectedValue(new UserRejectedRequestError(new Error('User rejected')))
    expect(await wagmiSender(config, ME).send([{ to: A, data: '0x01' }])).toEqual({ status: 'rejected' })
  })

  // A later call often depends on the earlier one (approve, then donate), so it must not go out after a failure.
  it('sends calls in order, one transaction each, and stops after a revert', async () => {
    core.sendTransaction.mockResolvedValueOnce(H1).mockResolvedValueOnce(H2)
    const ok = await wagmiSender(config, ME).send([
      { to: A, data: '0x01' },
      { to: B, data: '0x02' },
    ])
    expect(core.sendTransaction.mock.calls.map((c) => c[1].to)).toEqual([A, B])
    // The second send waits for the first receipt.
    expect(core.waitForTransactionReceipt.mock.invocationCallOrder[0]!).toBeLessThan(
      core.sendTransaction.mock.invocationCallOrder[1]!,
    )
    expect(ok).toMatchObject({ status: 'success', hash: H2 })

    core.sendTransaction.mockReset().mockResolvedValue(H1)
    core.waitForTransactionReceipt.mockReset().mockResolvedValue(receipt(H1, 'reverted'))
    const bad = await wagmiSender(config, ME).send([
      { to: A, data: '0x01' },
      { to: B, data: '0x02' },
    ])
    expect(bad).toMatchObject({ status: 'reverted', hash: H1 })
    expect(core.sendTransaction).toHaveBeenCalledTimes(1)
  })
})

describe('waitForResult', () => {
  // Arc drops transactions under its base fee floor. A wait that never ends must become "not confirmed yet".
  it('returns timeout after timeoutMs', async () => {
    vi.useFakeTimers()
    const client: ReceiptClient = { waitForTransactionReceipt: () => new Promise(() => {}) }
    const pending = waitForResult(client, H1, 60_000)
    await vi.advanceTimersByTimeAsync(59_999)
    let settled = false
    void pending.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toEqual({ status: 'timeout', hash: H1 })
  })

  it('returns success with the receipt, or reverted', async () => {
    const ok: ReceiptClient = { waitForTransactionReceipt: async () => receipt(H1, 'success') }
    expect(await waitForResult(ok, H1, 1000)).toMatchObject({ status: 'success', hash: H1 })
    const bad: ReceiptClient = { waitForTransactionReceipt: async () => receipt(H1, 'reverted') }
    const res = await waitForResult(bad, H1, 1000)
    expect(res.status).toBe('reverted')
  })
})

import type { Config } from '@wagmi/core'
import { UserRejectedRequestError } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ARC_CHAIN_ID, MULTICALL3_FROM } from '../config'
import { WrongWalletAccount } from './errors'
import type { Call } from './sender'

const ME = '0x00000000000000000000000000000000000000aa'
const OTHER = '0x00000000000000000000000000000000000000bb'
const HASH = `0x${'11'.repeat(32)}`
const RECEIPT = { status: 'success', transactionHash: HASH }

const { getAccount, getChainId, switchChain, sendTransaction, estimateGas, waitForResult } = vi.hoisted(() => ({
  getAccount: vi.fn(),
  getChainId: vi.fn(),
  switchChain: vi.fn(),
  sendTransaction: vi.fn(),
  estimateGas: vi.fn(),
  waitForResult: vi.fn(),
}))

vi.mock('@wagmi/core', () => ({ getAccount, getChainId, switchChain, sendTransaction }))
vi.mock('./clients', () => ({ arcClient: { estimateGas } }))
vi.mock('./sender', async (orig) => ({ ...(await orig<typeof import('./sender')>()), waitForResult }))

import { wagmiSender } from './wagmiSender'

const CALLS: Call[] = [
  { to: '0x00000000000000000000000000000000000000a1', data: '0x01' },
  { to: '0x00000000000000000000000000000000000000a2', data: '0x02' },
]
const config = {} as Config

beforeEach(() => {
  vi.resetAllMocks()
  getAccount.mockReturnValue({ address: ME })
  getChainId.mockReturnValue(ARC_CHAIN_ID)
  estimateGas.mockResolvedValue(100_000n)
  sendTransaction.mockResolvedValue(HASH)
  waitForResult.mockResolvedValue({ status: 'success', hash: HASH, receipt: RECEIPT })
})

describe('wagmiSender', () => {
  it('kind is wallet', () => {
    expect(wagmiSender(config, ME).kind).toBe('wallet')
  })

  it('sends two calls as one transaction', async () => {
    const onHash = vi.fn()
    const res = await wagmiSender(config, ME).send(CALLS, { label: 'Test', onHash })
    expect(res.status).toBe('success')
    expect(sendTransaction).toHaveBeenCalledTimes(1)
    expect(sendTransaction.mock.calls[0]?.[1]).toMatchObject({ account: ME, to: MULTICALL3_FROM })
    expect(estimateGas).toHaveBeenCalledTimes(1)
    expect(onHash).toHaveBeenCalledTimes(1)
    expect(onHash).toHaveBeenCalledWith(HASH, CALLS.length - 1)
  })

  // The person can switch accounts inside the wallet while signed in. Never send from the other address.
  it('refuses when the connected account differs', async () => {
    getAccount.mockReturnValue({ address: OTHER })
    await expect(wagmiSender(config, ME).send(CALLS, { label: 'Test' })).rejects.toBeInstanceOf(WrongWalletAccount)
    expect(sendTransaction).not.toHaveBeenCalled()
  })

  it('user cancel is rejected', async () => {
    sendTransaction.mockRejectedValue(new UserRejectedRequestError(new Error('no')))
    const res = await wagmiSender(config, ME).send(CALLS, { label: 'Test' })
    expect(res).toEqual({ status: 'rejected', completed: 0 })
  })
})

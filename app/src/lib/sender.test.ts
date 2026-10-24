import type { Config } from '@wagmi/core'
import {
  encodeErrorResult,
  type Hex,
  RawContractError,
  BaseError,
  type TransactionReceipt,
  UserRejectedRequestError,
  WaitForTransactionReceiptTimeoutError,
} from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { campaignAbi } from '../abi/campaign'
import { ARC_CHAIN_ID, MULTICALL3_FROM } from '../config'
import { type Call, type ReceiptClient, waitForResult } from './sender'
import { wagmiSender } from './wagmiSender'

const core = vi.hoisted(() => ({
  getAccount: vi.fn(),
  getChainId: vi.fn(),
  switchChain: vi.fn(),
  sendTransaction: vi.fn(),
}))
vi.mock('@wagmi/core', () => core)

// The Arc public client. Its waitForTransactionReceipt is viem's, which resolves a reverted receipt.
const arc = vi.hoisted(() => ({
  estimateGas: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  getTransaction: vi.fn(),
  call: vi.fn(),
}))
vi.mock('./clients', () => ({ arcClient: arc }))

const ME = '0x1111111111111111111111111111111111111111'
const A = '0x00000000000000000000000000000000000000a1'
const B = '0x00000000000000000000000000000000000000b2'
const H1 = `0x${'1'.repeat(64)}` as Hex
const config = {} as Config
const REVERTED = 'The transaction failed on chain. Nothing changed, but the network fee was spent.'

function receipt(hash: Hex, status: 'success' | 'reverted') {
  return { transactionHash: hash, status, blockNumber: 7n, logs: [] } as unknown as TransactionReceipt
}

function rejection() {
  return new UserRejectedRequestError(new Error('User rejected'))
}

// What viem's call throws when the replayed transaction hits a custom error.
function revertError(name: string) {
  const abiError = campaignAbi.find((x) => x.type === 'error' && x.name === name)!
  const data = encodeErrorResult({ abi: [abiError], errorName: name } as never)
  return new BaseError('Execution reverted', { cause: new RawContractError({ data }) })
}

beforeEach(() => {
  vi.resetAllMocks()
  core.getAccount.mockReturnValue({ address: ME })
  core.getChainId.mockReturnValue(ARC_CHAIN_ID)
  arc.estimateGas.mockResolvedValue(100_003n)
  arc.waitForTransactionReceipt.mockImplementation(async ({ hash }: { hash: Hex }) => receipt(hash, 'success'))
  arc.getTransaction.mockResolvedValue({ from: ME, to: A, input: '0x01' })
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
    core.switchChain.mockRejectedValue(rejection())
    const res = await wagmiSender(config, ME).send([{ to: A, data: '0x01' }])
    expect(res).toEqual({ status: 'rejected', completed: 0 })
    expect(core.sendTransaction).not.toHaveBeenCalled()
  })

  it('returns rejected when the wallet refuses to sign', async () => {
    core.sendTransaction.mockRejectedValue(rejection())
    expect(await wagmiSender(config, ME).send([{ to: A, data: '0x01' }])).toEqual({ status: 'rejected', completed: 0 })
  })

  // An empty list is a bug in the caller, not something the person declined.
  // Campaign._activity() skips two storage writes when its last activity is in the estimate's block, so the
  // estimate can be about 3,200 gas short and the transaction would run out of gas. The one batched send gets
  // 25% on top of one estimate.
  it('estimates the batch once on Arc and sends it with 25% more gas, rounded down', async () => {
    core.sendTransaction.mockResolvedValueOnce(H1)
    await wagmiSender(config, ME).send([
      { to: A, data: '0x01' },
      { to: B, data: '0x02' },
    ])
    expect(arc.estimateGas).toHaveBeenCalledTimes(1)
    expect(arc.estimateGas.mock.calls[0]![0]).toMatchObject({ account: ME, to: MULTICALL3_FROM })
    expect(core.sendTransaction.mock.calls.map((c) => c[1].gas)).toEqual([125_003n])
  })

  // Today's behaviour for a call that would revert: the error reaches explainError and nothing is sent.
  it('sends nothing and throws when the gas estimate reverts', async () => {
    arc.estimateGas.mockRejectedValue(revertError('CampaignClosed'))
    await expect(wagmiSender(config, ME).send([{ to: A, data: '0x01' }])).rejects.toThrow()
    expect(core.sendTransaction).not.toHaveBeenCalled()
  })

  it('throws on an empty call list', async () => {
    await expect(wagmiSender(config, ME).send([])).rejects.toThrow('No calls to send')
  })

  // The batch is one transaction, so a revert or a timeout leaves none of the calls done.
  it('reports a reverted batch and a timed out batch with no completed calls', async () => {
    core.sendTransaction.mockResolvedValue(H1)
    const two: Call[] = [
      { to: A, data: '0x01' as Hex },
      { to: B, data: '0x02' as Hex },
    ]
    arc.waitForTransactionReceipt.mockResolvedValueOnce(receipt(H1, 'reverted'))
    expect(await wagmiSender(config, ME).send(two)).toMatchObject({ status: 'reverted', hash: H1, completed: 0 })
    arc.waitForTransactionReceipt.mockRejectedValueOnce(new WaitForTransactionReceiptTimeoutError({ hash: H1 }))
    expect(await wagmiSender(config, ME).send(two)).toEqual({ status: 'timeout', hash: H1, completed: 0 })
  })
})

describe('waitForResult', () => {
  function client(over: Partial<ReceiptClient>): ReceiptClient {
    return {
      waitForTransactionReceipt: async () => receipt(H1, 'success'),
      getTransaction: async () => ({ from: ME, to: A, input: '0x01' }),
      call: async () => ({}),
      ...over,
    }
  }

  // Arc drops transactions under its base fee floor. A wait that never ends must become "not confirmed yet".
  it('returns timeout after timeoutMs', async () => {
    vi.useFakeTimers()
    const c = client({ waitForTransactionReceipt: () => new Promise(() => {}) })
    const pending = waitForResult(c, H1, 60_000)
    let settled = false
    void pending.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(59_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toEqual({ status: 'timeout', hash: H1, completed: 0 })
  })

  it("maps viem's own timeout and other wait errors to timeout", async () => {
    const viemTimeout = client({
      waitForTransactionReceipt: async () => {
        throw new WaitForTransactionReceiptTimeoutError({ hash: H1 })
      },
    })
    expect(await waitForResult(viemTimeout, H1, 1000)).toMatchObject({ status: 'timeout' })
    const rpcDown = client({
      waitForTransactionReceipt: async () => {
        throw new Error('fetch failed')
      },
    })
    expect(await waitForResult(rpcDown, H1, 1000)).toMatchObject({ status: 'timeout' })
  })

  it('returns success with the receipt', async () => {
    expect(await waitForResult(client({}), H1, 1000)).toMatchObject({ status: 'success', hash: H1 })
  })

  // A mined revert is final. Calling it "not confirmed yet" would send the person to wait for nothing.
  it('returns reverted with a plain reason when the mined transaction reverted', async () => {
    const call = vi.fn(async () => {
      throw revertError('CampaignClosed')
    })
    const c = client({ waitForTransactionReceipt: async () => receipt(H1, 'reverted'), call })
    const res = await waitForResult(c, H1, 1000)
    expect(res).toEqual({ status: 'reverted', hash: H1, completed: 0, error: `${REVERTED} This Fundit is closed.` })
    // The replay runs at the block the transaction was mined in.
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ account: ME, to: A, data: '0x01', blockNumber: 7n }))
  })

  it('still returns reverted when the reason cannot be read', async () => {
    const c = client({
      waitForTransactionReceipt: async () => receipt(H1, 'reverted'),
      getTransaction: async () => {
        throw new Error('rpc error')
      },
    })
    expect(await waitForResult(c, H1, 1000)).toEqual({ status: 'reverted', hash: H1, completed: 0, error: REVERTED })
  })

  // A slow or failing replay is not a reason. Adding "the network took too long" would blame the wrong thing.
  it('adds no network text to a revert whose replay fails', async () => {
    const c = client({
      waitForTransactionReceipt: async () => receipt(H1, 'reverted'),
      getTransaction: async () => {
        throw new Error('The request timed out.')
      },
    })
    expect(await waitForResult(c, H1, 1000)).toEqual({ status: 'reverted', hash: H1, completed: 0, error: REVERTED })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ARC_CHAIN_ID, MULTICALL3_FROM, storageKey } from '../config'
import { toBatch } from './batch'
import { readEmailSession, saveEmailSession } from './emailAccount'
import { explainError, PlainError } from './errors'
import type { Call } from './sender'

const ME = '0x00000000000000000000000000000000000000aa'
const WALLET_ID = '6f1c1b1e-1c1a-4b5e-8a3b-2a1d1e1f1a1b'
const HASH = `0x${'11'.repeat(32)}`
const SIGNED = `0x02f8${'ab'.repeat(40)}`
const RECEIPT = { status: 'success', transactionHash: HASH }
const SESSION = { address: ME, walletId: WALLET_ID, email: 'ana@example.com' } as const

const { runChallenge, getTransactionCount, estimateGas, estimateFeesPerGas, sendRawTransaction, waitForResult } = vi.hoisted(() => ({
  runChallenge: vi.fn(),
  getTransactionCount: vi.fn(),
  estimateGas: vi.fn(),
  estimateFeesPerGas: vi.fn(),
  sendRawTransaction: vi.fn(),
  waitForResult: vi.fn(),
}))

// Circle's window is the one part faked here. The token refresh runs for real against the mocked Worker.
vi.mock('./circleEmail', async (orig) => ({ ...(await orig<typeof import('./circleEmail')>()), runChallenge }))
vi.mock('@circle-fin/w3s-pw-web-sdk', () => ({
  W3SSdk: function W3SSdk() {
    return { setThemeColor: () => {}, getDeviceId: async () => 'device-id-0001' }
  },
}))
vi.mock('./clients', () => ({ arcClient: { getTransactionCount, estimateGas, estimateFeesPerGas, sendRawTransaction } }))
vi.mock('./sender', async (orig) => ({ ...(await orig<typeof import('./sender')>()), waitForResult }))

import { emailSender, NONCE_BUSY, NOT_AVAILABLE } from './emailSender'

const CALLS: Call[] = [
  { to: '0x00000000000000000000000000000000000000a1', data: '0x01' },
  { to: '0x00000000000000000000000000000000000000a2', data: '0x02' },
]

type Answer = { status: number; body: unknown }
const fetchMock = vi.fn()

function answers(...list: Answer[]) {
  for (const a of list) fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } }))
}

function signRequests(): Record<string, unknown>[] {
  return fetchMock.mock.calls.filter(([url]) => url === '/api/ucw/sign-transaction').map(([, init]) => JSON.parse((init as RequestInit).body as string) as Record<string, unknown>)
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  saveEmailSession(SESSION)
  getTransactionCount.mockResolvedValue(7)
  estimateGas.mockResolvedValue(100_000n)
  estimateFeesPerGas.mockResolvedValue({ maxFeePerGas: 41_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n })
  sendRawTransaction.mockResolvedValue(HASH)
  waitForResult.mockResolvedValue({ status: 'success', hash: HASH, receipt: RECEIPT })
  runChallenge.mockResolvedValue({ kind: 'done', data: { signedTransaction: SIGNED, txHash: HASH } })
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('emailSender', () => {
  it('kind is email', () => {
    expect(emailSender(SESSION).kind).toBe('email')
  })

  // The Worker signs only plain JSON of the allowed fields (worker/policy.ts) on this build's chain. A gift is an
  // approve and a donate, so they must go out as one Multicall3From transaction, or the donate runs unapproved.
  it('builds one EIP-1559 transaction to Multicall3From for two calls with chainId, pending nonce and gas margin', async () => {
    answers({ status: 200, body: { challengeId: 'c-1' } })
    const res = await emailSender(SESSION).send(CALLS, { label: 'Donate' })
    expect(res.status).toBe('success')
    expect(getTransactionCount).toHaveBeenCalledWith({ address: ME, blockTag: 'pending' })
    const [req] = signRequests()
    expect(signRequests()).toHaveLength(1)
    expect(req!.walletId).toBe(WALLET_ID)
    const text = req!.transaction as string
    const tx = JSON.parse(text) as Record<string, unknown>
    // Exactly JSON.stringify output, or the Worker refuses it.
    expect(JSON.stringify(tx)).toBe(text)
    expect(tx).toEqual({
      chainId: ARC_CHAIN_ID,
      nonce: '7',
      to: MULTICALL3_FROM,
      value: '0',
      data: toBatch(CALLS).data,
      gas: '125000',
      maxFeePerGas: '41000000000',
      maxPriorityFeePerGas: '1000000000',
    })
    expect(tx).not.toHaveProperty('type')
    expect(runChallenge).toHaveBeenCalledWith('c-1')
  })

  // Circle's screen shows empty To and Total for a signed transaction, so the memo is what names the action there.
  it('sends the memo', async () => {
    answers({ status: 200, body: { challengeId: 'c-1' } })
    await emailSender(SESSION).send(CALLS, { label: 'Donate' })
    expect(signRequests()[0]!.memo).toBe('Donate')
  })

  it('broadcasts the signed transaction and returns waitForResult', async () => {
    answers({ status: 200, body: { challengeId: 'c-1' } })
    const onHash = vi.fn()
    const res = await emailSender(SESSION).send(CALLS, { label: 'Donate', onHash })
    expect(sendRawTransaction).toHaveBeenCalledWith({ serializedTransaction: SIGNED })
    expect(onHash).toHaveBeenCalledWith(HASH, CALLS.length - 1)
    // A reload during the wait must still know the gift went out.
    expect(onHash.mock.invocationCallOrder[0]!).toBeLessThan(waitForResult.mock.invocationCallOrder[0]!)
    expect(res).toEqual({ status: 'success', hash: HASH, receipt: RECEIPT })
  })

  // Closing Circle's window is a choice, not a failure: no error banner.
  it('user cancel is rejected', async () => {
    answers({ status: 200, body: { challengeId: 'c-1' } })
    runChallenge.mockResolvedValue({ kind: 'cancelled' })
    const res = await emailSender(SESSION).send(CALLS, { label: 'Donate' })
    expect(res).toEqual({ status: 'rejected', completed: 0 })
    expect(sendRawTransaction).not.toHaveBeenCalled()
  })

  // Circle's user token lasts less than a session. The first send after it expires refreshes once and goes on.
  it('refreshes once on an expired token', async () => {
    answers(
      { status: 403, body: { code: 155104, message: 'userToken expired' } },
      { status: 200, body: { userToken: 'u'.repeat(30), encryptionKey: 'k'.repeat(30) } },
      { status: 200, body: { challengeId: 'c-2' } },
    )
    const res = await emailSender(SESSION).send(CALLS, { label: 'Donate' })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/ucw/sign-transaction', '/api/ucw/session', '/api/ucw/sign-transaction'])
    expect(JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string)).toEqual({ deviceId: 'device-id-0001' })
    expect(runChallenge).toHaveBeenCalledWith('c-2')
    expect(res.status).toBe('success')
    expect(readEmailSession()).toEqual(SESSION)
  })

  it('a failed refresh signs out and asks to sign in again', async () => {
    answers({ status: 403, body: { code: 155104, message: 'userToken expired' } }, { status: 401, body: { error: 'Session expired', code: 155104 } })
    const err = await emailSender(SESSION).send(CALLS, { label: 'Donate' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PlainError)
    expect(explainError(err)).toBe('Sign in again to continue')
    expect(readEmailSession()).toBeNull()
    expect(localStorage.getItem(storageKey('session.email'))).toBeNull()
    expect(signRequests()).toHaveLength(1)
    expect(runChallenge).not.toHaveBeenCalled()
  })

  // The Worker's cookies expired or were cleared (or another tab signed out). Without this the store would still
  // show the account while every send failed with a generic message.
  it('sign-transaction 401 with no code signs out and asks to sign in again', async () => {
    answers({ status: 401, body: { error: 'Not signed in' } })
    const err = await emailSender(SESSION).send(CALLS, { label: 'Donate' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PlainError)
    expect(explainError(err)).toBe('Sign in again to continue')
    expect(readEmailSession()).toBeNull()
    expect(signRequests()).toHaveLength(1)
    expect(runChallenge).not.toHaveBeenCalled()
  })

  // The Worker refuses anything but Fundit's own contracts before Circle is called.
  it('a Worker 403 shows "This action is not available"', async () => {
    answers({ status: 403, body: { error: 'Contract not allowed' } })
    const err = await emailSender(SESSION).send(CALLS, { label: 'Donate' }).catch((e: unknown) => e)
    expect(NOT_AVAILABLE).toBe('This action is not available')
    expect(explainError(err)).toBe(NOT_AVAILABLE)
    expect(runChallenge).not.toHaveBeenCalled()
  })

  // Two sends at once take the same pending nonce. The second is refused by the node, nothing was sent.
  it('"nonce too low" from the RPC maps to "Another transaction is still going through. Try again in a moment."', async () => {
    answers({ status: 200, body: { challengeId: 'c-1' } })
    sendRawTransaction.mockRejectedValue(new Error('nonce too low: next nonce 8, tx nonce 7'))
    const err = await emailSender(SESSION).send(CALLS, { label: 'Donate' }).catch((e: unknown) => e)
    expect(NONCE_BUSY).toBe('Another transaction is still going through. Try again in a moment.')
    expect(explainError(err)).toBe(NONCE_BUSY)
    expect(waitForResult).not.toHaveBeenCalled()
  })
})

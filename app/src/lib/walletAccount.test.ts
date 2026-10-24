import type { Address } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WrongWalletAccount } from './errors'
import type { Call } from './sender'
import { readWalletSession, saveWalletSession, WALLET_LOCKED, walletAccountSender } from './walletAccount'

const ME = '0x00000000000000000000000000000000000000aa' as Address
const OTHER = '0x00000000000000000000000000000000000000bb' as Address
const CALLS: Call[] = [{ to: '0x00000000000000000000000000000000000000a1', data: '0x01' }]
const SUCCESS = { status: 'success', hash: `0x${'11'.repeat(32)}`, receipt: {} }

const wallet = vi.hoisted(() => {
  const metamask = { id: 'io.metamask' }
  return {
    metamask,
    config: { connectors: [{ id: 'injected' }, metamask] },
    account: { address: undefined as string | undefined },
    reconnect: vi.fn(),
    send: vi.fn(),
    senderFor: [] as string[],
  }
})
vi.mock('../wagmi', () => ({ wagmiConfig: wallet.config }))
vi.mock('@wagmi/core', () => ({ reconnect: wallet.reconnect, getAccount: () => wallet.account }))
vi.mock('./wagmiSender', () => ({
  wagmiSender: (_config: unknown, address: Address) => {
    wallet.senderFor.push(address)
    return { kind: 'wallet', address, send: wallet.send }
  },
}))

beforeEach(() => {
  wallet.reconnect.mockReset()
  wallet.account = { address: undefined }
  wallet.senderFor = []
  wallet.send.mockResolvedValue(SUCCESS)
})
afterEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('walletAccountSender', () => {
  // After a reload the wallet account shows at once from its store, but wagmi is not connected yet. The first
  // send reconnects the wallet the person signed in with.
  it('send reconnects with the stored connector then sends through wagmiSender', async () => {
    saveWalletSession({ address: ME, connectorId: 'io.metamask' })
    wallet.reconnect.mockImplementation(async () => {
      wallet.account = { address: ME }
    })
    const opts = { label: 'Give' }
    const res = await walletAccountSender({ address: ME, connectorId: 'io.metamask' }).send(CALLS, opts)
    expect(wallet.reconnect).toHaveBeenCalledWith(wallet.config, { connectors: [wallet.metamask] })
    expect(wallet.senderFor).toEqual([ME])
    expect(wallet.send).toHaveBeenCalledWith(CALLS, opts)
    expect(res).toBe(SUCCESS)
  })

  // The person picked another account inside the wallet while away. Fundit must never send from it, and the
  // session ends so they sign in again with the account they want.
  // The message must not ask them to switch back: the session is already gone, so only signing in again helps.
  it('a reconnect to another address signs the wallet session out and says to sign in again', async () => {
    saveWalletSession({ address: ME, connectorId: 'io.metamask' })
    wallet.reconnect.mockImplementation(async () => {
      wallet.account = { address: OTHER }
    })
    const err = await walletAccountSender({ address: ME, connectorId: 'io.metamask' }).send(CALLS).catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(WrongWalletAccount)
    expect((err as Error).message).toBe('Your wallet changed to a different account, so you were signed out. Sign in again.')
    expect(wallet.send).not.toHaveBeenCalled()
    expect(readWalletSession()).toBeNull()
  })

  // A locked wallet answers with no account. That is not another person's account, so the session stays.
  it('a reconnect with no account sends nothing and keeps the session', async () => {
    saveWalletSession({ address: ME, connectorId: 'io.metamask' })
    await expect(walletAccountSender({ address: ME, connectorId: 'io.metamask' }).send(CALLS)).rejects.toThrow(WALLET_LOCKED)
    expect(wallet.send).not.toHaveBeenCalled()
    expect(readWalletSession()).toEqual({ address: ME, connectorId: 'io.metamask' })
  })

  it('does not reconnect while the same account is already connected', async () => {
    wallet.account = { address: ME }
    await walletAccountSender({ address: ME, connectorId: 'io.metamask' }).send(CALLS)
    expect(wallet.reconnect).not.toHaveBeenCalled()
    expect(wallet.send).toHaveBeenCalledTimes(1)
  })
})

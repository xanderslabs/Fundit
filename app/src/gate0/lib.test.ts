import { toCircleSmartAccount } from '@circle-fin/modular-wallets-core'
import { createPublicClient, custom, decodeFunctionData, parseAbi } from 'viem'
import { toWebAuthnAccount } from 'viem/account-abstraction'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { describe, expect, it } from 'vitest'
import { emailPaths, factoryArgs, maskEmails, publicKeyXY, sanitize, serializeError, toJson, usdcNeeded } from './lib'

const createAccountAbi = parseAbi(['function createAccount(bytes32 sender, bytes32 salt, bytes initializingData)'])
// Offline: a client without Circle's transport makes the SDK skip circle_getAddress, and every account reads as not
// deployed.
const client = createPublicClient({ chain: arcTestnet, transport: custom({ request: async ({ method }) => (method === 'eth_getCode' ? '0x' : null) }) })

async function sdkFactoryArgs(owner: unknown) {
  type Params = Parameters<typeof toCircleSmartAccount>[0]
  const account = await toCircleSmartAccount({ client: client as unknown as Params['client'], owner: owner as Params['owner'] })
  const { factoryData } = await account.getFactoryArgs()
  return decodeFunctionData({ abi: createAccountAbi, data: factoryData! }).args
}

// G1 compares the factory's getAddress on Arc with the SDK's address. That compare only means something when the
// page asks the factory with exactly the arguments the SDK deploys the account with.
describe('factoryArgs matches what the Circle SDK deploys with', () => {
  it('for an EOA owner', async () => {
    const eoa = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
    expect(factoryArgs({ kind: 'eoa', address: eoa.address })).toEqual(await sdkFactoryArgs(eoa))
  })

  it('for a passkey owner', async () => {
    const publicKey = `0x04${'11'.repeat(32)}${'22'.repeat(32)}` as const
    const passkey = toWebAuthnAccount({ credential: { id: 'gate0', publicKey } })
    expect(factoryArgs({ kind: 'passkey', ...publicKeyXY(publicKey) })).toEqual(await sdkFactoryArgs(passkey))
  })
})

// The results are pasted back into chat and the research file, so nothing secret or personal may be in them.
describe('sanitize', () => {
  it('redacts secret keys and JWTs and masks emails', () => {
    const out = toJson({ sessionToken: 'abc', privateKey: '0x01', user: { email: 'jane.doe@example.com' }, jwt: 'x', note: 'eyJa.eyJb.sig' })
    expect(out).not.toMatch(/abc|jane\.doe|eyJa/)
    expect(out).toContain('j***@example.com')
    expect(out).toContain('[redacted]')
  })

  it('writes bigints as strings and survives cycles', () => {
    const a: Record<string, unknown> = { n: 5n }
    a.self = a
    expect(sanitize(a)).toEqual({ n: '5', self: '[cycle]' })
  })

  it('masks every email in free text', () => {
    expect(maskEmails('sent to a@b.io and bob@x.org')).toBe('sent to a***@b.io and b***@x.org')
  })
})

// G10 needs the raw error objects, cause chain included, to build explainError later.
describe('serializeError', () => {
  it('keeps name, code, message, extra fields and the full cause chain', () => {
    const root = Object.assign(new Error('Cannot find target wallet'), { code: -32602, data: { reason: 'x' } })
    const mid = new Error('Failed to register', { cause: root })
    mid.name = 'RpcRequestError'
    const top = Object.assign(new Error('outer', { cause: mid }), { shortMessage: 'short', status: 400 })
    const out = serializeError(top) as Record<string, unknown>
    expect(out).toMatchObject({ name: 'Error', message: 'outer', shortMessage: 'short', status: 400 })
    expect(out.cause).toMatchObject({ name: 'RpcRequestError', message: 'Failed to register', cause: { code: -32602, message: 'Cannot find target wallet', data: { reason: 'x' } } })
  })

  it('serializes thrown non-errors as they are', () => {
    expect(serializeError({ code: 4001, message: 'User rejected' })).toEqual({ code: 4001, message: 'User rejected' })
  })
})

describe('emailPaths', () => {
  it('finds where the email sits in the account info', () => {
    expect(emailPaths({ embeddedWalletInfo: { user: { email: 'a@b.io', username: 'x' }, authProvider: 'email' } })).toEqual(['embeddedWalletInfo.user.email'])
  })
})

describe('usdcNeeded', () => {
  const gas = { newAccount: 1_600_000n, deployed: 450_000n }
  it('covers the deploying operation first, then each next one, rounded up to 0.1 USDC', () => {
    // 1.6M gas at 700 gwei with a 30% margin is 1.456 USDC.
    expect(usdcNeeded(700_000_000_000n, false, 1, gas)).toBe(1_500_000n)
    // Plus three more at 450k: 1.456 + 3 * 0.4095 = 2.6845.
    expect(usdcNeeded(700_000_000_000n, false, 4, gas)).toBe(2_700_000n)
    expect(usdcNeeded(700_000_000_000n, true, 1, gas)).toBe(500_000n)
  })
})

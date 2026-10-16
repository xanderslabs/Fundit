import type { Address } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { type NameClient, resolveName } from './names'

const WHO = '0x1111111111111111111111111111111111111111' as Address
const BASE_COIN_TYPE = 2147492101n // toCoinType(8453)

function fakeL1(opts: { ens?: string | null | Error; basename?: string | null | Error; avatar?: string | null | Error }) {
  const answer = <T,>(v: T | Error | undefined) => (v instanceof Error ? Promise.reject(v) : Promise.resolve(v ?? null))
  const getEnsName = vi.fn(({ coinType }: { address: Address; coinType?: bigint }) =>
    coinType === BASE_COIN_TYPE ? answer(opts.basename) : answer(opts.ens),
  )
  const getEnsAvatar = vi.fn((_: { name: string }) => answer(opts.avatar))
  return { client: { getEnsName, getEnsAvatar } as unknown as NameClient, getEnsName, getEnsAvatar }
}

describe('resolveName', () => {
  // People recognise an ENS name before a Basename, so ENS wins when both exist.
  it('prefers the ENS name over the Basename', async () => {
    const { client } = fakeL1({ ens: 'alice.eth', basename: 'alice.base.eth', avatar: 'https://euc.li/alice.eth' })
    expect(await resolveName(client, WHO)).toEqual({ name: 'alice.eth', avatar: 'https://euc.li/alice.eth', source: 'ens' })
  })

  it('falls back to the Basename, looked up with the Base coin type', async () => {
    const { client, getEnsName } = fakeL1({ ens: new Error('gateway down'), basename: 'bob.base.eth' })
    expect(await resolveName(client, WHO)).toEqual({ name: 'bob.base.eth', avatar: null, source: 'basename' })
    expect(getEnsName).toHaveBeenCalledWith({ address: WHO, coinType: BASE_COIN_TYPE })
  })

  // A broken resolver must never break the page that shows the address.
  it('returns all null when both lookups throw', async () => {
    const { client, getEnsAvatar } = fakeL1({ ens: new Error('a'), basename: new Error('b') })
    expect(await resolveName(client, WHO)).toEqual({ name: null, avatar: null, source: null })
    expect(getEnsAvatar).not.toHaveBeenCalled()
  })

  // The avatar record is set by the name owner, so only a plain https URL may reach an img src.
  it('drops an avatar that is not an https URL', async () => {
    const { client } = fakeL1({ ens: 'eve.eth', avatar: 'javascript:alert(1)' })
    expect(await resolveName(client, WHO)).toEqual({ name: 'eve.eth', avatar: null, source: 'ens' })
  })
})

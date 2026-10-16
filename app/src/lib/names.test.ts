import { type Address, namehash } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BASENAME_RESOLVER, L2_REVERSE_REGISTRAR } from '../config'
import { type NameClients, resolveName } from './names'

const WHO = '0x1111111111111111111111111111111111111111' as Address
const OTHER = '0x2222222222222222222222222222222222222222' as Address

type Answer<T> = T | Error | undefined

function answer<T>(v: Answer<T>, empty: T) {
  return v instanceof Error ? Promise.reject(v) : Promise.resolve(v ?? empty)
}

// A fake mainnet client for ENS and a fake Base client for Basenames.
function fakeClients(opts: {
  ens?: Answer<string | null>
  ensAvatar?: Answer<string | null>
  basename?: Answer<string>
  basenameAddr?: Answer<Address>
  basenameAvatar?: Answer<string>
}) {
  const getEnsName = vi.fn((_: { address: Address }) => answer(opts.ens, null))
  const getEnsText = vi.fn((_: { name: string; key: string }) => answer(opts.ensAvatar, null))
  const readContract = vi.fn(({ address, functionName, args }: { address: Address; functionName: string; args: readonly unknown[] }) => {
    if (address === L2_REVERSE_REGISTRAR && functionName === 'nameForAddr') return answer(opts.basename, '')
    if (address === BASENAME_RESOLVER && functionName === 'addr') return answer(opts.basenameAddr, '0x0000000000000000000000000000000000000000')
    if (address === BASENAME_RESOLVER && functionName === 'text' && args[1] === 'avatar') return answer(opts.basenameAvatar, '')
    return Promise.reject(new Error(`unexpected ${functionName} on ${address}`))
  })
  const clients = { l1: { getEnsName, getEnsText }, base: { readContract } } as unknown as NameClients
  return { clients, getEnsName, getEnsText, readContract }
}

const fetchSpy = vi.spyOn(globalThis, 'fetch')
afterEach(() => fetchSpy.mockClear())

describe('resolveName', () => {
  // People recognise an ENS name before a Basename, so ENS wins and Base is not even asked.
  it('uses the ENS name first', async () => {
    const { clients, readContract } = fakeClients({ ens: 'alice.eth', ensAvatar: 'https://euc.li/alice.eth', basename: 'alice.base.eth' })
    expect(await resolveName(clients, WHO)).toEqual({ name: 'alice.eth', avatar: 'https://euc.li/alice.eth', source: 'ens' })
    expect(readContract).not.toHaveBeenCalled()
  })

  it('uses the Basename from Base when it resolves back to the address', async () => {
    const { clients, readContract } = fakeClients({
      ens: new Error('no reverse record'),
      basename: 'bob.base.eth',
      basenameAddr: WHO,
      basenameAvatar: 'https://example.com/bob.png',
    })
    expect(await resolveName(clients, WHO)).toEqual({ name: 'bob.base.eth', avatar: 'https://example.com/bob.png', source: 'basename' })
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'addr', args: [namehash('bob.base.eth')] }))
  })

  // Anyone can set their reverse record to any name, for example a famous one. Without the forward check
  // a stranger could show up on Fundit as jesse.base.eth.
  it('ignores a Basename that does not resolve back to the address', async () => {
    const { clients } = fakeClients({ basename: 'jesse.base.eth', basenameAddr: OTHER, basenameAvatar: 'https://example.com/j.png' })
    expect(await resolveName(clients, WHO)).toEqual({ name: null, avatar: null, source: null })
  })

  // A broken resolver must never break the page that shows the address.
  it('returns all null when every lookup throws', async () => {
    const { clients } = fakeClients({ ens: new Error('a'), basename: new Error('b') })
    expect(await resolveName(clients, WHO)).toEqual({ name: null, avatar: null, source: null })
  })

  // The avatar record is set by the name owner. Only a plain https URL may reach our img tag; ipfs, NFT,
  // ar and data records are not turned into gateway URLs or probed, they just show no avatar.
  it.each(['ipfs://QmSomething', 'eip155:1/erc721:0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB/1', 'ar://abc', 'data:image/png;base64,AAAA', 'javascript:alert(1)'])(
    'shows no avatar for %s',
    async (record) => {
      const { clients } = fakeClients({ ens: 'eve.eth', ensAvatar: record })
      expect(await resolveName(clients, WHO)).toEqual({ name: 'eve.eth', avatar: null, source: 'ens' })
    },
  )

  it('reads the raw avatar text record and makes no fetch of its own', async () => {
    const { clients, getEnsText } = fakeClients({ ens: 'alice.eth', ensAvatar: 'https://euc.li/alice.eth' })
    await resolveName(clients, WHO)
    expect(getEnsText).toHaveBeenCalledWith({ name: 'alice.eth', key: 'avatar' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

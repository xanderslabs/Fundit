import type { Address } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { TOKENS } from '../config'
import {
  type CampaignView,
  fetchCampaign,
  fetchCampaignPage,
  fetchFeatured,
  myCampaigns,
  isTestFundit,
  publicFundits,
  type ReadClient,
  type Summary,
  uniqueByAddress,
} from './campaigns'

// One test account, written in lower case as in config.ts.
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  TEST_CREATORS: ['0x2222222222222222222222222222222222222222'],
}))

const A = '0x00000000000000000000000000000000000000a1' as Address
const B = '0x00000000000000000000000000000000000000b2' as Address
const C = '0x00000000000000000000000000000000000000c3' as Address
const ZERO = '0x0000000000000000000000000000000000000000' as Address

function summary(title: string, token: Address = TOKENS.USDC.address): Summary {
  return {
    creator: '0x1111111111111111111111111111111111111111',
    token,
    goal: 1000000000n,
    raised: 0n,
    available: 0n,
    withdrawn: 0n,
    closed: false,
    donationFeeBps: 0,
    withdrawFeeBps: 250,
    createdAt: 0n,
    createdAtBlock: 1n,
    backup: ZERO,
    recoveryReadyAt: 0n,
    meta: { title, description: '', imageUrl: '', links: [] },
  }
}

// A fake Arc client: the factory stores campaigns oldest first, like CampaignFactory.campaigns.
function fakeClient(opts: { campaigns: Address[]; summaries: Record<string, Summary>; featured?: Address; real?: Address[] }) {
  const real = new Set((opts.real ?? opts.campaigns).map((a) => a.toLowerCase()))
  const client = {
    async readContract({ address, functionName, args }: { address: Address; functionName: string; args?: readonly unknown[] }) {
      if (functionName === 'campaignCount') return BigInt(opts.campaigns.length)
      if (functionName === 'getCampaigns') {
        const [offset, limit] = args as [bigint, bigint]
        return opts.campaigns.slice(Number(offset), Number(offset + limit))
      }
      if (functionName === 'isCampaign') return real.has((args![0] as string).toLowerCase())
      if (functionName === 'featuredCampaign') return opts.featured ?? ZERO
      // Reading summary before isCampaign would trust a hostile clone, so the fake refuses it.
      if (functionName === 'summary') {
        if (!real.has(address.toLowerCase())) throw new Error(`summary read on non-campaign ${address}`)
        return opts.summaries[address]
      }
      throw new Error(`unexpected ${functionName}`)
    },
    async multicall({ contracts }: { contracts: readonly { address: Address; functionName: string }[] }) {
      return contracts.map((c) => {
        if (c.functionName !== 'summary') throw new Error(`unexpected ${c.functionName}`)
        return opts.summaries[c.address]
      })
    },
  }
  return client as unknown as ReadClient
}

describe('fetchCampaignPage', () => {
  const client = fakeClient({
    campaigns: [A, B, C],
    summaries: { [A]: summary('first'), [B]: summary('second', TOKENS.EURC.address), [C]: summary('third') },
  })

  it('returns campaigns newest first with the token symbol', async () => {
    const page = await fetchCampaignPage(client, 0n, 10n)
    expect(page.map((v) => v.summary.meta.title)).toEqual(['third', 'second', 'first'])
    expect(page.map((v) => v.address)).toEqual([C, B, A])
    expect(page[1]!.symbol).toBe('EURC')
    expect(page[0]!.symbol).toBe('USDC')
  })

  it('pages from the newest end', async () => {
    expect((await fetchCampaignPage(client, 0n, 2n)).map((v) => v.address)).toEqual([C, B])
    expect((await fetchCampaignPage(client, 2n, 2n)).map((v) => v.address)).toEqual([A])
    expect(await fetchCampaignPage(client, 3n, 2n)).toEqual([])
  })

  it('returns nothing when the factory has no campaigns', async () => {
    expect(await fetchCampaignPage(fakeClient({ campaigns: [], summaries: {} }), 0n, 10n)).toEqual([])
  })

  it('returns nothing for a limit of zero or less', async () => {
    expect(await fetchCampaignPage(client, 0n, 0n)).toEqual([])
    expect(await fetchCampaignPage(client, 0n, -1n)).toEqual([])
  })
})

describe('fetchCampaign', () => {
  // Anyone can clone the campaign implementation, so an address the factory does not know is never trusted.
  it("returns 'not-a-campaign' when isCampaign is false", async () => {
    const client = fakeClient({ campaigns: [A], summaries: { [B]: summary('fake') }, real: [A] })
    expect(await fetchCampaign(client, B)).toBe('not-a-campaign')
  })

  it('returns the view for a factory campaign', async () => {
    const client = fakeClient({ campaigns: [A], summaries: { [A]: summary('real') } })
    const view = await fetchCampaign(client, A)
    expect(view).not.toBe('not-a-campaign')
    if (view !== 'not-a-campaign') expect(view.summary.meta.title).toBe('real')
  })
})

describe('fetchFeatured', () => {
  it('returns null when nothing is featured', async () => {
    expect(await fetchFeatured(fakeClient({ campaigns: [A], summaries: {} }))).toBeNull()
  })

  it('returns the featured campaign', async () => {
    const client = fakeClient({ campaigns: [A], summaries: { [A]: summary('star') }, featured: A })
    expect((await fetchFeatured(client))?.summary.meta.title).toBe('star')
  })

  it('ignores a featured address the factory does not know', async () => {
    const client = fakeClient({ campaigns: [A], summaries: { [B]: summary('x') }, featured: B, real: [A] })
    expect(await fetchFeatured(client)).toBeNull()
  })
})

describe('uniqueByAddress', () => {
  // A campaign created between two page loads shifts every page by one, so the same campaign can
  // arrive twice. Showing it twice would also break React keys.
  it('keeps the first copy of each address, case-insensitively', () => {
    const v = (address: Address, title: string): CampaignView => ({ address, summary: summary(title), symbol: 'USDC' })
    const upper = A.toUpperCase().replace('0X', '0x') as Address
    const out = uniqueByAddress([v(C, 'c'), v(B, 'b'), v(B, 'b again'), v(A, 'a'), v(upper, 'a again')])
    expect(out.map((x) => x.summary.meta.title)).toEqual(['c', 'b', 'a'])
  })
})

describe('myCampaigns', () => {
  const ME = '0x1111111111111111111111111111111111111111' as Address
  const NEW_OWNER = '0x9999999999999999999999999999999999999999' as Address

  // campaignsOf keeps every campaign the address ever created. A backup may have taken one over since,
  // and the old creator must not see it as theirs.
  it('removes duplicates and drops campaigns whose creator changed', async () => {
    const summaries: Record<string, Summary> = { [A]: summary('mine'), [B]: { ...summary('taken over'), creator: NEW_OWNER } }
    const client = {
      async readContract({ functionName }: { functionName: string }) {
        if (functionName === 'campaignsOf') return [A, B, A]
        throw new Error(`unexpected ${functionName}`)
      },
      async multicall({ contracts }: { contracts: readonly { address: Address; functionName: string }[] }) {
        return contracts.map((c) => summaries[c.address])
      },
    } as unknown as ReadClient
    const mine = await myCampaigns(client, ME)
    expect(mine.map((v) => v.address)).toEqual([A])
  })
})

// Fundits made by test accounts would read as real fundraisers on a public list. They stay reachable by link.
describe('test data on public lists', () => {
  const TESTER = '0x2222222222222222222222222222222222222222' as Address
  const view = (address: Address, creator: Address): CampaignView => ({ address, summary: { ...summary('x'), creator }, symbol: 'USDC' })

  it('leaves out Fundits whose creator is a test account, in any letter case, and keeps the order', () => {
    const real1 = view(A, '0x1111111111111111111111111111111111111111')
    const test = view(B, '0x2222222222222222222222222222222222222222')
    const testMixed = view(C, '0x2222222222222222222222222222222222222222'.toUpperCase().replace('0X', '0x') as Address)
    const real2 = view(ZERO, '0x3333333333333333333333333333333333333333')
    expect(publicFundits([real1, test, testMixed, real2])).toEqual([real1, real2])
    expect(isTestFundit(test)).toBe(true)
    expect(isTestFundit(testMixed)).toBe(true)
    expect(isTestFundit(real1)).toBe(false)
  })

  it('still reads a test Fundit by its address, so a direct link works', async () => {
    const client = fakeClient({ campaigns: [A], summaries: { [A]: { ...summary('test'), creator: TESTER } } })
    const got = await fetchCampaign(client, A)
    expect(got).not.toBe('not-a-campaign')
    expect((got as CampaignView).summary.creator).toBe(TESTER)
  })
})

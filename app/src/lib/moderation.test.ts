import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { TOKENS } from '../config'
import { type CampaignView, featuredFirst, publicFundits } from './campaigns'
import { EMPTY_MODERATION, moderationFor, parseModeration } from './moderation'

const A = '0x00000000000000000000000000000000000000a1' as Address
const B = '0x00000000000000000000000000000000000000b2' as Address
const C = '0x00000000000000000000000000000000000000c3' as Address
const D = '0x00000000000000000000000000000000000000d4' as Address

function view(address: Address): CampaignView {
  return {
    address,
    symbol: 'USDC',
    summary: {
      creator: '0x1111111111111111111111111111111111111111',
      token: TOKENS.USDC.address,
      goal: 1000000000n,
      raised: 0n,
      available: 0n,
      withdrawn: 0n,
      closed: false,
      donationFeeBps: 0,
      withdrawFeeBps: 250,
      createdAt: 0n,
      createdAtBlock: 1n,
      backup: '0x0000000000000000000000000000000000000000',
      recoveryReadyAt: 0n,
      meta: { title: 't', description: '', imageUrl: '', links: [] },
    },
  }
}

const mod = parseModeration({ review: [B], removed: [C] })

describe('moderation', () => {
  it('matches a mixed-case address against a lowercase entry', () => {
    const m = parseModeration({ review: ['0x00000000000000000000000000000000000000ab'], removed: [] })
    expect(moderationFor(m, '0x00000000000000000000000000000000000000AB')).toBe('review')
  })

  it('reports removed, review and normal', () => {
    expect(moderationFor(mod, B)).toBe('review')
    expect(moderationFor(mod, C)).toBe('removed')
    expect(moderationFor(mod, A)).toBe('normal')
  })

  it('treats junk as empty', () => {
    for (const body of [null, 'x', { review: 'no' }, { review: [1], removed: null }, { removed: [] }]) {
      expect(parseModeration(body)).toEqual(EMPTY_MODERATION)
    }
  })

  it('drops entries that are not addresses and keeps the good ones', () => {
    const m = parseModeration({ review: ['nope', B], removed: [] })
    expect([...m.review]).toEqual([B.toLowerCase()])
  })

  it('publicFundits drops review and removed, keeps normal', () => {
    expect(publicFundits([view(A), view(B), view(C), view(D)], mod)).toEqual([view(A), view(D)])
  })

  it('featuredFirst never puts a flagged Fundit first', () => {
    const list = [view(A), view(D)]
    expect(featuredFirst(list, view(B), mod)).toEqual(list)
    expect(featuredFirst(list, view(C), mod)).toEqual(list)
    expect(featuredFirst(list, view(D), mod).map((v) => v.address)).toEqual([D, A])
  })
})

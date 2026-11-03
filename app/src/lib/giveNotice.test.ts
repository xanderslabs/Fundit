import { afterEach, describe, expect, it, vi } from 'vitest'
import { GIVE_NOTICE_VERSION, markNoticeSeen, needsFullNotice } from './giveNotice'

const ME = '0xAbCdEf0000000000000000000000000000000001'
const normal = { network: 'testnet', sender: ME, moderation: 'normal' } as const

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('giveNotice', () => {
  it('needs the full notice the first time', () => {
    expect(needsFullNotice(normal)).toBe(true)
  })

  it('does not after markNoticeSeen for the same network and sender', () => {
    markNoticeSeen('testnet', ME)
    expect(needsFullNotice(normal)).toBe(false)
    expect(needsFullNotice({ ...normal, sender: ME.toLowerCase() })).toBe(false)
    expect(localStorage.getItem(`fundit:giveNotice:testnet:${ME.toLowerCase()}`)).toBe(String(GIVE_NOTICE_VERSION))
  })

  it('needs it again on another network, for another sender, and for an older stored version', () => {
    markNoticeSeen('testnet', ME)
    expect(needsFullNotice({ ...normal, network: 'mainnet' })).toBe(true)
    expect(needsFullNotice({ ...normal, sender: '0x0000000000000000000000000000000000000002' })).toBe(true)
    localStorage.setItem(`fundit:giveNotice:testnet:${ME.toLowerCase()}`, String(GIVE_NOTICE_VERSION - 1))
    expect(needsFullNotice(normal)).toBe(true)
  })

  it('always needs it for a Fundit under review', () => {
    markNoticeSeen('testnet', ME)
    expect(needsFullNotice({ ...normal, moderation: 'review' })).toBe(true)
  })

  it('needs it when localStorage throws', () => {
    markNoticeSeen('testnet', ME)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(needsFullNotice(normal)).toBe(true)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => markNoticeSeen('testnet', ME)).not.toThrow()
  })
})

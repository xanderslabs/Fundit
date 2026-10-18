import { zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { TOKENS } from '../config'
import { ADDRESS_TYPO, type CampaignInput, parseTypedAddress, validateCampaign } from './validate'

const SENDER = '0x1111111111111111111111111111111111111111'
const OTHER = '0x2222222222222222222222222222222222222222'
// The same address with valid EIP-55 case, with one letter's case flipped, and with no checksum at all.
const CHECKSUMMED = '0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD'
const BAD_CHECKSUM = '0xaBcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD'
const LOWER = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'

describe('parseTypedAddress', () => {
  // Mixed case is a checksum. When it does not match, a character was most likely mistyped, and money sent
  // there is lost. One case throughout carries no checksum, so there is nothing to check.
  it('refuses a mixed-case address with a bad checksum as a typo', () => {
    expect(parseTypedAddress(BAD_CHECKSUM)).toEqual({ ok: false, error: 'typo' })
    expect(ADDRESS_TYPO).toBe('This address has a typo. Check it and paste it again.')
  })

  it('accepts all-lowercase, all-uppercase and checksummed addresses, as the checksummed form', () => {
    expect(parseTypedAddress(LOWER)).toEqual({ ok: true, address: CHECKSUMMED })
    expect(parseTypedAddress(`0x${LOWER.slice(2).toUpperCase()}`)).toEqual({ ok: true, address: CHECKSUMMED })
    expect(parseTypedAddress(CHECKSUMMED)).toEqual({ ok: true, address: CHECKSUMMED })
  })

  it('refuses text that is not an address', () => {
    expect(parseTypedAddress('not an address')).toEqual({ ok: false, error: 'invalid' })
    expect(parseTypedAddress('0x1234')).toEqual({ ok: false, error: 'invalid' })
  })
})

function input(over: Partial<CampaignInput> = {}): CampaignInput {
  return {
    title: 'Clean water',
    description: 'Wells for the village.',
    imageUrl: '',
    links: [],
    goal: '1000',
    token: 'USDC',
    backup: '',
    sender: SENDER,
    ...over,
  }
}

function errorsOf(over: Partial<CampaignInput>) {
  const res = validateCampaign(input(over))
  return res.ok ? {} : res.errors
}

describe('validateCampaign', () => {
  it('accepts a valid campaign and builds the createCampaign arguments', () => {
    const res = validateCampaign(input({ token: 'EURC', links: ['https://example.com'] }))
    expect(res).toEqual({
      ok: true,
      meta: { title: 'Clean water', description: 'Wells for the village.', imageUrl: '', links: ['https://example.com'] },
      goal: 1_000_000_000n,
      token: TOKENS.EURC.address,
      backup: zeroAddress,
    })
  })

  // MetadataLib counts UTF-8 bytes. Counting characters would let a title through that the contract reverts.
  it('limits the title to 100 bytes, not 100 characters', () => {
    expect(errorsOf({ title: 'a'.repeat(101) }).title).toBeDefined()
    expect(errorsOf({ title: 'a'.repeat(100) }).title).toBeUndefined()
    // Each emoji is 4 bytes but 2 UTF-16 units: 25 fit exactly, 26 (52 characters) do not.
    expect(errorsOf({ title: '😀'.repeat(25) }).title).toBeUndefined()
    expect(errorsOf({ title: '😀'.repeat(26) }).title).toBeDefined()
    expect(errorsOf({ title: '' }).title).toBeDefined()
  })

  it('limits the description to 5000 bytes', () => {
    expect(errorsOf({ description: 'é'.repeat(2500) }).description).toBeUndefined()
    expect(errorsOf({ description: 'é'.repeat(2501) }).description).toBeDefined()
  })

  it('accepts an empty image or an https one up to 500 bytes', () => {
    expect(errorsOf({ imageUrl: '' }).imageUrl).toBeUndefined()
    expect(errorsOf({ imageUrl: 'https://img.example/a.png' }).imageUrl).toBeUndefined()
    expect(errorsOf({ imageUrl: 'http://img.example/a.png' }).imageUrl).toBeDefined()
    expect(errorsOf({ imageUrl: `https://img.example/${'a'.repeat(481)}` }).imageUrl).toBeDefined()
  })

  // The contract reverts on an empty link, so blank rows from the form must not reach it.
  it('drops blank link rows and rejects non-https links', () => {
    const res = validateCampaign(input({ links: ['', 'https://a.example', '   '] }))
    expect(res.ok && res.meta.links).toEqual(['https://a.example'])
    expect(errorsOf({ links: ['http://x'] })['link-0']).toBeDefined()
    expect(errorsOf({ links: ['https://ok.example', 'http://x'] })['link-1']).toBeDefined()
  })

  it('limits links to 5, each 8 to 200 bytes', () => {
    const six = Array.from({ length: 6 }, (_, i) => `https://l${i}.example`)
    expect(errorsOf({ links: six }).links).toBeDefined()
    expect(errorsOf({ links: [`https://${'a'.repeat(192)}`] })['link-0']).toBeUndefined()
    expect(errorsOf({ links: [`https://${'a'.repeat(193)}`] })['link-0']).toBeDefined()
  })

  it('needs a goal above 0 in plain digits', () => {
    expect(errorsOf({ goal: '0' }).goal).toBeDefined()
    expect(errorsOf({ goal: '1e3' }).goal).toBeDefined()
    expect(errorsOf({ goal: '' }).goal).toBeDefined()
  })

  // createCampaign reverts InvalidBackup when the backup is the creator, and a backup you also hold protects nothing.
  it('rejects a backup equal to the sender, in any letter case', () => {
    expect(errorsOf({ backup: SENDER }).backup).toBeDefined()
    expect(errorsOf({ backup: SENDER.toUpperCase().replace('0X', '0x') }).backup).toBeDefined()
    expect(errorsOf({ backup: 'not an address' }).backup).toBeDefined()
    const res = validateCampaign(input({ backup: OTHER }))
    expect(res.ok && res.backup).toBe(OTHER)
  })

  // Recovery goes to the backup, so a mistyped backup could take the Fundit away from its organiser.
  it('refuses a backup with a bad checksum', () => {
    expect(errorsOf({ backup: BAD_CHECKSUM }).backup).toBe(ADDRESS_TYPO)
    const res = validateCampaign(input({ backup: LOWER }))
    expect(res.ok && res.backup).toBe(CHECKSUMMED)
  })
})

import { describe, expect, it } from 'vitest'
import { markAnonymous, messageLimit, readMessage } from './anon'

describe('anon', () => {
  it('marks a message with the ASCII prefix', () => {
    expect(markAnonymous('hi')).toBe('[anon]hi')
  })

  it('reads the marker back, with or without text', () => {
    expect(readMessage('[anon]hi')).toEqual({ anonymous: true, text: 'hi' })
    expect(readMessage('hi')).toEqual({ anonymous: false, text: 'hi' })
    expect(readMessage('[anon]')).toEqual({ anonymous: true, text: '' })
  })

  // The marker costs 6 of the contract's 280 bytes, so the form must leave room for it.
  it('shrinks the message limit by the marker size when anonymous', () => {
    expect(messageLimit(true)).toBe(274)
    expect(messageLimit(false)).toBe(280)
  })
})

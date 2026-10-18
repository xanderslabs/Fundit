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

  // A donor who ticks the box and also types the marker must not end up with a visible "[anon]" in the text.
  it('does not add a second marker when the message already starts with one', () => {
    expect(markAnonymous('[anon]hi')).toBe('[anon]hi')
    expect(markAnonymous('[anon][anon]hi')).toBe('[anon]hi')
  })

  // Unticked but typed: the marker is the record, so the gift reads as anonymous, and no repeat of it shows.
  it('strips every leading marker on read', () => {
    expect(readMessage('[anon][anon]hi')).toEqual({ anonymous: true, text: 'hi' })
    expect(readMessage('hi [anon]')).toEqual({ anonymous: false, text: 'hi [anon]' })
  })

  // The marker costs 6 of the contract's 280 bytes, so the form must leave room for it.
  it('shrinks the message limit by the marker size when anonymous', () => {
    expect(messageLimit(true)).toBe(274)
    expect(messageLimit(false)).toBe(280)
  })
})

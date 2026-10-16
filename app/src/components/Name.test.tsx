import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedName } from '../lib/names'
import { Name } from './Name'

const WHO = '0x1111111111111111111111111111111111111111'
const state: { data: ResolvedName | undefined } = { data: undefined }
vi.mock('../hooks/useName', () => ({ useName: () => ({ data: state.data }) }))

afterEach(() => {
  cleanup()
  state.data = undefined
})

describe('Name', () => {
  it('shows the short address until a name is found', () => {
    render(<Name address={WHO} />)
    expect(screen.getByText('0x1111...1111')).toBeTruthy()
  })

  // The avatar host must not learn which page the viewer was on.
  it('shows the name and an https avatar with no referrer', () => {
    state.data = { name: 'alice.eth', avatar: 'https://euc.li/alice.eth', source: 'ens' }
    const { container } = render(<Name address={WHO} />)
    expect(screen.getByText('alice.eth')).toBeTruthy()
    const img = container.querySelector('img')!
    expect(img.getAttribute('src')).toBe('https://euc.li/alice.eth')
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer')
  })
})

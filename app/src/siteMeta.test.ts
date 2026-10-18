import { describe, expect, it } from 'vitest'
import indexHtml from '../index.html?raw'
import manifestJson from '../public/site.webmanifest?raw'

const TITLE = 'Fundit: Fundraising for everyone, everywhere'

// What search results, link previews and installed apps show before anyone opens the site.
describe('site title and description', () => {
  const doc = new DOMParser().parseFromString(indexHtml, 'text/html')
  const meta = (attr: string, key: string) => doc.querySelector(`meta[${attr}="${key}"]`)?.getAttribute('content')

  it('uses the new title everywhere and drops the old one', () => {
    expect(doc.title).toBe(TITLE)
    expect(meta('property', 'og:title')).toBe(TITLE)
    expect(meta('name', 'twitter:title')).toBe(TITLE)
    expect(JSON.parse(manifestJson).name).toBe(TITLE)
    expect(indexHtml + manifestJson).not.toMatch(/crowdfunding on Arc/i)
  })

  it('describes Fundit the same way in every place, and promises only the organiser can withdraw', () => {
    const description = meta('name', 'description')
    expect(description).toMatch(/^Raise money for anything and get gifts from anyone in the world/)
    expect(description).toMatch(/only the organiser can withdraw\.$/)
    expect(meta('property', 'og:description')).toBe(description)
    expect(meta('name', 'twitter:description')).toBe(description)
    expect(JSON.parse(manifestJson).description).toBe(description)
  })

  it('points at fundit.fun, never fundit.xyz', () => {
    expect(indexHtml).not.toMatch(/fundit\.xyz/)
    expect(meta('property', 'og:url')).toBe('https://fundit.fun/')
  })
})

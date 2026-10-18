import { describe, expect, it } from 'vitest'
import { embedSnippet, funditUrl, shareMessage, shareTargets } from './share'

const ORIGIN = 'https://fundit.fun'
const ADDRESS = '0x00000000000000000000000000000000000000a1'
const URL_ = funditUrl(ORIGIN, ADDRESS)
// Spaces, "&", "#", "?" and an emoji: each would cut or corrupt a share link if it went in unencoded.
const TITLE = 'Water & wells #2? 💧'

const VISITOR = `Help ${TITLE} reach its goal on Fundit: ${URL_}`
const CREATOR = `I started a Fundit for ${TITLE}. Every gift helps: ${URL_}`
const VISITOR_TEXT = `Help ${TITLE} reach its goal on Fundit`

function target(key: string, isCreator = false) {
  const t = shareTargets(TITLE, URL_, isCreator).find((x) => x.key === key)
  if (!t) throw new Error(`no ${key}`)
  return t.href
}

// Reads a query parameter back the way the receiving site would.
function param(href: string, name: string) {
  return new URL(href).searchParams.get(name)
}

describe('share links', () => {
  it('uses the canonical Fundit URL with no tracking parameters', () => {
    expect(URL_).toBe(`https://fundit.fun/c/${ADDRESS}`)
  })

  it('writes the visitor message for anyone who is not the organiser', () => {
    expect(shareMessage(TITLE, URL_, false)).toBe(VISITOR)
  })

  it("writes the organiser's message in their own voice", () => {
    expect(shareMessage(TITLE, URL_, true)).toBe(CREATOR)
    expect(param(target('x', true), 'text')).toBe(CREATOR)
  })

  it.each([
    ['x', 'https://x.com/intent/post', { text: VISITOR }],
    ['whatsapp', 'https://wa.me/', { text: VISITOR }],
    ['telegram', 'https://t.me/share/url', { url: URL_, text: VISITOR_TEXT }],
    ['facebook', 'https://facebook.com/sharer/sharer.php', { u: URL_ }],
    ['linkedin', 'https://linkedin.com/sharing/share-offsite/', { url: URL_ }],
    ['reddit', 'https://reddit.com/submit', { url: URL_, title: VISITOR_TEXT }],
  ] as const)('builds the %s link so the full title survives', (key, base, params) => {
    const href = target(key)
    expect(href.startsWith(`${base}?`)).toBe(true)
    const parsed = new URL(href)
    expect([...parsed.searchParams.keys()].sort()).toEqual(Object.keys(params).sort())
    for (const [name, value] of Object.entries(params)) expect(param(href, name)).toBe(value)
    // A raw "&" or "#" from the title would start a new parameter or a fragment.
    expect(parsed.hash).toBe('')
  })

  it('builds the email link with the message as subject and body', () => {
    const href = target('email')
    expect(href).toBe(`mailto:?subject=${encodeURIComponent(VISITOR_TEXT)}&body=${encodeURIComponent(VISITOR)}`)
    expect(href).not.toContain(' ')
  })

  // iOS wants "sms:&body=" and Android "sms:?body="; "sms:?&body=" works on both.
  it('builds the text message link with the separator both phones accept', () => {
    expect(target('sms')).toBe(`sms:?&body=${encodeURIComponent(VISITOR)}`)
  })

  it('offers every network the brief lists, in a stable order', () => {
    expect(shareTargets(TITLE, URL_, false).map((t) => t.name)).toEqual([
      'X',
      'WhatsApp',
      'Telegram',
      'Facebook',
      'LinkedIn',
      'Reddit',
      'Email',
      'SMS',
    ])
  })
})

describe('embed snippet', () => {
  it('points at the embed page with the agreed size and attributes', () => {
    expect(embedSnippet(ORIGIN, ADDRESS, 'Clean water')).toBe(
      `<iframe src="https://fundit.fun/embed/c/${ADDRESS}" width="360" height="220" style="border:0;border-radius:16px" title="Clean water on Fundit" loading="lazy"></iframe>`,
    )
  })

  // The organiser pastes this into their own site. A title written to break out of the attribute must stay text.
  it('escapes a title that tries to break out of the attribute', () => {
    const snippet = embedSnippet(ORIGIN, ADDRESS, `"><script>alert(1)</script>`)
    expect(snippet).not.toContain('<script>')
    expect(snippet).toContain('title="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; on Fundit"')
    const doc = new DOMParser().parseFromString(snippet, 'text/html')
    expect(doc.querySelectorAll('iframe')).toHaveLength(1)
    expect(doc.querySelector('script')).toBeNull()
    expect(doc.querySelector('iframe')!.getAttribute('title')).toBe(`"><script>alert(1)</script> on Fundit`)
  })
})

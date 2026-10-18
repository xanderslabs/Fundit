import { describe, expect, it } from 'vitest'
import headers from '../public/_headers?raw'
import redirects from '../public/_redirects?raw'
import { campaignAbi } from './abi/campaign'
import { factoryAbi } from './abi/factory'
import { ARC_RPC_FALLBACKS, ARC_RPC_URL, CCTP_CHAINS, EXTERNAL_HOSTS, FORWARD_HOOK_DATA, TOKENS } from './config'
import { connectSrcAllows } from './deployConfig'

describe('config', () => {
  it('uses the 32-byte CCTP Forwarding hook data ("cctp-forward", version 0, length 0)', () => {
    expect(FORWARD_HOOK_DATA).toBe('0x636374702d666f72776172640000000000000000000000000000000000000000')
    expect((FORWARD_HOOK_DATA.length - 2) / 2).toBe(32)
  })

  it('maps the six CCTP source chains to their Circle domains', () => {
    const byKey = Object.fromEntries(CCTP_CHAINS.map((c) => [c.key, c.domain]))
    expect(byKey).toEqual({ Ethereum: 0, Avalanche: 1, Optimism: 2, Arbitrum: 3, Base: 6, Polygon: 7 })
    expect(CCTP_CHAINS.map((c) => c.domain)).toEqual([0, 1, 2, 3, 6, 7])
  })

  it('uses the slow route on Polygon and Avalanche, where CCTP Fast is not offered', () => {
    const slow = CCTP_CHAINS.filter((c) => !c.fast).map((c) => c.key).sort()
    expect(slow).toEqual(['Avalanche', 'Polygon'])
  })

  it('uses the Arc USDC ERC-20 interface at 6 decimals, never the 18-decimal native balance', () => {
    expect(TOKENS.USDC.address).toBe('0x3600000000000000000000000000000000000000')
    expect(TOKENS.USDC.decimals).toBe(6)
    expect(TOKENS.EURC.decimals).toBe(6)
  })

  it('generates the campaign ABI from the built contracts (6-arg withdraw with hook data, summary)', () => {
    const withdraw = campaignAbi.find((x) => x.type === 'function' && x.name === 'withdraw')
    expect(withdraw && 'inputs' in withdraw ? withdraw.inputs.length : -1).toBe(6)
    expect(campaignAbi.some((x) => x.type === 'function' && x.name === 'summary')).toBe(true)
  })

  it('generates the factory ABI with createCampaign(token, goal, backup, meta)', () => {
    const create = factoryAbi.find((x) => x.type === 'function' && x.name === 'createCampaign')
    expect(create && 'inputs' in create ? create.inputs.length : -1).toBe(4)
  })
})

describe('_headers CSP', () => {
  it('has a connect-src directive', () => {
    expect(headers).toMatch(/connect-src 'self' https:/)
  })

  // A host missing here is blocked by the browser at runtime with no build or type error.
  it.each(EXTERNAL_HOSTS)('allows the app to call %s', (url) => {
    expect(connectSrcAllows(headers, url)).toBe(true)
  })

  it('refuses a host or scheme connect-src does not list', () => {
    expect(connectSrcAllows(headers, 'https://evil.example.com')).toBe(false)
    expect(connectSrcAllows(headers, 'http://rpc.mainnet.arc.io')).toBe(false)
  })
})

describe('_headers security headers', () => {
  // Without HSTS a first visit over http can be intercepted before the redirect to https.
  it('sends Strict-Transport-Security for a year, with subdomains', () => {
    expect(headers).toMatch(/^\s+Strict-Transport-Security: max-age=31536000; includeSubDomains$/m)
  })
})

// The headers of one _headers rule: the indented lines under its path line.
function rule(path: string): string[] {
  const lines = headers.split('\n')
  const start = lines.findIndex((l) => l === path)
  if (start < 0) return []
  const out: string[] = []
  for (const l of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(l)) break
    out.push(l.trim())
  }
  return out
}

describe('_headers framing', () => {
  // Every page but the embed card refuses to be framed, so no other site can overlay the Give or Withdraw buttons.
  it("keeps frame-ancestors 'none' for the whole site", () => {
    const csp = rule('/*').find((h) => h.startsWith('Content-Security-Policy:'))
    expect(csp).toMatch(/frame-ancestors 'none'$/)
  })

  // Cloudflare adds the headers of every matching rule. Without the detach line, /embed/* would get both CSPs and
  // the browser would apply the stricter one, so the card could not be framed anywhere.
  it('replaces the site CSP on /embed/* with one that any site may frame', () => {
    const embed = rule('/embed/*')
    expect(embed[0]).toBe('! Content-Security-Policy')
    const csps = embed.filter((h) => h.startsWith('Content-Security-Policy:'))
    expect(csps).toHaveLength(1)
    expect(csps[0]).toMatch(/frame-ancestors \*$/)
    expect(embed.some((h) => /x-frame-options/i.test(h))).toBe(false)
    expect(headers).not.toMatch(/X-Frame-Options/i)
  })

  // The card reads the Fundit from Arc, through the same RPCs as the app.
  it.each([ARC_RPC_URL, ...ARC_RPC_FALLBACKS])('lets the embed card call %s', (url) => {
    const embedCsp = rule('/embed/*').join('\n')
    expect(connectSrcAllows(embedCsp, url)).toBe(true)
  })

  it('serves embed.html for /embed/c/:address on Cloudflare', () => {
    expect(redirects).toMatch(/^\/embed\/\* \/embed 200$/m)
  })
})

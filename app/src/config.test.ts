import { describe, expect, it } from 'vitest'
import headers from '../public/_headers?raw'
import { campaignAbi } from './abi/campaign'
import { factoryAbi } from './abi/factory'
import { CCTP_CHAINS, EXTERNAL_HOSTS, FORWARD_HOOK_DATA, TOKENS } from './config'
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

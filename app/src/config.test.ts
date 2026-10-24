import { describe, expect, it, vi } from 'vitest'
import headers from '../public/_headers?raw'
import redirects from '../public/_redirects?raw'
import { campaignAbi } from './abi/campaign'
import { factoryAbi } from './abi/factory'
import { ARC_RPC_FALLBACKS, ARC_RPC_URL, CCTP_CHAINS, cctpChainNames, EMAIL_SIGNIN_SOURCES, EXTERNAL_HOSTS, FORWARD_HOOK_DATA, NETWORK, NETWORKS, networkHosts, networkTag, storageKey, TOKENS } from './config'
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

// Every chain-specific value comes from one NETWORK object. A wrong address here sends real or test money to
// the wrong contract, so each value is pinned to the one checked on-chain (see task-1-report.md).
describe('NETWORKS', () => {
  it('uses mainnet when VITE_ARC_NETWORK is unset', () => {
    expect(NETWORK).toBe(NETWORKS.mainnet)
  })

  it('resolves the Arc mainnet values the live contracts use', () => {
    const n = NETWORKS.mainnet
    expect(n.chain.id).toBe(5042)
    expect(n.domain).toBe(26)
    expect(n.rpcUrl).toBe('https://rpc.mainnet.arc.io')
    expect(n.explorerUrl).toBe('https://explorer.arc.io')
    expect(n.chain.blockExplorers?.default.url).toBe(n.explorerUrl)
    expect(n.usdc).toBe('0x3600000000000000000000000000000000000000')
    expect(n.eurc).toBe('0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1')
    expect(n.tokenMessengerV2).toBe('0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d')
    expect(n.irisUrl).toBe('https://iris-api.circle.com')
    expect(n.modularChainPath).toBe('/arc')
    expect(n.cctpChains.map((c) => [c.key, c.chainId, c.domain, c.usdc, c.rpcUrl])).toEqual([
      ['Ethereum', 1, 0, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'https://ethereum-rpc.publicnode.com'],
      ['Avalanche', 43114, 1, '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', 'https://api.avax.network/ext/bc/C/rpc'],
      ['Optimism', 10, 2, '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 'https://mainnet.optimism.io'],
      ['Arbitrum', 42161, 3, '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 'https://arb1.arbitrum.io/rpc'],
      ['Base', 8453, 6, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'https://mainnet.base.org'],
      ['Polygon', 137, 7, '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 'https://polygon.drpc.org'],
    ])
    expect(n.chainLabels.Arc).toBe('Arc')
    // Circle Bridge Kit chain names. On mainnet they are the same as our keys.
    expect(n.bridgeKitChain).toBe('Arc')
    expect(n.cctpChains.map((c) => c.bridgeKitChain)).toEqual(['Ethereum', 'Avalanche', 'Optimism', 'Arbitrum', 'Base', 'Polygon'])
  })

  it('resolves the Arc testnet values', () => {
    const n = NETWORKS.testnet
    expect(n.chain.id).toBe(5042002)
    expect(n.domain).toBe(26)
    expect(n.rpcUrl).toBe('https://rpc.testnet.arc.io')
    expect(n.explorerUrl).toBe('https://explorer.testnet.arc.io')
    expect(n.chain.blockExplorers?.default.url).toBe(n.explorerUrl)
    expect(n.usdc).toBe('0x3600000000000000000000000000000000000000')
    expect(n.eurc).toBe('0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a')
    expect(n.tokenMessengerV2).toBe('0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA')
    expect(n.irisUrl).toBe('https://iris-api-sandbox.circle.com')
    expect(n.modularChainPath).toBe('/arcTestnet')
    expect(n.cctpChains.map((c) => [c.key, c.chainId, c.domain, c.usdc, c.rpcUrl])).toEqual([
      ['Ethereum', 11155111, 0, '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', 'https://11155111.rpc.thirdweb.com'],
      ['Base', 84532, 6, '0x036CbD53842c5426634e7929541eC2318f3dCF7e', 'https://sepolia.base.org'],
    ])
    expect(n.chainLabels).toMatchObject({ Arc: 'Arc Testnet', Ethereum: 'Ethereum Sepolia', Base: 'Base Sepolia' })
    // Bridge Kit's Blockchain enum names for the testnets. 'Base' here would bridge on mainnet.
    expect(n.bridgeKitChain).toBe('Arc_Testnet')
    expect(n.cctpChains.map((c) => c.bridgeKitChain)).toEqual(['Ethereum_Sepolia', 'Base_Sepolia'])
  })

  // viem's arcTestnet still lists the old .arc.network hosts, which the CSP does not allow.
  it('reads testnet Arc only through .arc.io hosts', () => {
    const n = NETWORKS.testnet
    expect(n.chain.rpcUrls.default.http).toEqual(['https://rpc.testnet.arc.io'])
    expect(networkHosts(n).some((u) => u.includes('arc.network'))).toBe(false)
  })

  it.each(['mainnet', 'testnet'] as const)('lets a %s build call every host it uses', (name) => {
    for (const url of networkHosts(NETWORKS[name])) expect(connectSrcAllows(headers, url), url).toBe(true)
  })
})

// The donate panel and the FAQ name the chains people can send from. On testnet only two exist.
describe('cctpChainNames', () => {
  it('reads as before on mainnet', () => {
    expect(cctpChainNames(NETWORKS.mainnet)).toBe('Ethereum, Base, Arbitrum, OP Mainnet, Polygon or Avalanche')
  })

  it('names only the testnet chains on testnet', () => {
    expect(cctpChainNames(NETWORKS.testnet)).toBe('Ethereum Sepolia or Base Sepolia')
  })
})

// The values every module imports are derived once from VITE_ARC_NETWORK. This proves the env switch reaches them.
describe('VITE_ARC_NETWORK=testnet', () => {
  it('switches every derived export to testnet', async () => {
    vi.stubEnv('VITE_ARC_NETWORK', 'testnet')
    vi.resetModules()
    try {
      const c = await import('./config')
      expect(c.NETWORK.name).toBe('testnet')
      expect(c.ARC_CHAIN_ID).toBe(5042002)
      expect(c.ARC_RPC_URL).toBe('https://rpc.testnet.arc.io')
      expect(c.EXPLORER_URL).toBe('https://explorer.testnet.arc.io')
      expect(c.IRIS_URL).toBe('https://iris-api-sandbox.circle.com')
      expect(c.TOKENS.EURC.address).toBe('0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a')
      expect(c.TOKEN_MESSENGER_V2).toBe('0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA')
      expect(c.CCTP_CHAINS).toHaveLength(2)
      expect(c.CHAIN_NAMES).toBe('Ethereum Sepolia or Base Sepolia')
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})

// localStorage is per origin, and one dev origin can be rebuilt for either network. Mainnet keys must keep their
// names, or live users would lose their session and pending records. Testnet keys must never equal a mainnet key.
describe('storageKey', () => {
  const names = ['passkey', 'backup.', 'backup.pending.', 'recovery.pending.', 'recovery.tried.', 'pendingBridges']

  it('keeps the original mainnet key names', () => {
    expect(names.map((n) => storageKey(n, 'mainnet'))).toEqual([
      'fundit.passkey',
      'fundit.backup.',
      'fundit.backup.pending.',
      'fundit.recovery.pending.',
      'fundit.recovery.tried.',
      'fundit.pendingBridges',
    ])
  })

  it('gives testnet its own keys that no mainnet key or prefix can match', () => {
    const mainnet = names.map((n) => storageKey(n, 'mainnet'))
    for (const n of names) {
      const key = storageKey(n, 'testnet')
      expect(key).toBe(`fundit.testnet.${n}`)
      expect(mainnet.some((m) => key.startsWith(m) || m.startsWith(key))).toBe(false)
    }
  })

  it('uses the build network by default', () => {
    expect(storageKey('passkey')).toBe(storageKey('passkey', NETWORK.name))
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

  // Donating from a Gateway unified balance is gone, so the browser must not be allowed to call Gateway.
  it('lists no Gateway API host', () => {
    expect(headers).not.toMatch(/gateway-api/)
  })

  // AppKit's UI hosts are gone. Only the WalletConnect relay, verify, RPC and analytics hosts pair a phone wallet.
  it('the CSP allows no Reown hosts', () => {
    for (const host of ['fonts.reown.com', '*.reown.com', 'reown.com', 'api.web3modal.org', 'secure.walletconnect.org']) {
      expect(headers).not.toContain(host)
    }
  })

  it('the CSP still allows WalletConnect over https and wss for phone wallets', () => {
    for (const url of ['https://relay.walletconnect.org', 'https://rpc.walletconnect.org', 'https://pulse.walletconnect.org', 'https://echo.walletconnect.com', 'wss://relay.walletconnect.org', 'wss://relay.walletconnect.com']) {
      expect(connectSrcAllows(headers, url)).toBe(true)
    }
    expect(headers).toContain('https://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.com wss://*.walletconnect.org')
  })

  // Circle's code and approval screens run in a pw-auth.circle.com frame, and Turnstile loads a script and a
  // frame from challenges.cloudflare.com. A missing source blocks email sign-in in the browser with no build error.
  it('the CSP allows pw-auth.circle.com and challenges.cloudflare.com where the SDK and Turnstile need them', () => {
    const csp = rule('/*').find((h) => h.startsWith('Content-Security-Policy:')) ?? ''
    const directive = (name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `))?.split(/\s+/).slice(1) ?? []
    for (const [name, urls] of Object.entries(EMAIL_SIGNIN_SOURCES)) {
      for (const url of urls) expect(directive(name)).toContain(url)
    }
    expect(EMAIL_SIGNIN_SOURCES['frame-src']).toContain('https://pw-auth.circle.com')
    expect(EMAIL_SIGNIN_SOURCES['frame-src']).toContain('https://challenges.cloudflare.com')
    expect(EMAIL_SIGNIN_SOURCES['script-src']).toContain('https://challenges.cloudflare.com')
    // The page itself calls neither host, so connect-src stays as it was.
    expect(connectSrcAllows(headers, 'https://pw-auth.circle.com')).toBe(false)
    expect(connectSrcAllows(headers, 'https://challenges.cloudflare.com')).toBe(false)
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

// Test tokens look like real USDC, so a testnet site always says so beside the logo. On mainnet the Beta tag is
// the owner's choice (VITE_BETA=1), and it goes away by clearing that value.
describe('networkTag', () => {
  it('reads Testnet on testnet, whatever VITE_BETA says', () => {
    expect(networkTag('testnet', undefined)).toBe('Testnet')
    expect(networkTag('testnet', '1')).toBe('Testnet')
  })

  it('reads Beta on mainnet with VITE_BETA=1', () => {
    expect(networkTag('mainnet', '1')).toBe('Beta')
  })

  it('shows nothing on mainnet without VITE_BETA', () => {
    expect(networkTag('mainnet', undefined)).toBeNull()
    expect(networkTag('mainnet', '')).toBeNull()
    expect(networkTag('mainnet', 'true')).toBeNull()
  })
})

// Test Fundits stay off public lists. The list is matched against lower-case creators, so every entry must be one.
describe('testCreators', () => {
  it('lists the 17 testnet creators, the shared e2e account and the e2e wallet, in lower case, and nothing on mainnet', () => {
    const list = NETWORKS.testnet.testCreators
    expect(list).toHaveLength(18)
    for (const a of list) expect(a).toMatch(/^0x[0-9a-f]{40}$/)
    expect(new Set(list).size).toBe(list.length)
    expect(list).toContain('0xd35e225662def377baaa2c61c42749e55a8a934c')
    expect(list).toContain('0x2b35ea205659e5aab183af1c711564fcd86dc71f')
    expect(NETWORKS.mainnet.testCreators).toEqual([])
  })
})

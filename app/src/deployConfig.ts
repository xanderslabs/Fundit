import { getAddress, isAddress, zeroAddress, type Address } from 'viem'

// No import.meta.env here: vite.config.ts also runs this at build time, so a production
// build fails before anything is bundled.
export type DeployEnv = {
  PROD: boolean
  VITE_ARC_NETWORK?: string
  VITE_FACTORY_ADDRESS?: string
  VITE_FACTORY_DEPLOY_BLOCK?: string
  VITE_REOWN_PROJECT_ID?: string
}

export type DeployConfig = { factoryAddress: Address; factoryDeployBlock: bigint; reownProjectId: string }

export type ArcNetwork = 'mainnet' | 'testnet'

// VITE_ARC_NETWORK: unset or empty means mainnet. Any other value than the two names fails, so a typo
// cannot build a site for the wrong network.
export function parseArcNetwork(value: string | undefined): ArcNetwork {
  if (!value || value === 'mainnet') return 'mainnet'
  if (value === 'testnet') return 'testnet'
  throw new Error(`VITE_ARC_NETWORK must be mainnet or testnet, not "${value}"`)
}

// The CampaignFactory deployed on each network and its deploy block, from contracts/deployments/arc-*.json.
// loadConfig refuses the other network's factory, and a wrong deploy block for a known factory.
export const KNOWN_FACTORIES: Record<ArcNetwork, { address: Address; deployBlock: bigint }> = {
  mainnet: { address: '0xf1b2AEF82c37fC41D254D8e06BD7780ce34617d9', deployBlock: 26452579n },
  testnet: { address: '0x6890D40a9A472D0d05aDb5938D85B07059ad54ab', deployBlock: 67870064n },
}

export type BuildEnv = {
  PROD: boolean
  VITE_ARC_NETWORK?: string
  VITE_ALLOW_TESTNET_BUILD?: string
  VITE_ARC_RPC_URL?: string
  VITE_MAINNET_RPC_URL?: string
  VITE_EMAIL_SIGNIN?: string
  VITE_CIRCLE_UCW_APP_ID?: string
  VITE_TURNSTILE_SITE_KEY?: string
}

// True when the Content-Security-Policy connect-src in this _headers text lets the page call url. A source
// like https://*.arc.io covers subdomains of arc.io, and the scheme must match.
export function connectSrcAllows(headers: string, url: string): boolean {
  const csp = /Content-Security-Policy:\s*(.+)/.exec(headers)?.[1] ?? ''
  const directive = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src')) ?? ''
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return false
  }
  return directive
    .split(/\s+/)
    .slice(1)
    .some((source) => {
      if (!source.includes('://')) return false
      const [scheme, pattern] = source.split('://') as [string, string]
      if (`${scheme}:` !== target.protocol) return false
      return pattern.startsWith('*.') ? target.host.endsWith(pattern.slice(1)) : target.host === pattern
    })
}

function hostLabels(url: string): string[] {
  try {
    return new URL(url).hostname.split('.')
  } catch {
    return []
  }
}

// Production build checks, run by vite.config.ts with the text of public/_headers. A site that fails one of
// these builds fine but cannot work: email sign-in with no App ID, or an RPC the browser blocks.
// The default RPCs are not set here; config.test.ts checks them against the same connect-src.
//
// A production build refuses VITE_ARC_NETWORK=testnet unless VITE_ALLOW_TESTNET_BUILD=1 is also set, so a testnet
// site is always an explicit choice. fundit.fun may run on testnet with both set; switching it to mainnet then
// means clearing both and setting the mainnet factory, with no code change.
export function checkBuildEnv(env: BuildEnv, headers: string): void {
  const network = parseArcNetwork(env.VITE_ARC_NETWORK)
  // A VITE_ARC_RPC_URL left over from the other network would read the wrong chain with no error.
  const other = network === 'testnet' ? 'mainnet' : 'testnet'
  if (env.VITE_ARC_RPC_URL && hostLabels(env.VITE_ARC_RPC_URL).includes(other)) {
    throw new Error(`VITE_ARC_RPC_URL (${env.VITE_ARC_RPC_URL}) is an Arc ${other} RPC, but VITE_ARC_NETWORK is ${network}`)
  }
  if (!env.PROD) return
  if (network === 'testnet' && env.VITE_ALLOW_TESTNET_BUILD !== '1') {
    throw new Error('VITE_ARC_NETWORK=testnet is refused in a production build unless VITE_ALLOW_TESTNET_BUILD=1 is also set.')
  }
  // Continue with email shows only with VITE_EMAIL_SIGNIN=1, and then needs Circle's App ID and a Turnstile key.
  if (env.VITE_EMAIL_SIGNIN === '1') {
    for (const name of ['VITE_CIRCLE_UCW_APP_ID', 'VITE_TURNSTILE_SITE_KEY'] as const) {
      if (!env[name]) throw new Error(`${name} is required in a production build with VITE_EMAIL_SIGNIN=1`)
    }
  }
  for (const name of ['VITE_ARC_RPC_URL', 'VITE_MAINNET_RPC_URL'] as const) {
    const url = env[name]
    if (url && !connectSrcAllows(headers, url)) {
      throw new Error(`${name} (${url}) is not allowed by connect-src in public/_headers. Add its host there.`)
    }
  }
}

// Fails loudly instead of shipping a production build that points at 0x0 or has no WalletConnect project id (the Reown dashboard issues it).
// Dev and test may run with no factory (both vars unset), which gives zero defaults.
export function loadConfig(env: DeployEnv): DeployConfig {
  const address = env.VITE_FACTORY_ADDRESS || undefined
  const block = env.VITE_FACTORY_DEPLOY_BLOCK || undefined
  const reownProjectId = env.VITE_REOWN_PROJECT_ID ?? ''

  if (env.PROD && !address) throw new Error('VITE_FACTORY_ADDRESS is required in a production build')
  if (env.PROD && !reownProjectId) throw new Error('VITE_REOWN_PROJECT_ID is required in a production build')
  if (address && !block) throw new Error('VITE_FACTORY_DEPLOY_BLOCK is required when VITE_FACTORY_ADDRESS is set')
  if (block && !address) throw new Error('VITE_FACTORY_ADDRESS is required when VITE_FACTORY_DEPLOY_BLOCK is set')
  if (!address || !block) return { factoryAddress: zeroAddress, factoryDeployBlock: 0n, reownProjectId }

  if (!isAddress(address) || address.toLowerCase() === zeroAddress) {
    throw new Error(`VITE_FACTORY_ADDRESS is not a valid address: ${address}`)
  }
  if (!/^\d+$/.test(block)) throw new Error(`VITE_FACTORY_DEPLOY_BLOCK must be a block number: ${block}`)
  const network = parseArcNetwork(env.VITE_ARC_NETWORK)
  const other = network === 'testnet' ? 'mainnet' : 'testnet'
  // The other network's factory has no code on this one: no Fundits would list, and Create would pay gas for nothing.
  if (address.toLowerCase() === KNOWN_FACTORIES[other].address.toLowerCase()) {
    throw new Error(`VITE_FACTORY_ADDRESS (${address}) is the Arc ${other} factory, but VITE_ARC_NETWORK is ${network}`)
  }
  // The campaign scan starts at this block. Earlier is before the factory existed, and later hides the first Fundits.
  const known = KNOWN_FACTORIES[network]
  if (address.toLowerCase() === known.address.toLowerCase() && BigInt(block) !== known.deployBlock) {
    throw new Error(`VITE_FACTORY_DEPLOY_BLOCK (${block}) is wrong for the Arc ${network} factory, which was deployed at block ${known.deployBlock}`)
  }
  return { factoryAddress: getAddress(address), factoryDeployBlock: BigInt(block), reownProjectId }
}

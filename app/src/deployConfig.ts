import { getAddress, isAddress, zeroAddress, type Address } from 'viem'

// No import.meta.env here: vite.config.ts also runs this at build time, so a production
// build fails before anything is bundled.
export type DeployEnv = {
  PROD: boolean
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

// Runtime backstop for the production build guard: true when a testnet bundle is served on fundit.fun. A
// separate test site on a subdomain (testnet.fundit.fun, for example) is allowed.
export function testnetRefusedOn(network: ArcNetwork, hostname: string): boolean {
  return network === 'testnet' && (hostname === 'fundit.fun' || hostname === 'www.fundit.fun')
}

export type BuildEnv = {
  PROD: boolean
  VITE_ARC_NETWORK?: string
  VITE_ALLOW_TESTNET_BUILD?: string
  VITE_PASSKEYS?: string
  VITE_CIRCLE_CLIENT_KEY?: string
  VITE_ARC_RPC_URL?: string
  VITE_MAINNET_RPC_URL?: string
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
// these builds fine but cannot work: a passkey sign-in with no client key, or an RPC the browser blocks.
// The default RPCs are not set here; config.test.ts checks them against the same connect-src.
//
// The deploy for fundit.fun is a plain production build (npm run build), so a production build is taken to be
// for fundit.fun. It refuses VITE_ARC_NETWORK=testnet unless VITE_ALLOW_TESTNET_BUILD=1 says the build is
// meant for a test site. That flag must never be set where the fundit.fun build runs.
export function checkBuildEnv(env: BuildEnv, headers: string): void {
  const network = parseArcNetwork(env.VITE_ARC_NETWORK)
  // A VITE_ARC_RPC_URL left over from the other network would read the wrong chain with no error.
  const other = network === 'testnet' ? 'mainnet' : 'testnet'
  if (env.VITE_ARC_RPC_URL && hostLabels(env.VITE_ARC_RPC_URL).includes(other)) {
    throw new Error(`VITE_ARC_RPC_URL (${env.VITE_ARC_RPC_URL}) is an Arc ${other} RPC, but VITE_ARC_NETWORK is ${network}`)
  }
  if (!env.PROD) return
  if (network === 'testnet' && env.VITE_ALLOW_TESTNET_BUILD !== '1') {
    throw new Error('VITE_ARC_NETWORK=testnet is refused in a production build, which is for fundit.fun. Set VITE_ALLOW_TESTNET_BUILD=1 only for a test site.')
  }
  if (env.VITE_PASSKEYS === '1' && !env.VITE_CIRCLE_CLIENT_KEY) {
    throw new Error('VITE_CIRCLE_CLIENT_KEY is required when VITE_PASSKEYS=1 in a production build')
  }
  for (const name of ['VITE_ARC_RPC_URL', 'VITE_MAINNET_RPC_URL'] as const) {
    const url = env[name]
    if (url && !connectSrcAllows(headers, url)) {
      throw new Error(`${name} (${url}) is not allowed by connect-src in public/_headers. Add its host there.`)
    }
  }
}

// Fails loudly instead of shipping a production build that points at 0x0 or has no Reown project id.
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
  return { factoryAddress: getAddress(address), factoryDeployBlock: BigInt(block), reownProjectId }
}

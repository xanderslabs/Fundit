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

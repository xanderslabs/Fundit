import { erc20Abi } from '../../../src/abi/erc20'
import { factoryAbi } from '../../../src/abi/factory'
import type { Address } from 'viem'
import type { ReadClient } from '../../../src/lib/campaigns'
import { type AdminNetwork, ADMIN_NETWORKS } from './networks'
import type { ByToken } from './stats'

export type FactoryState = {
  owner: Address
  pendingOwner: Address
  donationFeeBps: number
  withdrawFeeBps: number
  treasury: Address
  featured: Address
  paused: boolean
  treasuryBalance: ByToken
}

export async function readFactoryState(client: ReadClient, network: AdminNetwork): Promise<FactoryState> {
  const { factory, usdc, eurc } = ADMIN_NETWORKS[network]
  const [owner, pendingOwner, donationFeeBps, withdrawFeeBps, treasury, featured, paused] = await client.multicall({
    contracts: [
      { address: factory, abi: factoryAbi, functionName: 'owner' },
      { address: factory, abi: factoryAbi, functionName: 'pendingOwner' },
      { address: factory, abi: factoryAbi, functionName: 'donationFeeBps' },
      { address: factory, abi: factoryAbi, functionName: 'withdrawFeeBps' },
      { address: factory, abi: factoryAbi, functionName: 'treasury' },
      { address: factory, abi: factoryAbi, functionName: 'featuredCampaign' },
      { address: factory, abi: factoryAbi, functionName: 'creationPaused' },
    ],
    allowFailure: false,
  })
  const [USDC, EURC] = await Promise.all(
    [usdc, eurc].map((token) => client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [treasury] })),
  )
  return { owner, pendingOwner, donationFeeBps, withdrawFeeBps, treasury, featured, paused, treasuryBalance: { USDC: USDC!, EURC: EURC! } }
}

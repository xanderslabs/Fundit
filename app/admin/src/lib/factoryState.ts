import type { Address } from 'viem'
import { erc20Abi } from '../../../src/abi/erc20'
import { factoryAbi } from '../../../src/abi/factory'
import { TOKENS } from '../../../src/config'
import type { ReadClient } from '../../../src/lib/campaigns'
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

export async function readFactoryState(client: ReadClient, factory: Address): Promise<FactoryState> {
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
    (['USDC', 'EURC'] as const).map((symbol) =>
      client.readContract({ address: TOKENS[symbol].address, abi: erc20Abi, functionName: 'balanceOf', args: [treasury] }),
    ),
  )
  return { owner, pendingOwner, donationFeeBps, withdrawFeeBps, treasury, featured, paused, treasuryBalance: { USDC: USDC!, EURC: EURC! } }
}

import type { Address, PublicClient } from 'viem'
import { erc20Abi } from '../abi/erc20'
import { TOKENS } from '../config'

// The query key for an address's Arc balances. Add money and My page share it, so one refresh updates both.
export const BALANCES_KEY = 'account-balances'
export const balancesKey = (address: Address | null) => [BALANCES_KEY, address?.toLowerCase()] as const

// Both balances through the ERC-20 interface (6 decimals), never the 18-decimal native balance.
export async function fetchAccountBalances(client: Pick<PublicClient, 'readContract'>, account: Address): Promise<{ usdc: bigint; eurc: bigint }> {
  const [usdc, eurc] = await Promise.all([
    client.readContract({ address: TOKENS.USDC.address, abi: erc20Abi, functionName: 'balanceOf', args: [account] }),
    client.readContract({ address: TOKENS.EURC.address, abi: erc20Abi, functionName: 'balanceOf', args: [account] }),
  ])
  return { usdc, eurc }
}

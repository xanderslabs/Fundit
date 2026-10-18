import { type Address, encodeFunctionData, type PublicClient } from 'viem'
import { erc20Abi } from '../abi/erc20'
import { TOKENS } from '../config'
import type { Call } from './sender'

// Money added from a regular wallet on Arc is a plain ERC-20 transfer to the Fundit account.
export function buildDepositCall(token: Address, to: Address, amount: bigint): Call {
  return { to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, amount] }) }
}

// Both balances through the ERC-20 interface (6 decimals), never the 18-decimal native balance.
export async function fetchAccountBalances(client: Pick<PublicClient, 'readContract'>, account: Address): Promise<{ usdc: bigint; eurc: bigint }> {
  const [usdc, eurc] = await Promise.all([
    client.readContract({ address: TOKENS.USDC.address, abi: erc20Abi, functionName: 'balanceOf', args: [account] }),
    client.readContract({ address: TOKENS.EURC.address, abi: erc20Abi, functionName: 'balanceOf', args: [account] }),
  ])
  return { usdc, eurc }
}

import { type Address, decodeFunctionData } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { erc20Abi } from '../abi/erc20'
import { TOKENS } from '../config'
import { buildDepositCall, fetchAccountBalances } from './deposit'

const ACCOUNT = '0x00000000000000000000000000000000000000cc' as Address

describe('buildDepositCall', () => {
  // The money moves straight from the wallet to the account, so the call is a plain transfer on the token.
  it('is an ERC-20 transfer of the exact amount to the account, on the chosen token', () => {
    const call = buildDepositCall(TOKENS.USDC.address, ACCOUNT, 5_000000n)
    expect(call.to).toBe(TOKENS.USDC.address)
    const decoded = decodeFunctionData({ abi: erc20Abi, data: call.data })
    expect(decoded.functionName).toBe('transfer')
    expect(decoded.args).toEqual([ACCOUNT, 5000000n])
  })
})

describe('fetchAccountBalances', () => {
  // Both balances come through the ERC-20 interface (6 decimals), never the 18-decimal native balance.
  it('reads USDC and EURC balanceOf for the account', async () => {
    const readContract = vi.fn(async ({ address }: { address: Address }) => (address === TOKENS.USDC.address ? 7n : 3n))
    const balances = await fetchAccountBalances({ readContract } as never, ACCOUNT)
    expect(balances).toEqual({ usdc: 7n, eurc: 3n })
    expect(readContract.mock.calls.map((c) => [c[0].address, (c[0] as unknown as { functionName: string }).functionName])).toEqual([
      [TOKENS.USDC.address, 'balanceOf'],
      [TOKENS.EURC.address, 'balanceOf'],
    ])
  })
})

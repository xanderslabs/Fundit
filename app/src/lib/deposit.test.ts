import type { Address } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { TOKENS } from '../config'
import { fetchAccountBalances } from './deposit'

const ACCOUNT = '0x00000000000000000000000000000000000000cc' as Address

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

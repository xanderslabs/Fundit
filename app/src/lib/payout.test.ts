import { type Address, decodeFunctionData, getAddress, pad } from 'viem'
import { describe, expect, it } from 'vitest'
import { campaignAbi } from '../abi/campaign'
import { FORWARD_HOOK_DATA, TOKENS, type TokenSymbol } from '../config'
import type { CampaignView } from './campaigns'
import { buildWithdrawCall, netAfterWithdrawFee, payoutOptions } from './payout'

const CAMPAIGN = getAddress('0x00000000000000000000000000000000000000a1')
const ME = getAddress('0x1111111111111111111111111111111111111111') as Address

function view(symbol: TokenSymbol): CampaignView {
  return {
    address: CAMPAIGN,
    symbol,
    summary: {
      creator: ME,
      token: TOKENS[symbol].address,
      goal: 1000_000000n,
      raised: 0n,
      available: 0n,
      withdrawn: 0n,
      closed: false,
      donationFeeBps: 250,
      withdrawFeeBps: 100,
      createdAt: 1760000000n,
      createdAtBlock: 1n,
      backup: '0x0000000000000000000000000000000000000000',
      recoveryReadyAt: 0n,
      meta: { title: 'Clean water', description: '', imageUrl: '', links: [] },
    },
  }
}

const decode = (data: `0x${string}`) => decodeFunctionData({ abi: campaignAbi, data })

describe('buildWithdrawCall', () => {
  // On Arc the contract pays the recipient directly. CCTP fields must be zero and the hook empty.
  it('pays out on Arc with domain 26, the padded recipient and no CCTP fields', () => {
    const call = buildWithdrawCall({ campaign: CAMPAIGN, amount: 50_000000n, dest: 'Arc', recipient: ME, fast: true })
    expect(call.to).toBe(CAMPAIGN)
    const { functionName, args } = decode(call.data)
    expect(functionName).toBe('withdraw')
    expect(args).toEqual([50_000000n, 26, pad(ME, { size: 32 }), 0n, 0, '0x'])
  })

  // The forwarder only mints on the destination when the hook data is there, and the fee cap must reach the contract.
  it('pays out to Base with domain 6, the fee cap, Fast finality and the forward hook data', () => {
    const call = buildWithdrawCall({
      campaign: CAMPAIGN,
      amount: 50_000000n,
      dest: 'Base',
      recipient: ME,
      fee: { maxFee: 30_000n },
      fast: true,
    })
    expect(decode(call.data).args).toEqual([50_000000n, 6, pad(ME, { size: 32 }), 30_000n, 1000, FORWARD_HOOK_DATA])
  })

  it('uses Standard finality when fast is off', () => {
    const call = buildWithdrawCall({ campaign: CAMPAIGN, amount: 5_000000n, dest: 'Polygon', recipient: ME, fee: { maxFee: 1n }, fast: false })
    expect(decode(call.data).args[4]).toBe(2000)
  })

  // Money sent to the campaign itself would be stuck there (Arc) or lost to an address no one holds (elsewhere).
  it('refuses the campaign itself as the recipient', () => {
    expect(() => buildWithdrawCall({ campaign: CAMPAIGN, amount: 1n, dest: 'Arc', recipient: CAMPAIGN, fast: false })).toThrow(
      'Choose a different recipient.',
    )
  })

  // Without a fee cap a cross-chain call would send 0 and the transfer could stall.
  it('refuses a cross-chain payout with no fee quote', () => {
    expect(() => buildWithdrawCall({ campaign: CAMPAIGN, amount: 1n, dest: 'Base', recipient: ME, fast: true })).toThrow()
  })
})

describe('payoutOptions', () => {
  // The contract would revert UnsupportedPayoutDomain, so EURC must not offer chains it cannot pay out to.
  it('returns only Arc for EURC when no other domain is allowed', async () => {
    expect(await payoutOptions(view('EURC'), async () => false)).toEqual(['Arc'])
  })

  // USDC pays out over CCTP to every chain whatever the factory's EURC list says, so the answer must not matter.
  it('returns Arc and every CCTP chain for USDC', async () => {
    expect(await payoutOptions(view('USDC'), async () => false)).toEqual([
      'Arc',
      'Ethereum',
      'Avalanche',
      'Optimism',
      'Arbitrum',
      'Base',
      'Polygon',
    ])
  })

  it('returns the domains the contract allows for EURC', async () => {
    expect(await payoutOptions(view('EURC'), async (d) => d === 6)).toEqual(['Arc', 'Base'])
  })
})

describe('netAfterWithdrawFee', () => {
  // Matches the contract: fee = amount * bps / 10,000, rounded down, so the net shown is never more than sent.
  it('takes the withdrawal fee off the amount', () => {
    expect(netAfterWithdrawFee(97_500000n, 100)).toBe(96_525000n)
    expect(netAfterWithdrawFee(1n, 250)).toBe(1n)
  })
})

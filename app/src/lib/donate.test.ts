import { decodeFunctionData, encodeFunctionData, getAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { campaignAbi } from '../abi/campaign'
import { erc20Abi } from '../abi/erc20'
import { TOKENS } from '../config'
import { buildDonateCalls, donationBreakdown } from './donate'

const CAMPAIGN = getAddress('0x00000000000000000000000000000000000000a1')
const TOKEN = TOKENS.USDC.address

const base = { campaign: CAMPAIGN, token: TOKEN, amount: 100_000000n, tip: 5_000000n, message: 'Good luck' }
const donateData = encodeFunctionData({ abi: campaignAbi, functionName: 'donate', args: [100_000000n, 5_000000n, 'Good luck'] })

// Gifts come from a Fundit account, a smart account. Memo only accepts an EOA caller, so every gift calls donate
// on the campaign directly. The campaign pulls amount plus tip, so the approval names the campaign.
describe('buildDonateCalls', () => {
  it('with no allowance, approves the campaign for amount plus tip, then calls donate on the campaign directly', () => {
    const calls = buildDonateCalls({ ...base, allowance: 0n })
    expect(calls).toHaveLength(2)
    expect(calls[0]!.to).toBe(TOKEN)
    const approve = decodeFunctionData({ abi: erc20Abi, data: calls[0]!.data })
    expect(approve.functionName).toBe('approve')
    expect(approve.args).toEqual([CAMPAIGN, 105_000000n])
    expect(calls[1]).toEqual({ to: CAMPAIGN, data: donateData })
  })

  // A second approval costs the donor gas for nothing.
  it('with enough allowance, skips the approval', () => {
    expect(buildDonateCalls({ ...base, allowance: 105_000000n })).toEqual([{ to: CAMPAIGN, data: donateData }])
  })

  it('approves again when the allowance is one unit short', () => {
    expect(buildDonateCalls({ ...base, allowance: 104_999999n })).toHaveLength(2)
  })

  // The contract would revert with MessageTooLong after the approval was already paid for.
  it('throws for a message over 280 bytes', () => {
    expect(() => buildDonateCalls({ ...base, message: 'a'.repeat(281), allowance: 0n })).toThrow()
    // 280 bytes is the limit, and it counts bytes, not characters: 'é' is 2 bytes.
    expect(() => buildDonateCalls({ ...base, message: 'a'.repeat(280), allowance: 0n })).not.toThrow()
    expect(() => buildDonateCalls({ ...base, message: 'é'.repeat(141), allowance: 0n })).toThrow()
  })
})

describe('donationBreakdown', () => {
  it('splits a 100 donation with a 5 tip at 2.5%', () => {
    expect(donationBreakdown(100_000000n, 5_000000n, 250)).toEqual({
      toCampaign: 97_500000n,
      fee: 2_500000n,
      tip: 5_000000n,
      total: 105_000000n,
    })
  })

  // The contract computes amount * bps / 10000 with integer division. Showing a rounded-up fee would be wrong.
  it('rounds the fee down like the contract', () => {
    expect(donationBreakdown(1n, 0n, 250)).toEqual({ toCampaign: 1n, fee: 0n, tip: 0n, total: 1n })
    expect(donationBreakdown(399n, 0n, 250).fee).toBe(9n)
  })
})

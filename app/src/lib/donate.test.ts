import { type Address, decodeFunctionData, encodeFunctionData, getAddress, keccak256, toHex } from 'viem'
import { describe, expect, it } from 'vitest'
import { campaignAbi } from '../abi/campaign'
import { erc20Abi } from '../abi/erc20'
import { memoAbi } from '../abi/memo'
import { MEMO_ADDRESS, TOKENS } from '../config'
import { buildDonateCalls, donationBreakdown } from './donate'
import type { Sender } from './sender'

const CAMPAIGN = getAddress('0x00000000000000000000000000000000000000a1')
const ME = '0x1111111111111111111111111111111111111111' as Address
const TOKEN = TOKENS.USDC.address

function sender(kind: Sender['kind']): Sender {
  return { kind, address: ME, send: async () => ({ status: 'rejected', completed: 0 }) }
}

const base = { campaign: CAMPAIGN, token: TOKEN, amount: 100_000000n, tip: 5_000000n, message: 'Good luck' }
const donateData = encodeFunctionData({ abi: campaignAbi, functionName: 'donate', args: [100_000000n, 5_000000n, 'Good luck'] })

describe('buildDonateCalls', () => {
  // Memo keeps msg.sender, so the campaign pulls from the donor and the approval must name the campaign.
  it('eoa with no allowance approves the campaign for amount plus tip, then calls Memo with the exact donate calldata', () => {
    const calls = buildDonateCalls({ ...base, sender: sender('eoa'), allowance: 0n })
    expect(calls).toHaveLength(2)

    expect(calls[0]!.to).toBe(TOKEN)
    const approve = decodeFunctionData({ abi: erc20Abi, data: calls[0]!.data })
    expect(approve.functionName).toBe('approve')
    expect(approve.args).toEqual([CAMPAIGN, 105_000000n])

    expect(calls[1]!.to).toBe(MEMO_ADDRESS)
    const memo = decodeFunctionData({ abi: memoAbi, data: calls[1]!.data })
    expect(memo.functionName).toBe('memo')
    const [target, data, memoId, memoData] = memo.args!
    expect(target).toBe(CAMPAIGN)
    expect(data).toBe(donateData)
    expect(memoId).toBe(keccak256(toHex('fundit.donate.v1')))
    expect(memoData).toBe(toHex('Good luck'))
  })

  // A second approval costs the donor gas for nothing.
  it('eoa with enough allowance skips the approval', () => {
    const calls = buildDonateCalls({ ...base, sender: sender('eoa'), allowance: 105_000000n })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.to).toBe(MEMO_ADDRESS)
  })

  it('approves again when the allowance is one unit short', () => {
    const calls = buildDonateCalls({ ...base, sender: sender('eoa'), allowance: 104_999999n })
    expect(calls).toHaveLength(2)
  })

  // Memo requires an EOA caller, so a passkey smart account calls the campaign directly.
  it('passkey approves, then calls donate on the campaign directly', () => {
    const calls = buildDonateCalls({ ...base, sender: sender('passkey'), allowance: 0n })
    expect(calls).toHaveLength(2)
    expect(calls[0]!.to).toBe(TOKEN)
    expect(calls[1]!.to).toBe(CAMPAIGN)
    expect(calls[1]!.data).toBe(donateData)
  })

  // The contract would revert with MessageTooLong after the approval was already paid for.
  it('throws for a message over 280 bytes', () => {
    expect(() => buildDonateCalls({ ...base, message: 'a'.repeat(281), sender: sender('eoa'), allowance: 0n })).toThrow()
    // 280 bytes is the limit, and it counts bytes, not characters: 'é' is 2 bytes.
    expect(() => buildDonateCalls({ ...base, message: 'a'.repeat(280), sender: sender('eoa'), allowance: 0n })).not.toThrow()
    expect(() => buildDonateCalls({ ...base, message: 'é'.repeat(141), sender: sender('eoa'), allowance: 0n })).toThrow()
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

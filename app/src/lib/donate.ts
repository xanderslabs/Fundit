import { type Address, encodeFunctionData, type Hex, type PublicClient, keccak256, toHex } from 'viem'
import { campaignAbi } from '../abi/campaign'
import { erc20Abi } from '../abi/erc20'
import { memoAbi } from '../abi/memo'
import { MAX_MESSAGE_BYTES, MEMO_ADDRESS } from '../config'
import type { Call, Sender } from './sender'
import { byteLength } from './validate'

// Tags every Fundit donation sent through Arc Memo.
export const DONATE_MEMO_ID = keccak256(toHex('fundit.donate.v1'))

const BPS = 10_000n

export type DonateParams = {
  sender: Sender
  campaign: Address
  token: Address
  amount: bigint
  tip: bigint
  message: string
  // The donor's current allowance to the campaign, read from Arc just before building.
  allowance: bigint
  // The code at the donor address on Arc, read just before building. viem's getCode gives undefined for none.
  senderCode: Hex | undefined
}

// The campaign pulls amount + tip from msg.sender. Memo keeps msg.sender as the donor, so the approval
// always names the campaign, never Memo.
export function buildDonateCalls(p: DonateParams): Call[] {
  if (byteLength(p.message) > MAX_MESSAGE_BYTES) throw new Error(`The message is over ${MAX_MESSAGE_BYTES} bytes.`)
  const total = p.amount + p.tip
  const calls: Call[] = []
  if (p.allowance < total) {
    calls.push({ to: p.token, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [p.campaign, total] }) })
  }
  const donate = encodeFunctionData({ abi: campaignAbi, functionName: 'donate', args: [p.amount, p.tip, p.message] })
  // Memo only accepts an EOA caller. A passkey account, a smart wallet, a Safe or an EIP-7702 delegated
  // address has code on Arc, so it calls the campaign directly.
  const hasCode = p.senderCode !== undefined && p.senderCode !== '0x'
  if (p.sender.kind === 'passkey' || hasCode) {
    calls.push({ to: p.campaign, data: donate })
  } else {
    const data = encodeFunctionData({
      abi: memoAbi,
      functionName: 'memo',
      args: [p.campaign, donate, DONATE_MEMO_ID, toHex(p.message)],
    })
    calls.push({ to: MEMO_ADDRESS, data })
  }
  return calls
}

export type Breakdown = { toCampaign: bigint; fee: bigint; tip: bigint; total: bigint }

// Same integer math as Campaign.donate: the fee rounds down and the whole tip goes to Fundit.
export function donationBreakdown(amount: bigint, tip: bigint, donationFeeBps: number): Breakdown {
  const fee = (amount * BigInt(donationFeeBps)) / BPS
  return { toCampaign: amount - fee, fee, tip, total: amount + tip }
}

export type DonorFunds = { balance: bigint; allowance: bigint }

type TokenReader = Pick<PublicClient, 'readContract'>

// The donor's token balance and allowance to the campaign, both through the ERC-20 interface.
export async function fetchDonorFunds(client: TokenReader, token: Address, owner: Address, campaign: Address): Promise<DonorFunds> {
  const [balance, allowance] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
    client.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, campaign] }),
  ])
  return { balance, allowance }
}

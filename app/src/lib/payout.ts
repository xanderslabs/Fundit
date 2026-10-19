import { type Address, encodeFunctionData, isAddress, isAddressEqual, pad, zeroAddress } from 'viem'
import { campaignAbi } from '../abi/campaign'
import { ARC_DOMAIN, CCTP_CHAINS, CHAIN_LABELS, type CctpChainKey, FORWARD_HOOK_DATA } from '../config'
import type { CampaignView } from './campaigns'
import { PlainError } from './errors'
import type { Call } from './sender'
import { ADDRESS_TYPO } from './validate'

export type PayoutDest = 'Arc' | CctpChainKey

// CCTP finality thresholds: 1000 is a Fast transfer, 2000 is Standard.
const FAST_THRESHOLD = 1000
const STANDARD_THRESHOLD = 2000
const BPS = 10_000n

export function destDomain(dest: PayoutDest): number {
  if (dest === 'Arc') return ARC_DOMAIN
  return CCTP_CHAINS.find((c) => c.key === dest)!.domain
}

// The same rounding as Campaign.withdraw: fee = amount * bps / 10,000, rounded down.
export function netAfterWithdrawFee(amount: bigint, withdrawFeeBps: number): bigint {
  return amount - (amount * BigInt(withdrawFeeBps)) / BPS
}

// One withdraw call. On Arc the contract pays the recipient directly. Elsewhere it burns through CCTP with
// the forward hook, so Circle's forwarder mints to the recipient on the destination chain.
export function buildWithdrawCall(p: {
  campaign: Address
  amount: bigint
  dest: PayoutDest
  recipient: Address
  fee?: { maxFee: bigint }
  fast: boolean
}): Call {
  // Strict: pad() does not check the checksum, so a mistyped address would otherwise get the payout.
  if (!isAddress(p.recipient)) throw new PlainError(ADDRESS_TYPO)
  if (isAddressEqual(p.recipient, zeroAddress)) throw new PlainError('Enter a recipient address.')
  // On Arc the contract reverts. On another chain no one holds the campaign's address, so the money is lost.
  if (isAddressEqual(p.recipient, p.campaign)) throw new PlainError('The Fundit cannot pay itself. Choose a different recipient.')
  const recipient = pad(p.recipient, { size: 32 })
  let args: readonly [bigint, number, `0x${string}`, bigint, number, `0x${string}`]
  if (p.dest === 'Arc') {
    args = [p.amount, ARC_DOMAIN, recipient, 0n, 0, '0x']
  } else {
    if (!p.fee) throw new Error('A fee quote is needed for a payout to another chain.')
    const chain = CCTP_CHAINS.find((c) => c.key === p.dest)!
    if (p.fast && !chain.fast) throw new PlainError(`Fast transfers are not available to ${CHAIN_LABELS[chain.key]}. Choose Standard.`)
    args = [p.amount, chain.domain, recipient, p.fee.maxFee, p.fast ? FAST_THRESHOLD : STANDARD_THRESHOLD, FORWARD_HOOK_DATA]
  }
  return { to: p.campaign, data: encodeFunctionData({ abi: campaignAbi, functionName: 'withdraw', args }) }
}

// Where this campaign can pay out. Arc always works. A USDC campaign can pay out to every CCTP chain; an
// EURC campaign only to the domains the factory lists, which canPayoutTo reads from the contract.
export async function payoutOptions(campaign: CampaignView, canPayoutTo: (d: number) => Promise<boolean>): Promise<PayoutDest[]> {
  if (campaign.symbol === 'USDC') return ['Arc', ...CCTP_CHAINS.map((c) => c.key)]
  const allowed = await Promise.all(CCTP_CHAINS.map((c) => canPayoutTo(c.domain)))
  return ['Arc', ...CCTP_CHAINS.filter((_, i) => allowed[i]).map((c) => c.key)]
}

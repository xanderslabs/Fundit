# Fundit V2 contracts: security notes

This page describes the trust model of `CampaignFactory` and `Campaign`, and lists every
Slither finding that is accepted instead of fixed.

## Immutability

- There are no proxies and no upgrade hooks. `CampaignFactory` deploys each campaign as an
  EIP-1167 clone of one `Campaign` implementation with CREATE2.
- The implementation locks itself in its constructor, so only clones can be initialized.
  Each clone is initialized once, by the factory, in the transaction that deploys it.
- USDC, EURC and `TokenMessengerV2` are `immutable` in the factory. There is no `addToken`.
  A campaign accepts exactly one of the two tokens, fixed at creation.

## Owner powers

The intended deployment sets the factory owner to one EOA. The code accepts any `owner_` address. Ownership uses `Ownable2Step`, so a transfer only takes effect
when the new owner calls `acceptOwnership`. The owner can:

- Set `donationFeeBps` and `withdrawFeeBps`, each at most `MAX_FEE_BPS = 500` (5%). The
  factory copies both values into each campaign when it is created. Later changes apply only
  to campaigns created after the change.
- Set `treasury` to any non-zero address. `claimFees` pays the treasury named at claim time,
  so a new treasury also receives fees that accrued before the change.
- Set `featuredCampaign` to a campaign the factory created, or to zero.
- Pause and unpause the creation of new campaigns.

`renounceOwnership` always reverts. Without an owner the treasury could never be rotated.

## What the owner can never do

- Move campaign funds, or the creator balance of any campaign.
- Pause donations, withdrawals, settlement or fee claims on an existing campaign.
- Change the fees, token, creator or goal of an existing campaign.
- Add a token, change the messenger, or upgrade any contract.
- Add or remove an EURC payout domain.

## Campaign rules

- **Fee rounding.** Every fee is `amount * bps / 10_000`, rounded down in the creator's favour.
  Tips are chosen by the donor, go to `feesAccrued` in full and are not limited by the fee cap.
- **Pull-based fees.** Fees and tips stay in the campaign until anyone calls `claimFees`. A
  blocked or reverting treasury can only make `claimFees` revert, and the books stay intact. It
  never blocks `donate` or `withdraw`.
- **Settlement.** Campaign tokens that arrive without a `donate` call (plain transfer, CCTP or
  Gateway mint) are "unaccounted". `donate`, `settle`, `withdraw` and `claimFees` book them as a gross
  donation and charge the donation fee, so every inflow pays the same fee.
- **Saturating `unaccounted`.** `unaccounted()` returns 0 instead of reverting when the balance
  is below `creatorBalance + feesAccrued`. The internal settle step can therefore never revert,
  and the views stay readable even if the balance drifts.
- **Sweep guard.** `sweep` moves the whole balance of a token that is not the campaign token,
  creator only, with no fee. It reverts if the campaign-token balance drops during the call, in
  case a second token address can move the same underlying asset.
- **Reentrancy.** `donate`, `settle`, `withdraw`, `claimFees` and `sweep` are `nonReentrant`
  (OpenZeppelin `ReentrancyGuardTransient`). Tests cover re-entry from the messenger and from a
  swept token.
- **CCTP payouts.** `withdraw` approves exactly the net amount to the messenger with
  `forceApprove`, and passes a zero `destinationCaller`. It rejects a zero recipient and a
  `maxFee` that is not below the net amount.

## EURC payout domains

- **Why the list exists.** A CCTP V2 burn checks that the source chain supports the token and
  that a remote `TokenMessenger` exists for the destination domain. It does not check that the
  destination mints EURC. An EURC burn to a domain without EURC support may never mint, and the
  creator's funds would be stranded. USDC is supported on every CCTP domain, so USDC campaigns
  have no list and may pay out to any domain.
- **Set once at deploy.** The factory constructor takes `eurcPayoutDomains_` and stores each
  entry in `isEurcPayoutDomain`, emitting `EurcPayoutDomainSet(domain)` for each one. The
  constructor reverts with `InvalidDomain` if an entry is the Arc domain (26). There is no
  setter, so the owner gains no power over payouts.
- **What `withdraw` checks.** For an EURC campaign, a CCTP payout to a domain not in the list
  reverts with `UnsupportedPayoutDomain`. The check runs before the settle step and before any
  state change. Arc payouts are plain transfers and are always allowed. `canPayoutTo(destDomain)`
  returns the same answer, for the payout chain picker.
- **If Circle adds an EURC route.** Campaigns from this factory can never use it. The creator can
  still withdraw on Arc and bridge the funds themselves. Offering the new route directly needs a
  new factory deployment, and only campaigns created by that factory get it.
- **If Circle drops an EURC route.** The list cannot shrink either, so a listed domain would keep
  passing the check. The frontend should not offer a domain that Circle no longer supports.

## Arc-specific notes

- USDC and EURC are used only through the ERC-20 interface, with 6 decimals. No code reads
  native balances.
- No function is `payable`. There is no `receive` or `fallback`, and no code uses `msg.value`.
- No path transfers to `address(0)`. Arc payouts reject a zero recipient and a recipient with
  non-zero upper bytes.

## Accepted Slither findings

Command: `slither . --config-file slither.config.json` (excludes `lib/` and `test/`).

| Detector | Impact | Location | Reason accepted |
| --- | --- | --- | --- |
| `incorrect-equality` | Medium | `Campaign._settle`, `gross == 0` | Early return on a computed amount; anyone who makes it non-zero only causes a normal settlement. |
| `incorrect-equality` | Medium | `Campaign.claimFees`, `amount == 0` | Early return when no fees are owed; a non-zero value only leads to a normal claim. |
| `missing-zero-check` | Low | `Campaign.initialize`, `creator_` | Only the factory calls it, and it passes its own `msg.sender`, which is never zero. |

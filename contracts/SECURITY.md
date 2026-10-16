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
- Start, cancel or complete a creator recovery, or name a backup.

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
- **Reentrancy.** `donate`, `settle`, `withdraw`, `claimFees`, `sweep` and `completeRecovery` are `nonReentrant`
  (OpenZeppelin `ReentrancyGuardTransient`). Tests cover re-entry from the messenger and from a
  swept token.
- **Metadata links.** `imageUrl` (when set) and every entry in `links` must start with
  `https://`, so a page never renders a `javascript:` or plain `http://` link from storage.
- **Activity pointers.** Every campaign event ends with `prevActivityBlock`, which points to the
  previous block with campaign events. Only calls that emit an event move `lastActivityBlock`,
  so the pointer chain always lands on blocks with logs. The README describes the walk.
- **CCTP payouts.** `withdraw` approves exactly the net amount to the messenger with
  `forceApprove`, and passes a zero `destinationCaller`. It rejects a zero recipient and a
  `maxFee` that is not below the net amount.

## Creator recovery

A creator who loses their key would otherwise lock the campaign balance forever. Recovery hands
the creator role to a backup address after a wait that the creator can cancel.

- **Backup.** `createCampaign` takes an optional `backup`. Zero means no backup, and then no
  address can start a recovery. The backup must not be the creator (`InvalidBackup`). The
  creator can change or remove it at any time with `setBackup`.
- **Flow.** The backup calls `initiateRecovery`, which sets
  `recoveryReadyAt = block.timestamp + RECOVERY_DELAY` (7 days). A second call while one is
  pending reverts with `RecoveryPending`, so the backup cannot reset the clock. From
  `recoveryReadyAt` onwards (inclusive), the backup calls `completeRecovery` and becomes the
  creator. The new creator starts with no backup.
- **What the creator keeps during the wait.** The creator stays the creator until
  `completeRecovery` runs. Withdraw, edit, close and sweep keep working, and the backup has no
  creator power before that point. The creator can stop the recovery with `cancelRecovery`.
  Calling `setBackup` while a recovery is pending also cancels it, so a replaced or removed
  backup can never finish.
- **Trust in the backup.** A stolen backup key can only start a recovery. It takes the
  campaign only if the creator does not cancel within 7 days. A creator who no longer trusts
  the backup should remove or replace it. The app should alert the creator when
  `RecoveryInitiated` is emitted.
- **No funds move.** None of the recovery functions transfer tokens or change fees. The owner
  has no part in recovery.
- **Factory index.** `completeRecovery` calls `factory.recordCreatorChange`, which only a
  campaign created by the factory may call (`NotCampaign` otherwise). It adds the campaign to
  `campaignsOf(newCreator)` and emits `CampaignCreatorChanged`. The old creator's list keeps the
  entry, and a campaign can appear more than once in a list after repeated recoveries. The app
  filters `campaignsOf` by `summary().creator` and drops duplicates.

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
- No path transfers to `address(0)`. Arc payouts reject a zero recipient, a recipient with
  non-zero upper bytes, and the campaign itself. A payout to the campaign would come back as an
  unaccounted inflow and pay the donation fee a second time.
- Arc mainnet runs the opcodes this bytecode needs (`PUSH0`, `MCOPY`, `TSTORE`, `TLOAD`). This
  was checked on 2026-10-16 with `eth_call` state overrides against `https://rpc.mainnet.arc.io`.

## Accepted Slither findings

Command: `slither . --config-file slither.config.json` (excludes `lib/` and `test/`).

| Detector | Impact | Location | Reason accepted |
| --- | --- | --- | --- |
| `incorrect-equality` | Medium | `Campaign._settle`, `gross == 0` | Early return on a computed amount; anyone who makes it non-zero only causes a normal settlement. |
| `incorrect-equality` | Medium | `Campaign.claimFees`, `amount == 0` | Early return when no fees are owed; a non-zero value only leads to a normal claim. |
| `missing-zero-check` | Low | `Campaign.initialize`, `creator_` | Only the factory calls it, and it passes its own `msg.sender`, which is never zero. |
| `missing-zero-check` | Low | `Campaign.initialize`, `backup_` | Zero is a valid value that means no backup. |
| `timestamp` | Low | `Campaign.setBackup`, `initiateRecovery`, `cancelRecovery`, `completeRecovery` | The recovery wait is measured in `block.timestamp` by design. A validator can shift it by seconds, which does not matter against 7 days. The `recoveryReadyAt == 0` and `!= 0` checks only test whether a recovery is pending. |

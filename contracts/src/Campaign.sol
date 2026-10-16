// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {ICampaignFactory} from "./interfaces/ICampaignFactory.sol";
import {ITokenMessengerV2} from "./interfaces/ITokenMessengerV2.sol";
import {MetadataLib} from "./MetadataLib.sol";
import {Metadata, Summary} from "./Types.sol";

/// @notice One crowdfunding escrow, deployed by CampaignFactory as an EIP-1167 clone.
contract Campaign is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    error AlreadyInitialized();
    error NotCreator();
    error ZeroAmount();
    error CampaignClosed();
    error MessageTooLong();
    error InsufficientBalance();
    error InvalidRecipient();
    error FeeTooHighForAmount();
    error CannotSweepCampaignToken();
    error ZeroAddress();
    error InvalidGoal();
    error UnsupportedPayoutDomain();

    // Each event's last field, prevActivityBlock, is the block of the previous activity.
    // See lastActivityBlock for how to walk the history with it.
    event Donated(
        address indexed donor, uint256 amount, uint256 fee, uint256 tip, string message, uint64 prevActivityBlock
    );
    event ExternalDonationSettled(uint256 gross, uint256 fee, uint64 prevActivityBlock);
    event Withdrawn(
        uint32 indexed destDomain,
        bytes32 indexed recipient,
        uint256 amount,
        uint256 fee,
        uint256 net,
        uint64 prevActivityBlock
    );
    event Closed(uint64 prevActivityBlock);
    event FeesClaimed(address indexed treasury, uint256 amount, uint64 prevActivityBlock);
    event Swept(address indexed token, address indexed to, uint256 amount, uint64 prevActivityBlock);
    event Edited(uint256 goal, uint64 prevActivityBlock);

    uint256 public constant BPS = 10_000;
    /// @notice CCTP domain of Arc. Withdrawals to this domain are plain transfers.
    uint32 public constant ARC_DOMAIN = 26;
    uint256 public constant MAX_MESSAGE_LENGTH = 280;

    bool private initialized;
    ICampaignFactory public factory;
    address public creator;
    IERC20 public token;
    uint256 public goal;
    uint16 public donationFeeBps;
    uint16 public withdrawFeeBps;
    uint64 public createdAt;
    bool public closed;
    /// @notice Block of the latest call that emitted a Campaign event. Set to createdAtBlock at creation.
    /// @dev Every Campaign event carries prevActivityBlock: the latest activity block before the
    /// block it was emitted in, or createdAtBlock for events in the creation block. All events in
    /// one block carry the same value. To read the whole history with eth_getLogs:
    /// 1. Set `to = lastActivityBlock`.
    /// 2. Fetch the campaign's logs from `from = max(createdAtBlock, to - 9999)` to `to`.
    /// 3. If `from == createdAtBlock`, stop. Otherwise set `to` to the prevActivityBlock of the
    ///    earliest log returned and go to step 2.
    /// Blocks with no activity are skipped, so each call returns at least one event.
    uint64 public lastActivityBlock;
    /// @dev prevActivityBlock for events emitted in lastActivityBlock.
    uint64 private activityPrevBlock;
    /// @notice Block in which the campaign was created.
    uint64 public createdAtBlock;
    Metadata private meta;

    /// @notice Donation amounts before fees, tips excluded. Settled inflows are added here.
    uint256 public grossDonated;
    /// @notice Net amount the creator can withdraw.
    uint256 public creatorBalance;
    /// @notice Donation fees, tips and withdrawal fees not yet claimed by the treasury.
    uint256 public feesAccrued;
    /// @notice Total amount the creator has withdrawn.
    uint256 public withdrawn;

    /// @dev Locks the implementation so only clones can be initialized.
    constructor() {
        initialized = true;
    }

    /// @notice Called once by the factory in the same transaction that deploys the clone.
    /// @dev creator_ is the factory's msg.sender, so it is never zero.
    // forge-lint: disable-next-item(missing-zero-check)
    function initialize(
        address creator_,
        IERC20 token_,
        uint256 goal_,
        uint16 donationFeeBps_,
        uint16 withdrawFeeBps_,
        Metadata calldata meta_
    ) external {
        if (initialized) revert AlreadyInitialized();
        initialized = true;
        MetadataLib.validate(meta_);

        factory = ICampaignFactory(msg.sender);
        creator = creator_;
        token = token_;
        goal = goal_;
        donationFeeBps = donationFeeBps_;
        withdrawFeeBps = withdrawFeeBps_;
        // forge-lint: disable-next-line(unsafe-typecast)
        createdAt = uint64(block.timestamp);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 blockNumber = uint64(block.number);
        createdAtBlock = blockNumber;
        lastActivityBlock = blockNumber;
        activityPrevBlock = blockNumber;
        _setMeta(meta_);
    }

    modifier onlyCreator() {
        _checkCreator();
        _;
    }

    /// @notice Donates `amount` towards the goal plus an optional `tip` for the platform.
    /// @dev The caller must approve `amount + tip`. The donation fee is taken from `amount`.
    function donate(uint256 amount, uint256 tip, string calldata message) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (closed) revert CampaignClosed();
        if (bytes(message).length > MAX_MESSAGE_LENGTH) revert MessageTooLong();
        _settle();

        uint256 fee = amount * donationFeeBps / BPS;
        grossDonated += amount;
        creatorBalance += amount - fee;
        feesAccrued += fee + tip;
        emit Donated(msg.sender, amount, fee, tip, message, _activity());

        token.safeTransferFrom(msg.sender, address(this), amount + tip);
    }

    /// @notice Books any unaccounted tokens as a gross donation, charging the donation fee.
    /// @dev Anyone can call it. It reverts only on reentrancy. The internal _settle() never
    /// reverts, which is why it is safe to call before every payout.
    function settle() external nonReentrant returns (uint256 gross) {
        return _settle();
    }

    /// @dev Body of settle(), for callers that already hold the reentrancy lock.
    function _settle() internal returns (uint256 gross) {
        gross = unaccounted();
        if (gross == 0) return 0;
        uint256 fee = gross * donationFeeBps / BPS;
        grossDonated += gross;
        creatorBalance += gross - fee;
        feesAccrued += fee;
        emit ExternalDonationSettled(gross, fee, _activity());
    }

    /// @notice Pays `amount` of the creator balance, less the withdrawal fee, to `recipient`.
    /// @param destDomain ARC_DOMAIN for a plain transfer on Arc, any other CCTP domain to burn and mint there.
    /// An EURC campaign reverts with UnsupportedPayoutDomain for a domain that canPayoutTo rejects.
    /// @param recipient Left-padded address on Arc, or the CCTP `mintRecipient` on other chains.
    /// @param maxFee CCTP fast-transfer fee cap. Ignored on Arc.
    /// @param minFinalityThreshold CCTP finality threshold. Ignored on Arc.
    /// @param hookData Empty for `depositForBurn`, otherwise passed to `depositForBurnWithHook`.
    function withdraw(
        uint256 amount,
        uint32 destDomain,
        bytes32 recipient,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external nonReentrant onlyCreator {
        if (!canPayoutTo(destDomain)) revert UnsupportedPayoutDomain();
        _settle();
        if (amount == 0) revert ZeroAmount();
        if (amount > creatorBalance) revert InsufficientBalance();

        uint256 fee = amount * withdrawFeeBps / BPS;
        uint256 net = amount - fee;

        if (destDomain == ARC_DOMAIN) {
            if (uint256(recipient) >> 160 != 0 || recipient == bytes32(0)) revert InvalidRecipient();
            if (address(uint160(uint256(recipient))) == address(this)) revert InvalidRecipient();
        } else {
            if (recipient == bytes32(0)) revert InvalidRecipient();
            if (maxFee >= net) revert FeeTooHighForAmount();
        }

        creatorBalance -= amount;
        feesAccrued += fee;
        withdrawn += amount;
        emit Withdrawn(destDomain, recipient, amount, fee, net, _activity());

        if (destDomain == ARC_DOMAIN) {
            token.safeTransfer(address(uint160(uint256(recipient))), net);
        } else {
            ITokenMessengerV2 messenger = factory.tokenMessenger();
            token.forceApprove(address(messenger), net);
            if (hookData.length == 0) {
                messenger.depositForBurn(
                    net, destDomain, recipient, address(token), bytes32(0), maxFee, minFinalityThreshold
                );
            } else {
                messenger.depositForBurnWithHook(
                    net, destDomain, recipient, address(token), bytes32(0), maxFee, minFinalityThreshold, hookData
                );
            }
        }
    }

    /// @notice Sends all accrued fees and tips to the factory's current treasury. Anyone can call it.
    /// @dev Settles first so pending inflows pay their donation fee. Returns 0 and does nothing when no fees are owed.
    function claimFees() external nonReentrant returns (uint256 amount) {
        _settle();
        amount = feesAccrued;
        if (amount == 0) return 0;
        address treasury = factory.treasury();
        feesAccrued = 0;
        emit FeesClaimed(treasury, amount, _activity());
        token.safeTransfer(treasury, amount);
    }

    /// @notice Sends the whole balance of a token that is not the campaign token to `to`, with no fee.
    /// @dev Also reverts if the transfer lowers the campaign token balance, in case another
    /// address can move the same underlying asset.
    function sweep(IERC20 other, address to) external nonReentrant onlyCreator {
        if (other == token) revert CannotSweepCampaignToken();
        if (to == address(0)) revert ZeroAddress();
        uint256 before = token.balanceOf(address(this));
        uint256 amount = other.balanceOf(address(this));
        emit Swept(address(other), to, amount, _activity());
        other.safeTransfer(to, amount);
        if (token.balanceOf(address(this)) < before) revert CannotSweepCampaignToken();
    }

    /// @notice Replaces the goal and all metadata. Creator only, while the campaign is open.
    function edit(uint256 goal_, Metadata calldata meta_) external onlyCreator {
        if (closed) revert CampaignClosed();
        if (goal_ == 0) revert InvalidGoal();
        MetadataLib.validate(meta_);
        goal = goal_;
        _setMeta(meta_);
        emit Edited(goal_, _activity());
    }

    /// @notice Ends the campaign for new donate() calls. One-way. Withdrawals stay open.
    function close() external onlyCreator {
        if (closed) revert CampaignClosed();
        closed = true;
        emit Closed(_activity());
    }

    /// @notice Campaign tokens held but not yet booked (plain transfers, CCTP or Gateway mints).
    /// @dev Saturates at zero so settle() and the views never revert if the balance drifts below the counters.
    function unaccounted() public view returns (uint256) {
        uint256 balance = token.balanceOf(address(this));
        uint256 booked = creatorBalance + feesAccrued;
        return balance > booked ? balance - booked : 0;
    }

    /// @notice Whether withdraw accepts `destDomain`. Arc is always allowed, a USDC campaign may
    /// pay out to any CCTP domain, and an EURC campaign only to the factory's fixed EURC list.
    function canPayoutTo(uint32 destDomain) public view returns (bool) {
        if (destDomain == ARC_DOMAIN) return true;
        if (token != factory.eurc()) return true;
        return factory.isEurcPayoutDomain(destDomain);
    }

    /// @notice Gross amount raised. Withdrawals never reduce it.
    function raised() public view returns (uint256) {
        return grossDonated + unaccounted();
    }

    /// @notice What the creator could withdraw after settling, before the withdrawal fee.
    function available() public view returns (uint256) {
        uint256 u = unaccounted();
        return creatorBalance + u - (u * donationFeeBps / BPS);
    }

    function summary() external view returns (Summary memory) {
        return Summary({
            creator: creator,
            token: address(token),
            goal: goal,
            raised: raised(),
            available: available(),
            withdrawn: withdrawn,
            closed: closed,
            donationFeeBps: donationFeeBps,
            withdrawFeeBps: withdrawFeeBps,
            createdAt: createdAt,
            createdAtBlock: createdAtBlock,
            meta: meta
        });
    }

    /// @dev Moves lastActivityBlock to this block and returns the prevActivityBlock for its
    /// events. Only the first call in a block changes storage. Call it only next to an emit.
    function _activity() internal returns (uint64) {
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 current = uint64(block.number);
        if (lastActivityBlock != current) {
            activityPrevBlock = lastActivityBlock;
            lastActivityBlock = current;
        }
        return activityPrevBlock;
    }

    function _checkCreator() internal view {
        if (msg.sender != creator) revert NotCreator();
    }

    /// @dev Copies validated metadata into storage, replacing any previous links.
    function _setMeta(Metadata calldata meta_) internal {
        meta.title = meta_.title;
        meta.description = meta_.description;
        meta.imageUrl = meta_.imageUrl;
        delete meta.links;
        for (uint256 i = 0; i < meta_.links.length; ++i) {
            meta.links.push(meta_.links[i]);
        }
    }
}

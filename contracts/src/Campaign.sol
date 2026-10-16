// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ICampaignFactory} from "./interfaces/ICampaignFactory.sol";
import {MetadataLib} from "./MetadataLib.sol";
import {Metadata, Summary} from "./Types.sol";

/// @notice One crowdfunding escrow, deployed by CampaignFactory as an EIP-1167 clone.
contract Campaign {
    error AlreadyInitialized();

    uint256 public constant BPS = 10_000;

    bool private initialized;
    ICampaignFactory public factory;
    address public creator;
    IERC20 public token;
    uint256 public goal;
    uint16 public donationFeeBps;
    uint16 public withdrawFeeBps;
    uint64 public createdAt;
    // forge-lint: disable-next-line(uninitialized-state)
    bool public closed;
    Metadata private meta;

    /// @notice Donation amounts before fees, tips excluded. Settled inflows are added here.
    // forge-lint: disable-next-line(uninitialized-state)
    uint256 public grossDonated;
    /// @notice Net amount the creator can withdraw.
    // forge-lint: disable-next-line(uninitialized-state)
    uint256 public creatorBalance;
    /// @notice Donation fees, tips and withdrawal fees not yet claimed by the treasury.
    // forge-lint: disable-next-line(uninitialized-state)
    uint256 public feesAccrued;
    /// @notice Total amount the creator has withdrawn.
    // forge-lint: disable-next-line(uninitialized-state)
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
        _setMeta(meta_);
    }

    /// @notice Campaign tokens held but not yet booked (plain transfers, CCTP or Gateway mints).
    function unaccounted() public view returns (uint256) {
        return token.balanceOf(address(this)) - creatorBalance - feesAccrued;
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
            meta: meta
        });
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

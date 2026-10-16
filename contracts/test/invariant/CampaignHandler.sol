// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {Vm} from "forge-std/Vm.sol";
import {Campaign} from "../../src/Campaign.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @notice Drives one USDC campaign through every money path and keeps ghost totals that the
/// invariants compare with the campaign's own books. Fee ghosts are read from the campaign's
/// events, so they measure what the contract charged rather than re-deriving it.
// forge-lint: disable-start(erc20-unchecked-transfer, unused-return)
contract CampaignHandler is CommonBase, StdCheats, StdUtils {
    uint32 internal constant ARC = 26;
    uint32 internal constant BASE_DOMAIN = 6;
    uint256 internal constant MAX_AMOUNT = 1_000_000e6;
    uint256 internal constant MAX_TIP = 1_000e6;

    Campaign public immutable campaign;
    MockERC20 public immutable usdc;
    MockERC20 public immutable eurc;
    address public immutable creator;
    address public immutable treasury;

    address[3] internal donors;
    bool public treasuryBlocked;

    /// @notice Every campaign token that entered the campaign: donations, tips and bridged mints.
    uint256 public ghostInflows;
    /// @notice Net amounts that left the campaign to the creator's recipients or the messenger.
    uint256 public ghostPaidOut;
    /// @notice Amounts paid to the treasury by claimFees.
    uint256 public ghostFeesClaimed;
    uint256 public ghostTips;
    /// @notice Sum of the fee field of Donated and ExternalDonationSettled events.
    uint256 public ghostDonationFees;
    /// @notice Sum of the fee field of Withdrawn events.
    uint256 public ghostWithdrawFees;

    uint256 public lastRaised;
    bool public raisedDecreased;

    mapping(bytes32 => uint256) public calls;
    mapping(bytes32 => uint256) public skips;

    // forge-lint: disable-next-item(missing-zero-check)
    constructor(Campaign campaign_, MockERC20 usdc_, MockERC20 eurc_, address treasury_) {
        campaign = campaign_;
        usdc = usdc_;
        eurc = eurc_;
        creator = campaign_.creator();
        treasury = treasury_;
        donors[0] = makeAddr("donor0");
        donors[1] = makeAddr("donor1");
        donors[2] = makeAddr("donor2");
    }

    /// @dev Records the campaign's fee events and checks raised() after every action.
    modifier tracked(bytes32 name) {
        calls[name]++;
        vm.recordLogs();
        _;
        _readFeeEvents();
        uint256 r = campaign.raised();
        if (r < lastRaised) raisedDecreased = true;
        lastRaised = r;
    }

    function donate(uint256 seed, uint256 amount, uint256 tip) external tracked("donate") {
        address donor = donors[seed % donors.length];
        amount = bound(amount, 1, MAX_AMOUNT);
        tip = bound(tip, 0, MAX_TIP);
        usdc.mint(donor, amount + tip);
        vm.startPrank(donor);
        usdc.approve(address(campaign), amount + tip);
        campaign.donate(amount, tip, "");
        vm.stopPrank();
        ghostInflows += amount + tip;
        ghostTips += tip;
    }

    /// @dev A CCTP or Gateway mint straight to the campaign, with no call into it.
    function bridgeIn(uint256 amount) external tracked("bridgeIn") {
        amount = bound(amount, 1, MAX_AMOUNT);
        usdc.mint(address(campaign), amount);
        ghostInflows += amount;
    }

    function settle() external tracked("settle") {
        campaign.settle();
    }

    function withdrawArc(uint256 amount) external tracked("withdrawArc") {
        uint256 avail = campaign.available();
        if (avail == 0) {
            skips["withdrawArc"]++;
            return;
        }
        amount = bound(amount, 1, avail);
        uint256 before = usdc.balanceOf(creator);
        vm.prank(creator);
        campaign.withdraw(amount, ARC, bytes32(uint256(uint160(creator))), 0, 0, "");
        ghostPaidOut += usdc.balanceOf(creator) - before;
    }

    function withdrawCctp(uint256 amount) external tracked("withdrawCctp") {
        uint256 avail = campaign.available();
        if (avail == 0) {
            skips["withdrawCctp"]++;
            return;
        }
        amount = bound(amount, 1, avail);
        address messenger = address(campaign.factory().tokenMessenger());
        uint256 before = usdc.balanceOf(messenger);
        vm.prank(creator);
        campaign.withdraw(amount, BASE_DOMAIN, bytes32(uint256(0xBEEF)), 0, 1000, "");
        ghostPaidOut += usdc.balanceOf(messenger) - before;
    }

    /// @dev Anyone can call claimFees. A blocked treasury must make it revert and leave the
    /// books intact; any other revert is a bug.
    function claimFees() external tracked("claimFees") {
        uint256 before = usdc.balanceOf(treasury);
        try campaign.claimFees() returns (uint256 amount) {
            uint256 received = usdc.balanceOf(treasury) - before;
            require(received == amount, "claim amount mismatch");
            ghostFeesClaimed += received;
        } catch (bytes memory err) {
            require(treasuryBlocked, "claimFees reverted with an open treasury");
            require(
                keccak256(err) == keccak256(abi.encodeWithSelector(MockERC20.Blocked.selector, treasury)),
                "unexpected claimFees revert"
            );
            // The recorder keeps events from reverted calls; drop them so the rolled-back
            // settle is not counted as a fee.
            vm.getRecordedLogs();
            skips["claimFees"]++;
        }
    }

    function toggleTreasuryBlocked() external tracked("toggleTreasuryBlocked") {
        treasuryBlocked = !treasuryBlocked;
        usdc.setBlocked(treasury, treasuryBlocked);
    }

    /// @dev EURC sent to a USDC campaign by mistake. It must never reach the USDC books.
    function strayTransfer(uint256 amount) external tracked("strayTransfer") {
        amount = bound(amount, 1, MAX_AMOUNT);
        eurc.mint(address(campaign), amount);
    }

    function _readFeeEvents() internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].emitter != address(campaign)) continue;
            bytes32 sig = logs[i].topics[0];
            if (sig == Campaign.Donated.selector) {
                (, uint256 fee,,) = abi.decode(logs[i].data, (uint256, uint256, uint256, string));
                ghostDonationFees += fee;
            } else if (sig == Campaign.ExternalDonationSettled.selector) {
                (, uint256 fee) = abi.decode(logs[i].data, (uint256, uint256));
                ghostDonationFees += fee;
            } else if (sig == Campaign.Withdrawn.selector) {
                (, uint256 fee,) = abi.decode(logs[i].data, (uint256, uint256, uint256));
                ghostWithdrawFees += fee;
            }
        }
    }
}
// forge-lint: disable-end(erc20-unchecked-transfer, unused-return)

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base} from "./helpers/Base.t.sol";
import {Campaign} from "../src/Campaign.sol";

// Test-only false positives: expected-event emits and ignored return values in revert checks.
// forge-lint: disable-start(reentrancy-events, unused-return)
contract CampaignDonateTest is Base {
    Campaign internal campaign;

    function setUp() public override {
        super.setUp();
        campaign = Campaign(_create(IERC20(address(usdc)), 1_000e6));
    }

    function _donate(address donor, uint256 amount, uint256 tip, string memory message) internal {
        usdc.mint(donor, amount + tip);
        vm.startPrank(donor);
        usdc.approve(address(campaign), amount + tip);
        campaign.donate(amount, tip, message);
        vm.stopPrank();
    }

    // The donation fee comes out of the amount, the tip goes to fees in full, and only
    // the amount counts towards the goal.
    function test_Donate_SplitsFeeAndTip() public {
        usdc.mint(bob, 105e6);
        vm.startPrank(bob);
        usdc.approve(address(campaign), 105e6);
        vm.expectEmit(true, true, true, true, address(campaign));
        emit Campaign.Donated(bob, 100e6, 2.5e6, 5e6, "good luck");
        campaign.donate(100e6, 5e6, "good luck");
        vm.stopPrank();

        assertEq(campaign.creatorBalance(), 97.5e6);
        assertEq(campaign.feesAccrued(), 2.5e6 + 5e6);
        assertEq(campaign.grossDonated(), 100e6);
        assertEq(campaign.raised(), 100e6);
        assertEq(usdc.balanceOf(address(campaign)), 105e6);
    }

    // Closing is a promise to donors that no new money is taken in.
    function test_Donate_RevertsWhenClosed() public {
        vm.prank(alice);
        campaign.close();

        usdc.mint(bob, 10e6);
        vm.startPrank(bob);
        usdc.approve(address(campaign), 10e6);
        vm.expectRevert(Campaign.CampaignClosed.selector);
        campaign.donate(10e6, 0, "");
        vm.stopPrank();
    }

    // A zero donation would emit a misleading event, so it is rejected even with a tip.
    function test_Donate_RevertsZero() public {
        usdc.mint(bob, 1e6);
        vm.startPrank(bob);
        usdc.approve(address(campaign), 1e6);
        vm.expectRevert(Campaign.ZeroAmount.selector);
        campaign.donate(0, 1e6, "");
        vm.stopPrank();
    }

    // Messages are capped at 280 bytes so donors cannot bloat the event log.
    function test_Donate_RevertsLongMessage() public {
        bytes memory long = new bytes(281);
        for (uint256 i = 0; i < long.length; ++i) {
            long[i] = "a";
        }
        usdc.mint(bob, 10e6);
        vm.startPrank(bob);
        usdc.approve(address(campaign), 10e6);
        vm.expectRevert(Campaign.MessageTooLong.selector);
        campaign.donate(10e6, 0, string(long));

        // Exactly 280 bytes is allowed.
        bytes memory max = new bytes(280);
        for (uint256 i = 0; i < max.length; ++i) {
            max[i] = "a";
        }
        campaign.donate(10e6, 0, string(max));
        vm.stopPrank();
        assertEq(campaign.grossDonated(), 10e6);
    }

    // Every token the campaign holds must be booked to either the creator or the treasury.
    function testFuzz_Donate_Accounting(uint96 amount96, uint96 tip96) public {
        uint256 amount = bound(amount96, 1, type(uint96).max);
        uint256 tip = tip96;
        _donate(bob, amount, tip, "");

        uint256 fee = amount * DONATION_FEE_BPS / 10_000;
        assertEq(usdc.balanceOf(address(campaign)), campaign.creatorBalance() + campaign.feesAccrued());
        assertEq(campaign.creatorBalance(), amount - fee);
        assertEq(campaign.feesAccrued(), fee + tip);
        assertEq(campaign.unaccounted(), 0);
    }

    // Bridged and plain-transfer inflows pay the same donation fee as donate().
    function test_Settle_ChargesFeeOnDirectTransfer() public {
        usdc.mint(address(campaign), 40e6);
        assertEq(campaign.unaccounted(), 40e6);
        assertEq(campaign.raised(), 40e6);
        assertEq(campaign.available(), 39e6);

        vm.expectEmit(true, true, true, true, address(campaign));
        emit Campaign.ExternalDonationSettled(40e6, 1e6);
        assertEq(campaign.settle(), 40e6);

        assertEq(campaign.creatorBalance(), 39e6);
        assertEq(campaign.feesAccrued(), 1e6);
        assertEq(campaign.grossDonated(), 40e6);
        assertEq(campaign.unaccounted(), 0);
        assertEq(campaign.raised(), 40e6);
        assertEq(campaign.settle(), 0);
    }

    // donate() settles pending inflows first, so they are not mixed into the new donation.
    function test_Donate_SettlesPendingInflowFirst() public {
        usdc.mint(address(campaign), 40e6);
        _donate(bob, 100e6, 0, "");

        assertEq(campaign.grossDonated(), 140e6);
        assertEq(campaign.creatorBalance(), 39e6 + 97.5e6);
        assertEq(campaign.feesAccrued(), 1e6 + 2.5e6);
        assertEq(campaign.unaccounted(), 0);
    }

    // If the balance ever falls below the booked counters (for example a token-level seizure),
    // settle and the views must not revert, so withdrawals of what is left stay possible.
    function test_Settle_DoesNotRevertOnAccountingDrift() public {
        _donate(bob, 100e6, 0, "");
        deal(address(usdc), address(campaign), 50e6);

        assertEq(campaign.unaccounted(), 0);
        assertEq(campaign.settle(), 0);
        assertEq(campaign.raised(), 100e6);
        assertEq(campaign.available(), 97.5e6);
        assertEq(campaign.creatorBalance(), 97.5e6);
        assertEq(campaign.feesAccrued(), 2.5e6);
    }
}
// forge-lint: disable-end(reentrancy-events, unused-return)

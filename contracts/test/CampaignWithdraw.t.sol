// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base} from "./helpers/Base.t.sol";
import {Campaign} from "../src/Campaign.sol";

// Test-only false positives: expected-event emits and ignored return values in revert checks.
// forge-lint: disable-start(reentrancy-events, unused-return)
contract CampaignWithdrawTest is Base {
    uint32 internal constant ARC = 26;
    uint32 internal constant BASE_DOMAIN = 6;

    Campaign internal campaign;
    bytes32 internal aliceB32;

    function setUp() public override {
        super.setUp();
        campaign = Campaign(_create(IERC20(address(usdc)), 1_000e6));
        aliceB32 = bytes32(uint256(uint160(alice)));
    }

    function _donate(uint256 amount) internal {
        usdc.mint(bob, amount);
        vm.startPrank(bob);
        usdc.approve(address(campaign), amount);
        campaign.donate(amount, 0, "");
        vm.stopPrank();
    }

    function _assertBooked() internal view {
        assertEq(
            usdc.balanceOf(address(campaign)),
            campaign.creatorBalance() + campaign.feesAccrued() + campaign.unaccounted()
        );
    }

    // The creator gets the amount less the withdrawal fee; the fee stays for the treasury
    // and the public "raised" figure is unchanged by the payout.
    function test_Withdraw_Arc_PaysNetAndAccruesFee() public {
        _donate(100e6);

        vm.expectEmit(true, true, true, true, address(campaign));
        emit Campaign.Withdrawn(ARC, aliceB32, 97.5e6, 0.975e6, 97.5e6 - 0.975e6);
        vm.prank(alice);
        campaign.withdraw(97.5e6, ARC, aliceB32, 0, 0, "");

        assertEq(usdc.balanceOf(alice), 97.5e6 - 0.975e6);
        assertEq(campaign.withdrawn(), 97.5e6);
        assertEq(campaign.raised(), 100e6);
        assertEq(campaign.creatorBalance(), 0);
        assertEq(campaign.feesAccrued(), 2.5e6 + 0.975e6);
        _assertBooked();
    }

    // available() is a promise: withdrawing exactly that figure must succeed even when part
    // of it is an unsettled inflow.
    function test_Withdraw_SettlesPendingInflowFirst() public {
        _donate(10e6);
        usdc.mint(address(campaign), 10e6);

        uint256 avail = campaign.available();
        assertEq(avail, 9.75e6 * 2);
        vm.prank(alice);
        campaign.withdraw(avail, ARC, aliceB32, 0, 0, "");

        assertEq(campaign.creatorBalance(), 0);
        assertEq(campaign.unaccounted(), 0);
        assertEq(campaign.raised(), 20e6);
        _assertBooked();
    }

    // Only the creator can move campaign funds.
    function test_Withdraw_OnlyCreator() public {
        _donate(10e6);
        vm.prank(bob);
        vm.expectRevert(Campaign.NotCreator.selector);
        campaign.withdraw(1e6, ARC, bytes32(uint256(uint160(bob))), 0, 0, "");
    }

    // The creator can never take the treasury's fees.
    function test_Withdraw_RevertsOverBalance() public {
        _donate(10e6);
        vm.startPrank(alice);
        vm.expectRevert(Campaign.InsufficientBalance.selector);
        campaign.withdraw(9.75e6 + 1, ARC, aliceB32, 0, 0, "");
        vm.expectRevert(Campaign.ZeroAmount.selector);
        campaign.withdraw(0, ARC, aliceB32, 0, 0, "");
        vm.stopPrank();
    }

    // On Arc the recipient is an address; dirty upper bytes mean a caller bug, and zero
    // would burn the funds.
    function test_Withdraw_Arc_RevertsDirtyRecipient() public {
        _donate(10e6);
        vm.startPrank(alice);
        bytes32 dirty = aliceB32 | bytes32(uint256(1) << 200);
        vm.expectRevert(Campaign.InvalidRecipient.selector);
        campaign.withdraw(1e6, ARC, dirty, 0, 0, "");
        vm.expectRevert(Campaign.InvalidRecipient.selector);
        campaign.withdraw(1e6, ARC, bytes32(0), 0, 0, "");
        vm.stopPrank();
    }

    // Bridged donations can land after the creator closes, and must not be stuck.
    function test_Withdraw_Allowed_AfterClose() public {
        _donate(10e6);
        vm.prank(alice);
        campaign.close();
        assertTrue(campaign.closed());
        usdc.mint(address(campaign), 10e6);

        uint256 avail = campaign.available();
        vm.prank(alice);
        campaign.withdraw(avail, ARC, aliceB32, 0, 0, "");
        assertEq(campaign.creatorBalance(), 0);
        assertEq(usdc.balanceOf(alice), avail - avail * WITHDRAW_FEE_BPS / 10_000);
        _assertBooked();
    }

    // close() is one-way and creator only.
    function test_Close_OnlyCreatorAndOnce() public {
        vm.prank(bob);
        vm.expectRevert(Campaign.NotCreator.selector);
        campaign.close();

        vm.startPrank(alice);
        vm.expectEmit(true, true, true, true, address(campaign));
        emit Campaign.Closed();
        campaign.close();
        vm.expectRevert(Campaign.CampaignClosed.selector);
        campaign.close();
        vm.stopPrank();
    }

    // Cross-chain payouts burn exactly the net through CCTP with no destination caller.
    function test_Withdraw_CCTP_CallsMessenger() public {
        _donate(100e6);
        bytes32 recipient = bytes32(uint256(0xBEEF));
        uint256 net = 50e6 - 0.5e6;

        vm.expectEmit(true, true, true, true, address(campaign));
        emit Campaign.Withdrawn(BASE_DOMAIN, recipient, 50e6, 0.5e6, net);
        vm.prank(alice);
        campaign.withdraw(50e6, BASE_DOMAIN, recipient, 1e6, 1000, "");

        assertEq(messenger.calls(), 1);
        assertEq(messenger.lastAmount(), net);
        assertEq(messenger.lastDomain(), BASE_DOMAIN);
        assertEq(messenger.lastBurnToken(), address(usdc));
        assertEq(messenger.lastRecipient(), recipient);
        assertEq(messenger.lastMaxFee(), 1e6);
        assertEq(messenger.lastMinFinality(), 1000);
        assertEq(messenger.lastHookData().length, 0);
        assertEq(messenger.lastDestinationCaller(), bytes32(0));
        assertEq(usdc.balanceOf(address(messenger)), net);
        assertEq(usdc.allowance(address(campaign), address(messenger)), 0);
        assertEq(campaign.creatorBalance(), 97.5e6 - 50e6);
        _assertBooked();
    }

    // Hook data selects depositForBurnWithHook so Circle's forwarder can mint on arrival.
    function test_Withdraw_CCTP_WithHook() public {
        _donate(100e6);
        bytes32 recipient = bytes32(uint256(0xBEEF));
        vm.prank(alice);
        campaign.withdraw(50e6, BASE_DOMAIN, recipient, 1e6, 1000, hex"cafe");

        assertEq(messenger.calls(), 1);
        assertEq(messenger.lastAmount(), 50e6 - 0.5e6);
        assertEq(messenger.lastHookData(), hex"cafe");
        assertEq(messenger.lastDestinationCaller(), bytes32(0));
        assertEq(usdc.allowance(address(campaign), address(messenger)), 0);
        _assertBooked();
    }

    // An EURC campaign must burn EURC, never the USDC the factory also knows about.
    function test_Withdraw_CCTP_EurcBurnsEurc() public {
        Campaign ec = Campaign(_create(IERC20(address(eurc)), 1_000e6));
        eurc.mint(address(ec), 100e6);
        vm.prank(alice);
        ec.withdraw(50e6, BASE_DOMAIN, bytes32(uint256(0xBEEF)), 1e6, 1000, "");

        assertEq(messenger.lastBurnToken(), address(eurc));
        assertEq(messenger.lastAmount(), 50e6 - 0.5e6);
        assertEq(eurc.balanceOf(address(messenger)), 50e6 - 0.5e6);
        assertEq(usdc.balanceOf(address(messenger)), 0);
    }

    // A zero CCTP recipient would burn funds with no one able to mint them.
    function test_Withdraw_CCTP_RevertsZeroRecipient() public {
        _donate(100e6);
        vm.prank(alice);
        vm.expectRevert(Campaign.InvalidRecipient.selector);
        campaign.withdraw(50e6, BASE_DOMAIN, bytes32(0), 1e6, 1000, "");
    }

    // If the relayer fee could swallow the whole net, the creator would receive nothing.
    function test_Withdraw_CCTP_RevertsMaxFeeNotBelowNet() public {
        _donate(100e6);
        uint256 net = 50e6 - 0.5e6;
        vm.startPrank(alice);
        vm.expectRevert(Campaign.FeeTooHighForAmount.selector);
        campaign.withdraw(50e6, BASE_DOMAIN, bytes32(uint256(0xBEEF)), net, 1000, "");
        vm.stopPrank();
    }
}
// forge-lint: disable-end(reentrancy-events, unused-return)

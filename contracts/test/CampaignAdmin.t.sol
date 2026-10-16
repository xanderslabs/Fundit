// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base} from "./helpers/Base.t.sol";
import {Campaign} from "../src/Campaign.sol";
import {MetadataLib} from "../src/MetadataLib.sol";
import {Metadata, Summary} from "../src/Types.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockAliasToken} from "./mocks/MockAliasToken.sol";

// Test-only false positives: expected-event emits and ignored return values in revert checks.
// forge-lint: disable-start(reentrancy-events, unused-return)
contract CampaignAdminTest is Base {
    uint32 internal constant ARC = 26;
    uint32 internal constant BASE_DOMAIN = 6;

    Campaign internal campaign;
    bytes32 internal aliceB32;

    function setUp() public override {
        super.setUp();
        campaign = Campaign(_create(IERC20(address(usdc)), 1_000e6));
        aliceB32 = bytes32(uint256(uint160(alice)));
    }

    function _donate(uint256 amount, uint256 tip) internal {
        usdc.mint(bob, amount + tip);
        vm.startPrank(bob);
        usdc.approve(address(campaign), amount + tip);
        campaign.donate(amount, tip, "");
        vm.stopPrank();
    }

    function _assertBooked() internal view {
        assertEq(
            usdc.balanceOf(address(campaign)),
            campaign.creatorBalance() + campaign.feesAccrued() + campaign.unaccounted()
        );
    }

    // Fees are pulled to whatever treasury the factory names at claim time, so rotating
    // the treasury never strands fees accrued earlier. An unsettled inflow is settled first
    // so its donation fee is included in the claim.
    function test_ClaimFees_SendsToCurrentTreasury() public {
        _donate(100e6, 1e6);
        usdc.mint(address(campaign), 10e6);
        address newTreasury = makeAddr("newTreasury");
        vm.prank(owner);
        factory.setTreasury(newTreasury);

        uint256 expected = 2.5e6 + 1e6 + 0.25e6;
        vm.expectEmit(true, true, true, true, address(campaign));
        emit Campaign.FeesClaimed(newTreasury, expected, campaign.createdAtBlock());
        vm.prank(bob);
        uint256 amount = campaign.claimFees();

        assertEq(amount, expected);
        assertEq(usdc.balanceOf(newTreasury), expected);
        assertEq(usdc.balanceOf(treasury), 0);
        assertEq(campaign.feesAccrued(), 0);
        assertEq(campaign.creatorBalance(), 97.5e6 + 9.75e6);
        _assertBooked();
    }

    // With nothing owed, a claim must not transfer or emit, so calling it is always safe.
    function test_ClaimFees_ZeroIsNoop() public {
        vm.recordLogs();
        uint256 amount = campaign.claimFees();
        assertEq(amount, 0);
        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(usdc.balanceOf(treasury), 0);
    }

    // A blacklisted or broken treasury may only block fee claims. Donors and the creator
    // must never depend on it.
    function test_RevertingTreasury_DoesNotBlockDonateOrWithdraw() public {
        usdc.setBlocked(treasury, true);

        _donate(100e6, 1e6);
        usdc.mint(address(campaign), 10e6);
        campaign.settle();

        vm.startPrank(alice);
        campaign.withdraw(10e6, ARC, aliceB32, 0, 0, "");
        campaign.withdraw(10e6, BASE_DOMAIN, bytes32(uint256(0xBEEF)), 1e6, 1000, "");
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), 10e6 - 0.1e6);
        assertEq(messenger.lastAmount(), 10e6 - 0.1e6);

        uint256 fees = campaign.feesAccrued();
        vm.expectRevert(abi.encodeWithSelector(MockERC20.Blocked.selector, treasury));
        campaign.claimFees();
        assertEq(campaign.feesAccrued(), fees);
        _assertBooked();
    }

    // Tokens sent to the wrong campaign by mistake can be rescued by the creator with no fee.
    function test_Sweep_OtherToken() public {
        _donate(100e6, 0);
        eurc.mint(address(campaign), 5e6);
        uint256 fees = campaign.feesAccrued();
        uint256 balance = campaign.creatorBalance();

        vm.expectEmit(true, true, true, true, address(campaign));
        emit Campaign.Swept(address(eurc), alice, 5e6, campaign.createdAtBlock());
        vm.prank(alice);
        campaign.sweep(IERC20(address(eurc)), alice);

        assertEq(eurc.balanceOf(alice), 5e6);
        assertEq(eurc.balanceOf(address(campaign)), 0);
        assertEq(campaign.feesAccrued(), fees);
        assertEq(campaign.creatorBalance(), balance);
        _assertBooked();
    }

    // Sweeping the campaign token would let the creator skip the fees and take the
    // treasury's share, so it is never allowed; nor is sending to address(0).
    function test_Sweep_RevertsForCampaignToken() public {
        _donate(100e6, 0);
        vm.startPrank(alice);
        vm.expectRevert(Campaign.CannotSweepCampaignToken.selector);
        campaign.sweep(IERC20(address(usdc)), alice);
        vm.expectRevert(Campaign.ZeroAddress.selector);
        campaign.sweep(IERC20(address(eurc)), address(0));
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(campaign)), 100e6);
    }

    // A second address that moves the campaign token's balance (a native asset with more
    // than one interface) passes the address check, so the balance check must stop it, or
    // the creator could drain the treasury's fees.
    function test_Sweep_RevertsForCampaignTokenAlias() public {
        _donate(100e6, 1e6);
        MockAliasToken alias_ = new MockAliasToken(usdc);
        usdc.setAlias(address(alias_));
        uint256 fees = campaign.feesAccrued();
        uint256 balance = campaign.creatorBalance();

        vm.prank(alice);
        vm.expectRevert(Campaign.CannotSweepCampaignToken.selector);
        campaign.sweep(IERC20(address(alias_)), alice);

        assertEq(usdc.balanceOf(address(campaign)), 101e6);
        assertEq(usdc.balanceOf(alice), 0);
        assertEq(campaign.feesAccrued(), fees);
        assertEq(campaign.creatorBalance(), balance);
        _assertBooked();
    }

    function test_Sweep_OnlyCreator() public {
        eurc.mint(address(campaign), 5e6);
        vm.prank(bob);
        vm.expectRevert(Campaign.NotCreator.selector);
        campaign.sweep(IERC20(address(eurc)), bob);
    }

    function _newMeta() internal pure returns (Metadata memory meta) {
        meta.title = "New title";
        meta.description = "New description";
        meta.imageUrl = "";
        meta.links = new string[](2);
        meta.links[0] = "https://a.example";
        meta.links[1] = "https://b.example";
    }

    // The creator can fix typos and move the goal; the stored metadata is fully replaced.
    function test_Edit_UpdatesMetadataAndGoal() public {
        vm.expectEmit(true, true, true, true, address(campaign));
        emit Campaign.Edited(2_000e6, campaign.createdAtBlock());
        vm.prank(alice);
        campaign.edit(2_000e6, _newMeta());

        Summary memory s = campaign.summary();
        assertEq(s.goal, 2_000e6);
        assertEq(s.meta.title, "New title");
        assertEq(s.meta.description, "New description");
        assertEq(s.meta.imageUrl, "");
        assertEq(s.meta.links.length, 2);
        assertEq(s.meta.links[1], "https://b.example");
    }

    // Edits use the same rules as creation: a zero goal or bad metadata is rejected.
    function test_Edit_RevertsInvalidInput() public {
        vm.startPrank(alice);
        vm.expectRevert(Campaign.InvalidGoal.selector);
        campaign.edit(0, _newMeta());
        Metadata memory bad = _newMeta();
        bad.title = "";
        vm.expectRevert(MetadataLib.InvalidMetadata.selector);
        campaign.edit(1e6, bad);
        vm.stopPrank();
    }

    // Edits apply the https rule for links too, so a creator cannot swap in a script link
    // after donors have seen a safe page.
    function test_Edit_RevertsNonHttpsLinks() public {
        Metadata memory bad = _newMeta();
        vm.startPrank(alice);
        bad.links[1] = "javascript:alert(1)";
        vm.expectRevert(MetadataLib.InvalidMetadata.selector);
        campaign.edit(1e6, bad);
        bad.links[1] = "http://b.example";
        vm.expectRevert(MetadataLib.InvalidMetadata.selector);
        campaign.edit(1e6, bad);
        vm.stopPrank();
    }

    // A closed campaign is final; its page must not change after donors stop giving.
    function test_Edit_RevertsWhenClosed() public {
        vm.startPrank(alice);
        campaign.close();
        vm.expectRevert(Campaign.CampaignClosed.selector);
        campaign.edit(2_000e6, _newMeta());
        vm.stopPrank();
    }

    function test_Edit_OnlyCreator() public {
        vm.prank(bob);
        vm.expectRevert(Campaign.NotCreator.selector);
        campaign.edit(2_000e6, _newMeta());
    }

    // The factory owner must never be able to move campaign funds. Every Campaign function
    // that moves tokens is creator only (withdraw, sweep) or pays only the treasury
    // (claimFees). CampaignFactory has no function that touches campaign tokens: its owner
    // functions are setFees, setTreasury, setFeatured, pauseCreation, unpauseCreation and the
    // Ownable2Step transfer functions, none of which call a token.
    function test_Owner_HasNoPathToFunds() public {
        _donate(100e6, 1e6);
        eurc.mint(address(campaign), 5e6);
        bytes32 ownerB32 = bytes32(uint256(uint160(owner)));

        vm.startPrank(owner);
        vm.expectRevert(Campaign.NotCreator.selector);
        campaign.withdraw(1e6, ARC, ownerB32, 0, 0, "");
        vm.expectRevert(Campaign.NotCreator.selector);
        campaign.withdraw(1e6, BASE_DOMAIN, ownerB32, 0, 1000, "");
        vm.expectRevert(Campaign.NotCreator.selector);
        campaign.sweep(IERC20(address(eurc)), owner);

        uint256 amount = campaign.claimFees();
        vm.stopPrank();

        assertEq(amount, 2.5e6 + 1e6);
        assertEq(usdc.balanceOf(treasury), amount);
        assertEq(usdc.balanceOf(owner), 0);
        assertEq(eurc.balanceOf(owner), 0);
        _assertBooked();
    }
}
// forge-lint: disable-end(reentrancy-events, unused-return)

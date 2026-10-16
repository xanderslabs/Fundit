// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Base} from "./helpers/Base.t.sol";
import {Campaign} from "../src/Campaign.sol";
import {CampaignFactory} from "../src/CampaignFactory.sol";
import {Summary} from "../src/Types.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice A creator who loses their key can name a backup address that takes over after a
/// 7-day wait. The creator can cancel during the wait, so a stolen backup key alone can never
/// take a campaign or its funds.
// Test-only false positives: expected-event emits and ignored return values in revert checks.
// forge-lint: disable-start(reentrancy-events, unused-return)
contract CampaignRecoveryTest is Base {
    uint32 internal constant ARC = 26;
    uint32 internal constant BASE_DOMAIN = 6;
    uint64 internal constant N = 1_000;

    address internal carol;
    address internal dave;
    Campaign internal campaign;
    IERC20 internal usdcToken;

    function setUp() public override {
        super.setUp();
        carol = makeAddr("carol");
        dave = makeAddr("dave");
        usdcToken = IERC20(address(usdc));
        vm.roll(N);
        campaign = Campaign(_createWithBackup(carol));
    }

    function _createWithBackup(address backup) internal returns (address) {
        vm.prank(alice);
        return factory.createCampaign(usdcToken, 1_000e6, backup, _meta());
    }

    function _donate(uint256 amount) internal {
        usdc.mint(bob, amount);
        vm.startPrank(bob);
        usdc.approve(address(campaign), amount);
        campaign.donate(amount, 0, "");
        vm.stopPrank();
    }

    function _b32(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }

    function _initiate() internal returns (uint64 readyAt) {
        vm.prank(carol);
        campaign.initiateRecovery();
        readyAt = campaign.recoveryReadyAt();
    }

    function _recover() internal {
        uint64 readyAt = _initiate();
        vm.warp(readyAt);
        vm.prank(carol);
        campaign.completeRecovery();
    }

    // Review focus 1. Someone holding only the backup key starts a recovery. The real creator
    // still controls the money during the wait and can stop the takeover.
    function test_Recovery_CreatorCanWithdrawAndCancelDuringWait() public {
        _donate(100e6);
        uint64 readyAt = _initiate();
        vm.warp(readyAt - 1);

        vm.prank(alice);
        campaign.withdraw(50e6, ARC, _b32(alice), 0, 0, "");
        assertEq(usdc.balanceOf(alice), 50e6 - 0.5e6);

        vm.expectEmit(true, true, true, true, address(campaign));
        emit Campaign.RecoveryCancelled(carol, N);
        vm.prank(alice);
        campaign.cancelRecovery();
        assertEq(campaign.recoveryReadyAt(), 0);

        vm.warp(readyAt + 1 days);
        vm.prank(carol);
        vm.expectRevert(Campaign.NoRecoveryPending.selector);
        campaign.completeRecovery();
        assertEq(campaign.creator(), alice);
        // The backup stays named, so a real loss later can still be recovered.
        assertEq(campaign.backup(), carol);
    }

    // Review focus 2. Replacing or removing a backup must also kill its pending recovery,
    // or the replaced backup could still finish the takeover.
    function test_SetBackup_CancelsPendingRecovery() public {
        uint64 readyAt = _initiate();

        vm.expectEmit(true, true, true, true, address(campaign));
        emit Campaign.RecoveryCancelled(carol, N);
        vm.expectEmit(true, true, true, true, address(campaign));
        emit Campaign.BackupSet(dave, N);
        vm.prank(alice);
        campaign.setBackup(dave);

        assertEq(campaign.backup(), dave);
        assertEq(campaign.recoveryReadyAt(), 0);
        vm.warp(readyAt);
        vm.prank(carol);
        vm.expectRevert(Campaign.NotBackup.selector);
        campaign.completeRecovery();
        // The new backup has no pending recovery to complete either.
        vm.prank(dave);
        vm.expectRevert(Campaign.NoRecoveryPending.selector);
        campaign.completeRecovery();

        // Removing the backup cancels in the same way.
        vm.prank(dave);
        campaign.initiateRecovery();
        vm.prank(alice);
        campaign.setBackup(address(0));
        assertEq(campaign.backup(), address(0));
        assertEq(campaign.recoveryReadyAt(), 0);
        vm.warp(block.timestamp + 7 days);
        vm.prank(dave);
        vm.expectRevert(Campaign.NotBackup.selector);
        campaign.completeRecovery();
        assertEq(campaign.creator(), alice);
    }

    // Review focus 3. The creator is promised a full 7 days to react, and not a second more.
    function test_Recovery_BoundaryTiming() public {
        uint256 start = block.timestamp;
        uint64 readyAt = _initiate();
        assertEq(readyAt, start + 7 days);
        assertEq(campaign.RECOVERY_DELAY(), 7 days);

        vm.warp(readyAt - 1);
        vm.prank(carol);
        vm.expectRevert(Campaign.RecoveryNotReady.selector);
        campaign.completeRecovery();

        vm.warp(readyAt);
        vm.prank(carol);
        campaign.completeRecovery();
        assertEq(campaign.creator(), carol);
    }

    // Review focus 4. A half transfer would leave the old (possibly compromised) key with
    // some power, or leave the new creator unable to reach the funds.
    function test_Recovery_TransfersAllCreatorPowers() public {
        _donate(100e6);
        _recover();

        assertEq(campaign.creator(), carol);
        assertEq(campaign.backup(), address(0));
        assertEq(campaign.recoveryReadyAt(), 0);

        MockERC20 stray = new MockERC20("Stray", "STR", 18);
        stray.mint(address(campaign), 5);

        vm.startPrank(alice);
        vm.expectRevert(Campaign.NotCreator.selector);
        campaign.withdraw(1e6, ARC, _b32(alice), 0, 0, "");
        vm.expectRevert(Campaign.NotCreator.selector);
        campaign.edit(2_000e6, _meta());
        vm.expectRevert(Campaign.NotCreator.selector);
        campaign.sweep(IERC20(address(stray)), alice);
        vm.expectRevert(Campaign.NotCreator.selector);
        campaign.setBackup(alice);
        vm.expectRevert(Campaign.NotCreator.selector);
        campaign.cancelRecovery();
        vm.expectRevert(Campaign.NotCreator.selector);
        campaign.close();
        vm.stopPrank();

        vm.startPrank(carol);
        campaign.withdraw(40e6, BASE_DOMAIN, _b32(carol), 0, 1000, "");
        assertEq(messenger.lastAmount(), 40e6 - 0.4e6);
        assertEq(messenger.lastDomain(), BASE_DOMAIN);
        assertEq(messenger.lastRecipient(), _b32(carol));
        campaign.withdraw(10e6, ARC, _b32(carol), 0, 0, "");
        assertEq(usdc.balanceOf(carol), 10e6 - 0.1e6);
        campaign.edit(2_000e6, _meta());
        assertEq(campaign.goal(), 2_000e6);
        campaign.sweep(IERC20(address(stray)), carol);
        assertEq(stray.balanceOf(carol), 5);
        campaign.setBackup(alice);
        assertEq(campaign.backup(), alice);
        campaign.close();
        assertTrue(campaign.closed());
        vm.stopPrank();

        // The new creator's own backup can start a recovery, and the new creator can cancel it.
        vm.prank(alice);
        campaign.initiateRecovery();
        vm.prank(carol);
        campaign.cancelRecovery();
    }

    // Review focus 5. The app lists "my campaigns" from campaignsOf, so a recovered campaign
    // must show up for its new creator.
    function test_Recovery_UpdatesFactoryIndex() public {
        uint64 readyAt = _initiate();
        vm.warp(readyAt);
        vm.expectEmit(true, true, true, true, address(factory));
        emit CampaignFactory.CampaignCreatorChanged(address(campaign), alice, carol);
        vm.prank(carol);
        campaign.completeRecovery();

        address[] memory mine = factory.campaignsOf(carol);
        assertEq(mine.length, 1);
        assertEq(mine[0], address(campaign));
        // The old list keeps the entry. The app filters by summary().creator.
        assertEq(factory.campaignsOf(alice).length, 1);
        assertEq(campaign.summary().creator, carol);
    }

    // Review focus 5. If anyone could write the index, they could list fake or foreign
    // campaigns under a victim's address.
    function test_RecordCreatorChange_OnlyCampaign() public {
        vm.prank(bob);
        vm.expectRevert(CampaignFactory.NotCampaign.selector);
        factory.recordCreatorChange(alice, bob);

        // A clone of the implementation that the factory did not create is not a campaign.
        address fake = Clones.clone(factory.implementation());
        vm.prank(fake);
        vm.expectRevert(CampaignFactory.NotCampaign.selector);
        factory.recordCreatorChange(alice, bob);
        assertEq(factory.campaignsOf(bob).length, 0);
    }

    // Naming yourself as backup would be no backup at all, and would hide that from the creator.
    function test_Create_RevertsBackupEqualsCreator() public {
        vm.prank(alice);
        vm.expectRevert(CampaignFactory.InvalidBackup.selector);
        factory.createCampaign(usdcToken, 1_000e6, alice, _meta());
    }

    // With no backup, nobody at all can start a recovery.
    function test_Create_ZeroBackupMeansNone() public {
        campaign = Campaign(_createWithBackup(address(0)));
        assertEq(campaign.backup(), address(0));
        // carol is the backup of the setUp campaign, not of this one.
        address[3] memory callers = [alice, bob, carol];
        for (uint256 i = 0; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(Campaign.NotBackup.selector);
            campaign.initiateRecovery();
        }
    }

    function test_InitiateRecovery_OnlyBackup() public {
        address[3] memory callers = [alice, bob, address(factory)];
        for (uint256 i = 0; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(Campaign.NotBackup.selector);
            campaign.initiateRecovery();
        }

        vm.expectEmit(true, true, true, true, address(campaign));
        emit Campaign.RecoveryInitiated(carol, uint64(block.timestamp + 7 days), N);
        vm.prank(carol);
        campaign.initiateRecovery();
    }

    // A second call must not push the deadline. A restart would let the backup reset the
    // clock, and a silent no-op would hide that one is already running.
    function test_InitiateRecovery_RevertsWhenPending() public {
        uint64 readyAt = _initiate();
        vm.warp(block.timestamp + 1 days);
        vm.prank(carol);
        vm.expectRevert(Campaign.RecoveryPending.selector);
        campaign.initiateRecovery();
        assertEq(campaign.recoveryReadyAt(), readyAt);
    }

    function test_CancelRecovery_OnlyCreator() public {
        _initiate();
        address[2] memory callers = [carol, bob];
        for (uint256 i = 0; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(Campaign.NotCreator.selector);
            campaign.cancelRecovery();
        }
        assertGt(campaign.recoveryReadyAt(), 0);
    }

    function test_CancelRecovery_RevertsWhenNonePending() public {
        vm.prank(alice);
        vm.expectRevert(Campaign.NoRecoveryPending.selector);
        campaign.cancelRecovery();
    }

    function test_SetBackup_OnlyCreator() public {
        address[2] memory callers = [carol, bob];
        for (uint256 i = 0; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(Campaign.NotCreator.selector);
            campaign.setBackup(callers[i]);
        }
        assertEq(campaign.backup(), carol);
    }

    function test_SetBackup_RevertsBackupEqualsCreator() public {
        vm.prank(alice);
        vm.expectRevert(Campaign.InvalidBackup.selector);
        campaign.setBackup(alice);
    }

    // With nothing pending, setBackup only emits BackupSet.
    function test_SetBackup_NoPending_EmitsOnlyBackupSet() public {
        vm.recordLogs();
        vm.prank(alice);
        campaign.setBackup(dave);
        assertEq(vm.getRecordedLogs().length, 1);
        assertEq(campaign.backup(), dave);
    }

    function test_CompleteRecovery_OnlyBackup() public {
        uint64 readyAt = _initiate();
        vm.warp(readyAt);
        address[2] memory callers = [alice, bob];
        for (uint256 i = 0; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(Campaign.NotBackup.selector);
            campaign.completeRecovery();
        }
    }

    function test_CompleteRecovery_RevertsWhenNonePending() public {
        vm.warp(block.timestamp + 30 days);
        vm.prank(carol);
        vm.expectRevert(Campaign.NoRecoveryPending.selector);
        campaign.completeRecovery();
    }

    // The new events must join the same prevActivityBlock chain as the Plan 1 events, or a
    // log walk would skip blocks that hold a recovery.
    function test_Recovery_EventsChainPrevActivityBlock() public {
        // Creation block: events point to createdAtBlock itself.
        vm.expectEmit(true, true, true, true, address(campaign));
        emit Campaign.BackupSet(dave, N);
        vm.prank(alice);
        campaign.setBackup(dave);
        assertEq(campaign.lastActivityBlock(), N);

        vm.roll(N + 5);
        vm.expectEmit(true, true, true, true, address(campaign));
        emit Campaign.RecoveryInitiated(dave, uint64(block.timestamp + 7 days), N);
        vm.prank(dave);
        campaign.initiateRecovery();
        assertEq(campaign.lastActivityBlock(), N + 5);

        vm.roll(N + 10);
        vm.expectEmit(true, true, true, true, address(campaign));
        emit Campaign.RecoveryCancelled(dave, N + 5);
        vm.prank(alice);
        campaign.cancelRecovery();
        // A Plan 1 event in the same block carries the same pointer.
        vm.expectEmit(true, true, true, true, address(campaign));
        emit Campaign.Edited(3_000e6, N + 5);
        vm.prank(alice);
        campaign.edit(3_000e6, _meta());
        assertEq(campaign.lastActivityBlock(), N + 10);

        vm.roll(N + 20);
        vm.prank(dave);
        campaign.initiateRecovery();

        vm.roll(N + 30);
        vm.warp(campaign.recoveryReadyAt());
        vm.expectEmit(true, true, true, true, address(campaign));
        emit Campaign.CreatorChanged(alice, dave, N + 20);
        vm.prank(dave);
        campaign.completeRecovery();
        assertEq(campaign.lastActivityBlock(), N + 30);
    }

    // The app shows the backup and a pending countdown from one summary() call.
    function test_Summary_ShowsBackupAndPending() public {
        Summary memory s = campaign.summary();
        assertEq(s.backup, carol);
        assertEq(s.recoveryReadyAt, 0);

        uint64 readyAt = _initiate();
        s = campaign.summary();
        assertEq(s.backup, carol);
        assertEq(s.recoveryReadyAt, readyAt);

        vm.warp(readyAt);
        vm.prank(carol);
        campaign.completeRecovery();
        s = campaign.summary();
        assertEq(s.creator, carol);
        assertEq(s.backup, address(0));
        assertEq(s.recoveryReadyAt, 0);
    }

    // The backup has no creator power at all until the wait is over and it completes.
    function test_Recovery_BackupCannotWithdrawBeforeCompletion() public {
        _donate(100e6);
        uint64 readyAt = _initiate();

        vm.startPrank(carol);
        vm.expectRevert(Campaign.NotCreator.selector);
        campaign.withdraw(1e6, ARC, _b32(carol), 0, 0, "");
        vm.warp(readyAt);
        // Ready but not completed is still not the creator.
        vm.expectRevert(Campaign.NotCreator.selector);
        campaign.withdraw(1e6, BASE_DOMAIN, _b32(carol), 0, 1000, "");
        vm.expectRevert(Campaign.NotCreator.selector);
        campaign.sweep(IERC20(address(eurc)), carol);
        vm.stopPrank();
        assertEq(usdc.balanceOf(carol), 0);
        assertEq(campaign.creatorBalance(), 97.5e6);
    }
}
// forge-lint: disable-end(reentrancy-events, unused-return)

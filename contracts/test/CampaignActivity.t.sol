// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vm} from "forge-std/Vm.sol";
import {Base} from "./helpers/Base.t.sol";
import {Campaign} from "../src/Campaign.sol";

/// @notice A frontend with no indexer walks a campaign's history backwards with eth_getLogs,
/// following prevActivityBlock from lastActivityBlock to createdAtBlock. These tests check that
/// every pointer lands on a block that holds campaign events, so the walk never misses one.
// forge-lint: disable-start(unused-return, unsafe-typecast, require-revert-in-loop)
contract CampaignActivityTest is Base {
    uint32 internal constant ARC = 26;
    uint64 internal constant N = 1_000;

    Campaign internal campaign;

    function setUp() public override {
        super.setUp();
        vm.roll(N);
        campaign = Campaign(_create(IERC20(address(usdc)), 1_000e6));
    }

    function _donate(uint256 amount) internal {
        usdc.mint(bob, amount);
        vm.startPrank(bob);
        usdc.approve(address(campaign), amount);
        campaign.donate(amount, 0, "");
        vm.stopPrank();
    }

    /// @dev prevActivityBlock of every campaign event in `logs`. Fails on any unknown event, so
    /// a new event without the pointer cannot slip past this test.
    function _prevs(Vm.Log[] memory logs) internal view returns (uint64[] memory out) {
        uint256 n = 0;
        out = new uint64[](logs.length);
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].emitter != address(campaign)) continue;
            bytes32 sig = logs[i].topics[0];
            bytes memory d = logs[i].data;
            uint64 prev = 0;
            if (sig == Campaign.Donated.selector) {
                (,,,, prev) = abi.decode(d, (uint256, uint256, uint256, string, uint64));
            } else if (sig == Campaign.ExternalDonationSettled.selector) {
                (,, prev) = abi.decode(d, (uint256, uint256, uint64));
            } else if (sig == Campaign.Withdrawn.selector) {
                (,,, prev) = abi.decode(d, (uint256, uint256, uint256, uint64));
            } else if (
                sig == Campaign.Edited.selector || sig == Campaign.FeesClaimed.selector
                    || sig == Campaign.Swept.selector
            ) {
                (, prev) = abi.decode(d, (uint256, uint64));
            } else if (sig == Campaign.Closed.selector) {
                prev = abi.decode(d, (uint64));
            } else {
                revert("unknown campaign event");
            }
            out[n++] = prev;
        }
        assembly {
            mstore(out, n)
        }
    }

    function _assertAll(uint64[] memory prevs, uint256 count, uint64 expected) internal pure {
        assertEq(prevs.length, count, "event count");
        for (uint256 i = 0; i < prevs.length; ++i) {
            assertEq(prevs[i], expected, "prevActivityBlock");
        }
    }

    // Activity in blocks N, N+5 and N+20. Each block's events point to the block before it,
    // and the first block's events point to createdAtBlock, which ends the walk.
    function test_ActivityPointers_ChainBackToCreation() public {
        assertEq(campaign.createdAtBlock(), N);
        assertEq(campaign.summary().createdAtBlock, N);
        assertEq(campaign.lastActivityBlock(), N);

        // Block N, the creation block: its events point to createdAtBlock itself.
        vm.recordLogs();
        _donate(100e6);
        _assertAll(_prevs(vm.getRecordedLogs()), 1, N);
        assertEq(campaign.lastActivityBlock(), N);

        // Block N+5: two events in one block both point to N.
        vm.roll(N + 5);
        usdc.mint(address(campaign), 10e6);
        vm.recordLogs();
        _donate(50e6);
        _assertAll(_prevs(vm.getRecordedLogs()), 2, N);
        assertEq(campaign.lastActivityBlock(), N + 5);

        // Block N+20: every other activity event points to N+5.
        vm.roll(N + 20);
        eurc.mint(address(campaign), 1e6);
        vm.recordLogs();
        vm.startPrank(alice);
        campaign.withdraw(1e6, ARC, bytes32(uint256(uint160(alice))), 0, 0, "");
        campaign.edit(2_000e6, _meta());
        campaign.sweep(IERC20(address(eurc)), alice);
        campaign.close();
        vm.stopPrank();
        campaign.claimFees();
        _assertAll(_prevs(vm.getRecordedLogs()), 5, N + 5);
        assertEq(campaign.lastActivityBlock(), N + 20);

        // The summary keeps the creation block after activity.
        assertEq(campaign.summary().createdAtBlock, N);
    }

    // A call that emits nothing must not move lastActivityBlock, or the walk would start at
    // a block with no campaign logs and stop early.
    function test_ActivityPointers_NoEventNoMove() public {
        vm.roll(N + 7);
        _donate(10e6);
        vm.roll(N + 9);
        campaign.claimFees();
        vm.roll(N + 12);
        vm.recordLogs();
        assertEq(campaign.settle(), 0);
        assertEq(campaign.claimFees(), 0);
        assertEq(_prevs(vm.getRecordedLogs()).length, 0);
        assertEq(campaign.lastActivityBlock(), N + 9);
    }
}
// forge-lint: disable-end(unused-return, unsafe-typecast, require-revert-in-loop)

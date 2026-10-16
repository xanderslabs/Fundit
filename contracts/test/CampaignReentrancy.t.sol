// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Base} from "./helpers/Base.t.sol";
import {Campaign} from "../src/Campaign.sol";
import {CampaignFactory} from "../src/CampaignFactory.sol";
import {MockReentrant} from "./mocks/MockReentrant.sol";

// Test-only false positives: ignored return values and the external calls in test loops.
// forge-lint: disable-start(unused-return, calls-loop)
/// @notice The campaign calls out to the messenger during a CCTP withdraw and to an arbitrary
/// token during sweep. Neither callee may re-enter a function that moves or books funds.
contract CampaignReentrancyTest is Base {
    uint32 internal constant ARC = 26;
    uint32 internal constant BASE_DOMAIN = 6;

    MockReentrant internal reentrant;
    Campaign internal campaign;
    bytes32 internal aliceB32;

    function setUp() public override {
        super.setUp();
        reentrant = new MockReentrant();
        factory = new CampaignFactory(
            owner, treasury, IERC20(address(usdc)), IERC20(address(eurc)), reentrant, DONATION_FEE_BPS, WITHDRAW_FEE_BPS
        );
        campaign = Campaign(_create(IERC20(address(usdc)), 1_000e6));
        aliceB32 = bytes32(uint256(uint160(alice)));

        usdc.mint(bob, 100e6);
        vm.startPrank(bob);
        usdc.approve(address(campaign), 100e6);
        campaign.donate(100e6, 0, "");
        vm.stopPrank();
    }

    function _payloads() internal view returns (bytes[] memory p) {
        p = new bytes[](3);
        p[0] = abi.encodeCall(Campaign.withdraw, (1e6, ARC, aliceB32, 0, 0, ""));
        p[1] = abi.encodeCall(Campaign.settle, ());
        p[2] = abi.encodeCall(Campaign.claimFees, ());
    }

    // A malicious messenger must not be able to withdraw twice, or settle or claim fees
    // against books that are mid-update.
    function test_Reentrancy_FromMessengerReverts() public {
        bytes[] memory p = _payloads();
        for (uint256 i = 0; i < p.length; ++i) {
            reentrant.arm(address(campaign), p[i]);
            vm.startPrank(alice);
            vm.expectRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
            campaign.withdraw(10e6, BASE_DOMAIN, bytes32(uint256(0xBEEF)), 0, 1000, "");
            vm.expectRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
            campaign.withdraw(10e6, BASE_DOMAIN, bytes32(uint256(0xBEEF)), 0, 1000, hex"cafe");
            vm.stopPrank();
        }
        assertEq(campaign.creatorBalance(), 97.5e6);
        assertEq(campaign.withdrawn(), 0);
    }

    // A swept token is any address the creator names, so its transfer may call back in.
    function test_Reentrancy_FromSweptTokenReverts() public {
        bytes[] memory p = _payloads();
        for (uint256 i = 0; i < p.length; ++i) {
            reentrant.arm(address(campaign), p[i]);
            vm.prank(alice);
            vm.expectRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
            campaign.sweep(IERC20(address(reentrant)), alice);
        }
        assertEq(usdc.balanceOf(address(campaign)), 100e6);
    }
}
// forge-lint: disable-end(unused-return, calls-loop)

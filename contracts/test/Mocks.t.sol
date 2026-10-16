// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockTokenMessengerV2} from "./mocks/MockTokenMessengerV2.sol";

contract MocksTest is Test {
    MockERC20 token;
    MockTokenMessengerV2 messenger;
    address alice;
    address bob;

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        token = new MockERC20("USD Coin", "USDC", 6);
        messenger = new MockTokenMessengerV2();
    }

    function test_MockERC20_BlockedTransferReverts() public {
        token.mint(alice, 100);
        token.setBlocked(bob, true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MockERC20.Blocked.selector, bob));
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        token.transfer(bob, 1);
    }

    function test_MockMessenger_RecordsAndPulls() public {
        token.mint(alice, 100);
        vm.startPrank(alice);
        assertTrue(token.approve(address(messenger), 100));
        messenger.depositForBurn(100, 6, bytes32(uint256(uint160(bob))), address(token), 0, 1, 1000);
        vm.stopPrank();

        assertEq(token.balanceOf(address(messenger)), 100);
        assertEq(messenger.lastDomain(), 6);
        assertEq(messenger.calls(), 1);
    }
}

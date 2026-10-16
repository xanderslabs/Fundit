// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockERC20} from "./MockERC20.sol";

/// @notice A different token address that moves the same underlying balance as `UNDERLYING`.
contract MockAliasToken {
    MockERC20 public immutable UNDERLYING;

    constructor(MockERC20 underlying_) {
        UNDERLYING = underlying_;
    }

    function balanceOf(address account) external view returns (uint256) {
        return UNDERLYING.balanceOf(account);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        UNDERLYING.aliasTransfer(msg.sender, to, amount);
        return true;
    }
}

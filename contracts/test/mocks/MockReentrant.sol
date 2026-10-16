// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ITokenMessengerV2} from "../../src/interfaces/ITokenMessengerV2.sol";

/// @notice Calls back into `target` with `payload` from inside the hooks a campaign calls out
/// to: the CCTP messenger burn functions and an ERC-20 transfer during sweep. The inner
/// revert bubbles up unchanged.
contract MockReentrant is ITokenMessengerV2 {
    address public target;
    bytes public payload;

    // forge-lint: disable-next-item(missing-zero-check)
    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    function depositForBurn(uint256, uint32, bytes32, address, bytes32, uint256, uint32) external {
        _reenter();
    }

    function depositForBurnWithHook(uint256, uint32, bytes32, address, bytes32, uint256, uint32, bytes calldata)
        external
    {
        _reenter();
    }

    function balanceOf(address) external pure returns (uint256) {
        return 1;
    }

    function transfer(address, uint256) external returns (bool) {
        _reenter();
        return true;
    }

    function _reenter() internal {
        (bool ok, bytes memory ret) = target.call(payload);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }
}

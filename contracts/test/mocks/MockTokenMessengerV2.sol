// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ITokenMessengerV2} from "../../src/interfaces/ITokenMessengerV2.sol";

/// @notice Pulls the burn token from the caller and records the last call.
contract MockTokenMessengerV2 is ITokenMessengerV2 {
    uint256 public lastAmount;
    uint32 public lastDomain;
    bytes32 public lastRecipient;
    address public lastBurnToken;
    uint256 public lastMaxFee;
    uint32 public lastMinFinality;
    bytes public lastHookData;
    uint256 public calls;

    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external {
        _record(amount, destinationDomain, mintRecipient, burnToken, maxFee, minFinalityThreshold, "");
    }

    function depositForBurnWithHook(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes calldata hookData
    ) external {
        _record(amount, destinationDomain, mintRecipient, burnToken, maxFee, minFinalityThreshold, hookData);
    }

    function _record(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        uint256 maxFee,
        uint32 minFinalityThreshold,
        bytes memory hookData
    ) internal {
        require(IERC20(burnToken).transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        lastAmount = amount;
        lastDomain = destinationDomain;
        lastRecipient = mintRecipient;
        lastBurnToken = burnToken;
        lastMaxFee = maxFee;
        lastMinFinality = minFinalityThreshold;
        lastHookData = hookData;
        calls++;
    }
}

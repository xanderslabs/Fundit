// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ITokenMessengerV2} from "./ITokenMessengerV2.sol";

/// @notice The factory values a Campaign reads at call time.
interface ICampaignFactory {
    function treasury() external view returns (address);
    function tokenMessenger() external view returns (ITokenMessengerV2);
}

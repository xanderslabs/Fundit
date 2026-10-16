// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ITokenMessengerV2} from "./ITokenMessengerV2.sol";

/// @notice The factory values a Campaign reads at call time, and the index update it sends after a recovery.
interface ICampaignFactory {
    function treasury() external view returns (address);
    function tokenMessenger() external view returns (ITokenMessengerV2);
    function eurc() external view returns (IERC20);
    function isEurcPayoutDomain(uint32 domain) external view returns (bool);
    function recordCreatorChange(address oldCreator, address newCreator) external;
}

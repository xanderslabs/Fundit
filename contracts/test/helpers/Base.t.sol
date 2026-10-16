// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CampaignFactory} from "../../src/CampaignFactory.sol";
import {Metadata} from "../../src/Types.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockTokenMessengerV2} from "../mocks/MockTokenMessengerV2.sol";

/// @notice Shared setUp: USDC and EURC mocks, the messenger mock and a factory with 250/100 bps fees.
abstract contract Base is Test {
    uint16 internal constant DONATION_FEE_BPS = 250;
    uint16 internal constant WITHDRAW_FEE_BPS = 100;

    MockERC20 internal usdc;
    MockERC20 internal eurc;
    MockTokenMessengerV2 internal messenger;
    CampaignFactory internal factory;

    address internal owner;
    address internal treasury;
    address internal alice;
    address internal bob;

    function setUp() public virtual {
        owner = makeAddr("owner");
        treasury = makeAddr("treasury");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        messenger = new MockTokenMessengerV2();
        factory = new CampaignFactory(
            owner,
            treasury,
            IERC20(address(usdc)),
            IERC20(address(eurc)),
            messenger,
            DONATION_FEE_BPS,
            WITHDRAW_FEE_BPS,
            _eurcDomains()
        );
    }

    /// @dev EURC payout domains for tests: Ethereum (0), Avalanche (1) and Base (6).
    function _eurcDomains() internal pure returns (uint32[] memory d) {
        d = new uint32[](3);
        d[0] = 0;
        d[1] = 1;
        d[2] = 6;
    }

    function _meta() internal pure returns (Metadata memory meta) {
        meta.title = "Help fund the community garden";
        meta.description = "Seeds, soil and tools for the spring.";
        meta.imageUrl = "https://example.com/garden.png";
        meta.links = new string[](1);
        meta.links[0] = "https://example.com";
    }

    /// @dev Alice creates a campaign for `token` with `goal` and valid metadata.
    function _create(IERC20 token, uint256 goal) internal returns (address) {
        vm.prank(alice);
        return factory.createCampaign(token, goal, _meta());
    }
}

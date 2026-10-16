// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CampaignFactory} from "../src/CampaignFactory.sol";
import {ITokenMessengerV2} from "../src/interfaces/ITokenMessengerV2.sol";

/// @notice Deploys CampaignFactory on Arc mainnet with the fixed token and CCTP addresses.
/// @dev Env: DEPLOYER_PRIVATE_KEY, OWNER, TREASURY, DONATION_FEE_BPS, WITHDRAW_FEE_BPS and
/// EURC_PAYOUT_DOMAINS (comma-separated CCTP domains, may be empty). See .env.example.
contract Deploy is Script {
    uint256 internal constant ARC_CHAIN_ID = 5042;
    uint32 internal constant ARC_DOMAIN = 26;
    IERC20 internal constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    IERC20 internal constant EURC = IERC20(0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1);
    ITokenMessengerV2 internal constant TOKEN_MESSENGER = ITokenMessengerV2(0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d);

    function run() external returns (CampaignFactory factory) {
        require(block.chainid == ARC_CHAIN_ID, "Deploy: not Arc mainnet");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.envAddress("OWNER");
        address treasury = vm.envAddress("TREASURY");
        uint256 donationFeeBps = vm.envUint("DONATION_FEE_BPS");
        uint256 withdrawFeeBps = vm.envUint("WITHDRAW_FEE_BPS");
        require(owner != address(0), "Deploy: OWNER unset");
        require(donationFeeBps <= type(uint16).max && withdrawFeeBps <= type(uint16).max, "Deploy: fee out of range");
        uint32[] memory domains = parseDomains(vm.envOr("EURC_PAYOUT_DOMAINS", string("")));

        vm.startBroadcast(deployerKey);
        factory = new CampaignFactory(
            owner,
            treasury,
            USDC,
            EURC,
            TOKEN_MESSENGER,
            // forge-lint: disable-next-line(unsafe-typecast)
            uint16(donationFeeBps),
            // forge-lint: disable-next-line(unsafe-typecast)
            uint16(withdrawFeeBps),
            domains
        );
        vm.stopBroadcast();

        console.log("factory", address(factory));
        console.log("implementation", factory.implementation());
        console.log("eurcPayoutDomains", domains.length);
        for (uint256 i = 0; i < domains.length; ++i) {
            console.log("  domain", domains[i]);
        }
    }

    /// @notice Parses "0, 6,6" into [0, 6]: trims entries, drops duplicates, rejects Arc (26),
    /// empty entries and values above uint32. An empty or blank string gives an empty list.
    function parseDomains(string memory csv) public pure returns (uint32[] memory out) {
        if (bytes(vm.trim(csv)).length == 0) return new uint32[](0);
        string[] memory parts = vm.split(csv, ",");
        uint32[] memory tmp = new uint32[](parts.length);
        uint256 n = 0;
        // Cheatcode calls and reverts in this loop are intended: one bad entry fails the deploy.
        // forge-lint: disable-start(calls-loop, require-revert-in-loop)
        for (uint256 i = 0; i < parts.length; ++i) {
            string memory part = vm.trim(parts[i]);
            require(bytes(part).length != 0, "Deploy: empty domain entry");
            uint256 value = vm.parseUint(part);
            require(value <= type(uint32).max, "Deploy: domain out of range");
            require(value != ARC_DOMAIN, "Deploy: Arc (26) needs no EURC entry");
            // forge-lint: disable-next-line(unsafe-typecast)
            uint32 domain = uint32(value);
            bool seen = false;
            for (uint256 j = 0; j < n; ++j) {
                if (tmp[j] == domain) seen = true;
            }
            if (!seen) tmp[n++] = domain;
        }
        // forge-lint: disable-end(calls-loop, require-revert-in-loop)
        out = new uint32[](n);
        for (uint256 i = 0; i < n; ++i) {
            out[i] = tmp[i];
        }
    }
}

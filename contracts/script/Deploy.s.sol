// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CampaignFactory} from "../src/CampaignFactory.sol";
import {ITokenMessengerV2} from "../src/interfaces/ITokenMessengerV2.sol";

/// @notice Deploys CampaignFactory on Arc mainnet (5042) or Arc testnet (5042002) with that network's fixed
/// token and CCTP addresses. Any other chain reverts.
/// @dev Env: OWNER, TREASURY, DONATION_FEE_BPS, WITHDRAW_FEE_BPS, EURC_PAYOUT_DOMAINS
/// (comma-separated CCTP domains, may be empty) and optional DEPLOYER_PRIVATE_KEY. With no key
/// the script broadcasts from the forge signer, so `--account <keystore>` or `--ledger` works.
/// See .env.example.
contract Deploy is Script {
    uint256 internal constant ARC_MAINNET_CHAIN_ID = 5042;
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5042002;
    uint32 internal constant ARC_DOMAIN = 26;
    // USDC is the same address on both networks.
    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    address internal constant MAINNET_EURC = 0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1;
    address internal constant MAINNET_TOKEN_MESSENGER = 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d;
    address internal constant TESTNET_EURC = 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a;
    address internal constant TESTNET_TOKEN_MESSENGER = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;

    /// @notice The USDC, EURC and TokenMessengerV2 addresses for an Arc chain id. Reverts on any other chain.
    function networkAddresses(uint256 chainId) public pure returns (address usdc, address eurc, address messenger) {
        if (chainId == ARC_MAINNET_CHAIN_ID) return (USDC, MAINNET_EURC, MAINNET_TOKEN_MESSENGER);
        if (chainId == ARC_TESTNET_CHAIN_ID) return (USDC, TESTNET_EURC, TESTNET_TOKEN_MESSENGER);
        revert("Deploy: not Arc mainnet or testnet");
    }

    function run() external returns (CampaignFactory factory) {
        (address usdc, address eurc, address messenger) = networkAddresses(block.chainid);
        string memory deployerKey = vm.trim(vm.envOr("DEPLOYER_PRIVATE_KEY", string("")));
        address owner = vm.envAddress("OWNER");
        address treasury = vm.envAddress("TREASURY");
        uint256 donationFeeBps = vm.envUint("DONATION_FEE_BPS");
        uint256 withdrawFeeBps = vm.envUint("WITHDRAW_FEE_BPS");
        require(owner != address(0), "Deploy: OWNER is zero");
        require(treasury != address(0), "Deploy: TREASURY is zero");
        require(donationFeeBps <= 500 && withdrawFeeBps <= 500, "Deploy: fee above 500");
        uint32[] memory domains = parseDomains(vm.envOr("EURC_PAYOUT_DOMAINS", string("")));

        if (bytes(deployerKey).length == 0) {
            vm.startBroadcast();
        } else {
            vm.startBroadcast(vm.parseUint(deployerKey));
        }
        factory = new CampaignFactory(
            owner,
            treasury,
            IERC20(usdc),
            IERC20(eurc),
            ITokenMessengerV2(messenger),
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
                if (tmp[j] == domain) {
                    seen = true;
                    break;
                }
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

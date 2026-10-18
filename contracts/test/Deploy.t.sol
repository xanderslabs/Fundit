// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";

// forge-lint: disable-start(unused-return)
/// @notice EURC_PAYOUT_DOMAINS parsing. The factory list is fixed at deploy, so a bad
/// parse would lock in wrong payout domains for good. These run offline.
contract DeployParseDomainsTest is Test {
    Deploy internal deploy;

    function setUp() public {
        deploy = new Deploy();
    }

    function test_ParseDomains_DedupesKeepingFirstOrder() public view {
        uint32[] memory d = deploy.parseDomains("6,6,0");
        assertEq(d.length, 2);
        assertEq(d[0], 6);
        assertEq(d[1], 0);
    }

    function test_ParseDomains_TrimsWhitespace() public view {
        uint32[] memory d = deploy.parseDomains(" 0 , 14");
        assertEq(d.length, 2);
        assertEq(d[0], 0);
        assertEq(d[1], 14);
    }

    function test_ParseDomains_EmptyOrBlankGivesEmptyList() public view {
        assertEq(deploy.parseDomains("").length, 0);
        assertEq(deploy.parseDomains("  ").length, 0);
    }

    /// @dev Arc payouts are plain transfers; the factory would also reject 26, but failing in the
    /// script gives a readable message before any gas is spent.
    function test_ParseDomains_RejectsArc() public {
        vm.expectRevert(bytes("Deploy: Arc (26) needs no EURC entry"));
        deploy.parseDomains("6,26");
    }

    /// @dev Defined behaviour: an empty entry is a typo, so it reverts instead of being skipped.
    function test_ParseDomains_RejectsEmptyEntry() public {
        vm.expectRevert(bytes("Deploy: empty domain entry"));
        deploy.parseDomains("6,,0");
    }

    /// @dev A value above uint32 must not wrap into some other domain.
    function test_ParseDomains_RejectsAboveUint32() public {
        vm.expectRevert(bytes("Deploy: domain out of range"));
        deploy.parseDomains("4294967296");
    }

    function test_ParseDomains_AcceptsUint32Max() public view {
        uint32[] memory d = deploy.parseDomains("4294967295");
        assertEq(d.length, 1);
        assertEq(d[0], type(uint32).max);
    }
}

/// @notice Token and CCTP addresses by chain. A factory deployed with another network's token addresses
/// would hold no real balance and could never pay out, and the addresses are immutable once deployed.
contract DeployNetworkAddressesTest is Test {
    Deploy internal deploy;

    function setUp() public {
        deploy = new Deploy();
    }

    function test_Addresses_ArcMainnet() public view {
        (address usdc, address eurc, address messenger) = deploy.networkAddresses(5042);
        assertEq(usdc, 0x3600000000000000000000000000000000000000);
        assertEq(eurc, 0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1);
        assertEq(messenger, 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d);
    }

    function test_Addresses_ArcTestnet() public view {
        (address usdc, address eurc, address messenger) = deploy.networkAddresses(5042002);
        assertEq(usdc, 0x3600000000000000000000000000000000000000);
        assertEq(eurc, 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a);
        assertEq(messenger, 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA);
    }

    function test_Addresses_RejectsOtherChains() public {
        vm.expectRevert(bytes("Deploy: not Arc mainnet or testnet"));
        deploy.networkAddresses(1);
    }

    /// @dev run() checks the chain before it reads any env or broadcasts.
    function test_Run_RejectsOtherChains() public {
        vm.chainId(84532);
        vm.expectRevert(bytes("Deploy: not Arc mainnet or testnet"));
        deploy.run();
    }
}
// forge-lint: disable-end(unused-return)

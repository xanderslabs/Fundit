// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, Vm, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Campaign} from "../../src/Campaign.sol";
import {CampaignFactory} from "../../src/CampaignFactory.sol";
import {ITokenMessengerV2} from "../../src/interfaces/ITokenMessengerV2.sol";
import {Metadata} from "../../src/Types.sol";

interface IArcMemo {
    function memo(address target, bytes calldata data, bytes32 memoId, bytes calldata memoData) external;
}

interface ITokenMinterV2 {
    function burnLimitsPerMessage(address token) external view returns (uint256);
    function getLocalToken(uint32 remoteDomain, bytes32 remoteToken) external view returns (address);
}

interface ITokenMessengerV2View {
    function localMinter() external view returns (address);
    function remoteTokenMessengers(uint32 domain) external view returns (bytes32);
}

// forge-lint: disable-start(unused-return, calls-loop, require-revert-in-loop)
/// @notice Checks against Arc mainnet state. Skipped unless ARC_FORK=1.
/// Run: ARC_FORK=1 arc-forge test --match-path test/fork/ArcFork.t.sol --fork-url arc -vv
/// Add ARC_FORK_STRICT=1 to turn the recorded findings (Memo, EIP-3009/2612, EURC domains)
/// into assertions, as a gate before a mainnet deploy. Without it those tests only log.
/// Upstream forge cannot run these: Arc USDC moves balances through the native-coin
/// precompile at 0x1800...0000, which only Arc Foundry (circlefin/arc-foundry) executes.
contract ArcForkTest is Test {
    uint256 internal constant ARC_CHAIN_ID = 5042;
    IERC20 internal constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    IERC20 internal constant EURC = IERC20(0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1);
    address internal constant TOKEN_MESSENGER = 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d;
    address internal constant MESSAGE_TRANSMITTER = 0x81D40F21F12A8F0E3252Bccb954D722d4c464B64;
    address internal constant MEMO = 0x5294E9927c3306DcBaDb03fe70b92e01cCede505;
    uint32 internal constant BASE_DOMAIN = 6;
    uint32 internal constant STANDARD_FINALITY = 2000;
    bytes32 internal constant DEPOSIT_FOR_BURN_TOPIC =
        keccak256("DepositForBurn(address,uint256,address,bytes32,uint32,bytes32,bytes32,uint256,uint32,bytes)");

    uint16 internal constant DONATION_FEE_BPS = 250;
    uint16 internal constant WITHDRAW_FEE_BPS = 100;

    CampaignFactory internal factory;
    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal creator = makeAddr("creator");
    address internal donor = makeAddr("donor");
    address internal payee = makeAddr("payee");
    bool internal strict;

    function setUp() public {
        if (vm.envOr("ARC_FORK", uint256(0)) != 1) {
            vm.skip(true, "set ARC_FORK=1 and fork Arc mainnet to run");
            return;
        }
        require(block.chainid == ARC_CHAIN_ID, "fork: not Arc mainnet");
        strict = vm.envOr("ARC_FORK_STRICT", uint256(0)) == 1;
        console.log("strict mode", strict);
        factory = new CampaignFactory(
            owner,
            treasury,
            USDC,
            EURC,
            ITokenMessengerV2(TOKEN_MESSENGER),
            DONATION_FEE_BPS,
            WITHDRAW_FEE_BPS,
            new uint32[](0)
        );
    }

    function test_Fork_AddressesHaveCode() public view {
        assertGt(address(USDC).code.length, 0, "USDC");
        assertGt(address(EURC).code.length, 0, "EURC");
        assertGt(TOKEN_MESSENGER.code.length, 0, "TokenMessengerV2");
        assertGt(MESSAGE_TRANSMITTER.code.length, 0, "MessageTransmitterV2");
        assertGt(MEMO.code.length, 0, "Memo");
        assertEq(IERC20Decimals(address(USDC)).decimals(), 6, "USDC decimals");
        assertEq(IERC20Decimals(address(EURC)).decimals(), 6, "EURC decimals");
    }

    /// @dev Real USDC end to end: create, donate, withdraw on Arc, claim fees.
    function test_Fork_DeployCreateDonateWithdrawArc() public {
        Campaign c = _createUsdcCampaign();
        _fundUsdc(donor, 100e6);

        vm.startPrank(donor);
        USDC.approve(address(c), 100e6);
        c.donate(99e6, 1e6, "fork donation");
        vm.stopPrank();

        uint256 fee = uint256(99e6) * DONATION_FEE_BPS / 10_000;
        assertEq(c.creatorBalance(), 99e6 - fee);
        assertEq(USDC.balanceOf(address(c)), 100e6);

        uint256 amount = c.creatorBalance();
        uint256 net = amount - amount * WITHDRAW_FEE_BPS / 10_000;
        vm.prank(creator);
        c.withdraw(amount, 26, bytes32(uint256(uint160(payee))), 0, 0, "");
        assertEq(USDC.balanceOf(payee), net, "payee net");
        // The native view of the same balance has 18 decimals.
        assertEq(payee.balance, net * 1e12, "native mirror");

        uint256 claimed = c.claimFees();
        assertEq(USDC.balanceOf(treasury), claimed);
        assertEq(USDC.balanceOf(address(c)), 0, "campaign empty");
    }

    /// @dev Real TokenMessengerV2 burn to Base (domain 6), standard transfer.
    function test_Fork_WithdrawToBase_ViaRealTokenMessenger() public {
        Campaign c = _createUsdcCampaign();
        _fundUsdc(donor, 50e6);
        vm.startPrank(donor);
        USDC.approve(address(c), 50e6);
        c.donate(50e6, 0, "");
        vm.stopPrank();

        uint256 amount = c.creatorBalance();
        uint256 net = amount - amount * WITHDRAW_FEE_BPS / 10_000;
        uint256 before = USDC.balanceOf(address(c));

        vm.recordLogs();
        vm.prank(creator);
        c.withdraw(amount, BASE_DOMAIN, bytes32(uint256(uint160(payee))), 0, STANDARD_FINALITY, "");
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(before - USDC.balanceOf(address(c)), net, "campaign drops by net");
        bool found = false;
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].emitter == TOKEN_MESSENGER && logs[i].topics[0] == DEPOSIT_FOR_BURN_TOPIC) {
                assertEq(logs[i].topics[1], bytes32(uint256(uint160(address(USDC)))), "burnToken");
                assertEq(logs[i].topics[2], bytes32(uint256(uint160(address(c)))), "depositor");
                (uint256 burned, bytes32 mintRecipient, uint32 dest,,,,) =
                    abi.decode(logs[i].data, (uint256, bytes32, uint32, bytes32, bytes32, uint256, bytes));
                assertEq(burned, net, "burn amount");
                assertEq(mintRecipient, bytes32(uint256(uint160(payee))), "mintRecipient");
                assertEq(dest, BASE_DOMAIN, "destination");
                found = true;
            }
        }
        assertTrue(found, "DepositForBurn not emitted by TokenMessengerV2");
    }

    /// @dev Records whether a donate() routed through Arc's Memo contract sees the EOA as msg.sender.
    /// Logs the result. Fails only in strict mode, when the donor is not the EOA.
    function test_Fork_MemoPreservesSender() public {
        Campaign c = _createUsdcCampaign();
        _fundUsdc(donor, 10e6);
        vm.prank(donor);
        USDC.approve(address(c), 10e6);

        bytes memory call = abi.encodeCall(Campaign.donate, (10e6, 0, "via memo"));
        vm.recordLogs();
        // Memo must be called by an EOA, so origin and sender are both the donor.
        vm.prank(donor, donor);
        (bool ok, bytes memory ret) =
            MEMO.call(abi.encodeCall(IArcMemo.memo, (address(c), call, bytes32(uint256(1)), bytes("fundit"))));
        Vm.Log[] memory logs = vm.getRecordedLogs();

        address seen = address(0);
        if (!ok) {
            console.log("MEMO: call reverted");
            console.logBytes(ret);
        } else {
            for (uint256 i = 0; i < logs.length; ++i) {
                if (logs[i].emitter == address(c) && logs[i].topics[0] == Campaign.Donated.selector) {
                    seen = address(uint160(uint256(logs[i].topics[1])));
                    break;
                }
            }
            console.log("MEMO: Donated donor", seen);
        }
        console.log("MEMO: preserves EOA sender", seen == donor);
        if (strict) {
            assertEq(seen, donor, "strict: Memo no longer preserves the EOA as donor; keep messages in donate()");
        }
    }

    /// @dev Records whether Arc USDC and EURC expose EIP-3009 and EIP-2612 entry points.
    /// Strict mode asserts all of them on both tokens.
    function test_Fork_UsdcSupportsEip3009() public view {
        _probeToken("USDC", address(USDC));
        _probeToken("EURC", address(EURC));
    }

    /// @dev Records, per candidate domain, whether CCTP on Arc can burn EURC. Strict mode asserts the
    /// 2026-10-16 finding (no domain works), so a change fails before a deploy with a stale list.
    function test_Fork_EurcCctpDomains() public {
        ITokenMinterV2 minter = ITokenMinterV2(ITokenMessengerV2View(TOKEN_MESSENGER).localMinter());
        console.log("EURC: TokenMinterV2", address(minter));
        console.log("EURC: burnLimitsPerMessage(EURC)", minter.burnLimitsPerMessage(address(EURC)));
        console.log("EURC: burnLimitsPerMessage(USDC)", minter.burnLimitsPerMessage(address(USDC)));

        uint32[4] memory domains = [uint32(0), 1, 6, 14];
        address[4] memory remoteEurc = [
            0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c, // Ethereum
            0xC891EB4cbdEFf6e073e859e987815Ed1505c2ACD, // Avalanche
            0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42, // Base
            0x1C60ba0A0eD1019e8Eb035E6daF4155A5cE2380B // World Chain
        ];
        address holder = makeAddr("eurcHolder");
        deal(address(EURC), holder, 10e6);

        for (uint256 i = 0; i < domains.length; ++i) {
            console.log("EURC: domain", domains[i]);
            console.log(
                "  remoteTokenMessenger set",
                ITokenMessengerV2View(TOKEN_MESSENGER).remoteTokenMessengers(domains[i]) != 0
            );
            console.log(
                "  linked local token", minter.getLocalToken(domains[i], bytes32(uint256(uint160(remoteEurc[i]))))
            );

            vm.startPrank(holder);
            EURC.approve(TOKEN_MESSENGER, 1e6);
            try ITokenMessengerV2(TOKEN_MESSENGER)
                .depositForBurn(
                    1e6, domains[i], bytes32(uint256(uint160(holder))), address(EURC), bytes32(0), 0, STANDARD_FINALITY
                ) {
                console.log("  depositForBurn(EURC) succeeded");
                if (strict) {
                    revert(
                        string.concat(
                            "strict: EURC burn now works for domain ",
                            vm.toString(domains[i]),
                            ". Update EURC_PAYOUT_DOMAINS (default empty) and the spec before deploying"
                        )
                    );
                }
            } catch Error(string memory reason) {
                console.log("  depositForBurn(EURC) reverted:", reason);
            } catch (bytes memory raw) {
                console.log("  depositForBurn(EURC) reverted (raw)");
                console.logBytes(raw);
            }
            vm.stopPrank();
        }
    }

    function _probeToken(string memory label, address token) internal view {
        (bool ok3009,) =
            token.staticcall(abi.encodeWithSignature("authorizationState(address,bytes32)", address(this), bytes32(0)));
        (bool okDomain, bytes memory sep) = token.staticcall(abi.encodeWithSignature("DOMAIN_SEPARATOR()"));
        (bool okNonces,) = token.staticcall(abi.encodeWithSignature("nonces(address)", address(this)));
        (bool okVersion, bytes memory version) = token.staticcall(abi.encodeWithSignature("version()"));
        console.log(label, "authorizationState (EIP-3009)", ok3009);
        console.log(label, "DOMAIN_SEPARATOR", okDomain);
        if (okDomain) console.logBytes32(abi.decode(sep, (bytes32)));
        console.log(label, "nonces (EIP-2612)", okNonces);
        if (okVersion) console.log(label, "version", abi.decode(version, (string)));
        if (strict) {
            assertTrue(ok3009, string.concat("strict: ", label, " lacks EIP-3009 authorizationState"));
            assertTrue(okDomain, string.concat("strict: ", label, " lacks DOMAIN_SEPARATOR"));
            assertTrue(okNonces, string.concat("strict: ", label, " lacks EIP-2612 nonces"));
        }
    }

    function _createUsdcCampaign() internal returns (Campaign) {
        Metadata memory meta;
        meta.title = "Fork test campaign";
        vm.prank(creator);
        return Campaign(factory.createCampaign(USDC, 1_000e6, meta));
    }

    /// @dev Arc USDC's ERC-20 balance is the native balance (18 decimals), so vm.deal funds it.
    /// stdcheats deal() cannot find a storage slot for it.
    function _fundUsdc(address to, uint256 amount6) internal {
        vm.deal(to, to.balance + amount6 * 1e12);
        assertGe(USDC.balanceOf(to), amount6, "USDC funding via native balance");
    }
}

// forge-lint: disable-end(unused-return, calls-loop, require-revert-in-loop)

interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

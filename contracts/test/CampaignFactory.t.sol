// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base} from "./helpers/Base.t.sol";
import {Campaign} from "../src/Campaign.sol";
import {CampaignFactory} from "../src/CampaignFactory.sol";
import {ITokenMessengerV2} from "../src/interfaces/ITokenMessengerV2.sol";
import {MetadataLib} from "../src/MetadataLib.sol";
import {Metadata, Summary} from "../src/Types.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

// Test-only false positives: expected-event emits, ignored return values in revert checks,
// and the block.timestamp cast mirror the contract under test.
// forge-lint: disable-start(reentrancy-events, unused-return, unsafe-typecast, calls-loop)
contract CampaignFactoryTest is Base {
    IERC20 internal usdcToken;
    IERC20 internal eurcToken;

    function setUp() public override {
        super.setUp();
        usdcToken = IERC20(address(usdc));
        eurcToken = IERC20(address(eurc));
    }

    // Each campaign must keep the fees it was created with, be indexed, and land at the
    // CREATE2 address the frontend predicts before the transaction is mined.
    function test_Create_SnapshotsFeesAndIndexes() public {
        address predicted = factory.predictAddress(alice, 0);

        vm.expectEmit(true, true, true, true, address(factory));
        emit CampaignFactory.CampaignCreated(
            predicted, alice, address(usdc), 1_000e6, DONATION_FEE_BPS, WITHDRAW_FEE_BPS
        );
        address c = _create(usdcToken, 1_000e6);

        assertEq(c, predicted);
        assertTrue(factory.isCampaign(c));
        assertEq(factory.campaignCount(), 1);
        assertEq(factory.campaignAt(0), c);
        assertEq(factory.campaignsOf(alice)[0], c);
        assertEq(factory.creatorNonce(alice), 1);

        Summary memory s = Campaign(c).summary();
        assertEq(s.creator, alice);
        assertEq(s.token, address(usdc));
        assertEq(s.goal, 1_000e6);
        assertEq(s.donationFeeBps, 250);
        assertEq(s.withdrawFeeBps, 100);
        assertEq(s.createdAt, uint64(block.timestamp));
        assertFalse(s.closed);
        assertEq(s.meta.title, _meta().title);
        assertEq(s.meta.links.length, 1);
        assertEq(s.meta.links[0], "https://example.com");
    }

    // A fee change by the owner must never reach campaigns that already exist.
    function test_Create_FeeChangeDoesNotAffectExisting() public {
        address oldC = _create(usdcToken, 1e6);
        vm.prank(owner);
        factory.setFees(500, 500);
        address newC = _create(eurcToken, 1e6);

        Summary memory a = Campaign(oldC).summary();
        Summary memory b = Campaign(newC).summary();
        assertEq(a.donationFeeBps, 250);
        assertEq(a.withdrawFeeBps, 100);
        assertEq(b.donationFeeBps, 500);
        assertEq(b.withdrawFeeBps, 500);
        assertEq(newC, factory.predictAddress(alice, 1));
    }

    // Only USDC and EURC are accepted; other tokens could break the balanceOf accounting.
    function test_Create_RevertsUnsupportedToken() public {
        MockERC20 other = new MockERC20("Other", "OTH", 6);
        vm.prank(alice);
        vm.expectRevert(CampaignFactory.UnsupportedToken.selector);
        factory.createCampaign(IERC20(address(other)), 1e6, _meta());
    }

    function test_Create_RevertsInvalidGoal() public {
        vm.prank(alice);
        vm.expectRevert(CampaignFactory.InvalidGoal.selector);
        factory.createCampaign(usdcToken, 0, _meta());
    }

    // Pausing blocks new campaigns only, and unpausing restores creation.
    function test_Create_RevertsWhenPaused() public {
        vm.expectEmit(address(factory));
        emit CampaignFactory.CreationPausedSet(true);
        vm.prank(owner);
        factory.pauseCreation();
        assertTrue(factory.creationPaused());

        vm.prank(alice);
        vm.expectRevert(CampaignFactory.CreationPaused.selector);
        factory.createCampaign(usdcToken, 1e6, _meta());

        vm.expectEmit(address(factory));
        emit CampaignFactory.CreationPausedSet(false);
        vm.prank(owner);
        factory.unpauseCreation();
        _create(usdcToken, 1e6);
    }

    // Metadata limits keep storage and the frontend bounded.
    function test_Create_RevertsInvalidMetadata() public {
        Metadata memory m = _meta();
        m.title = "";
        _expectInvalid(m);

        m = _meta();
        m.title = string(_bytesOf(101));
        _expectInvalid(m);

        m = _meta();
        m.links = new string[](6);
        _expectInvalid(m);

        m = _meta();
        m.imageUrl = "http://example.com/a.png";
        _expectInvalid(m);

        m = _meta();
        m.description = string(_bytesOf(5001));
        _expectInvalid(m);

        m = _meta();
        m.links[0] = string(_bytesOf(201));
        _expectInvalid(m);
    }

    // The limits are inclusive: values exactly at each cap are accepted.
    function test_Create_AcceptsMetadataAtLimits() public {
        Metadata memory m;
        m.title = string(_bytesOf(100));
        m.description = string(_bytesOf(5000));
        m.imageUrl = string.concat("https://", string(_bytesOf(492)));
        m.links = new string[](5);
        for (uint256 i = 0; i < 5; i++) {
            m.links[i] = string(_bytesOf(200));
        }
        vm.prank(alice);
        address c = factory.createCampaign(usdcToken, 1e6, m);
        assertEq(Campaign(c).summary().meta.links.length, 5);

        m.imageUrl = "";
        vm.prank(alice);
        factory.createCampaign(usdcToken, 1e6, m);
    }

    function test_SetFees_RevertsAbove500() public {
        vm.startPrank(owner);
        vm.expectRevert(CampaignFactory.FeeTooHigh.selector);
        factory.setFees(501, 0);
        vm.expectRevert(CampaignFactory.FeeTooHigh.selector);
        factory.setFees(0, 501);

        vm.expectEmit(address(factory));
        emit CampaignFactory.FeesUpdated(500, 0);
        factory.setFees(500, 0);
        vm.stopPrank();
        assertEq(factory.donationFeeBps(), 500);
        assertEq(factory.withdrawFeeBps(), 0);
    }

    function test_SetTreasury_RevertsZeroAndUpdates() public {
        vm.startPrank(owner);
        vm.expectRevert(CampaignFactory.ZeroAddress.selector);
        factory.setTreasury(address(0));

        vm.expectEmit(address(factory));
        emit CampaignFactory.TreasuryUpdated(bob);
        factory.setTreasury(bob);
        vm.stopPrank();
        assertEq(factory.treasury(), bob);
    }

    function test_SetFeatured_RevertsForNonCampaign() public {
        vm.prank(owner);
        vm.expectRevert(CampaignFactory.NotCampaign.selector);
        factory.setFeatured(bob);

        address c = _create(usdcToken, 1e6);
        vm.expectEmit(address(factory));
        emit CampaignFactory.FeaturedUpdated(c);
        vm.prank(owner);
        factory.setFeatured(c);
        assertEq(factory.featuredCampaign(), c);

        vm.prank(owner);
        factory.setFeatured(address(0));
        assertEq(factory.featuredCampaign(), address(0));
    }

    function test_OnlyOwner() public {
        address c = _create(usdcToken, 1e6);
        bytes memory err = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob);
        vm.startPrank(bob);
        vm.expectRevert(err);
        factory.setFees(0, 0);
        vm.expectRevert(err);
        factory.setTreasury(bob);
        vm.expectRevert(err);
        factory.setFeatured(c);
        vm.expectRevert(err);
        factory.pauseCreation();
        vm.expectRevert(err);
        factory.unpauseCreation();
        vm.expectRevert(err);
        factory.transferOwnership(bob);
        vm.stopPrank();
    }

    // Ownership moves only when the new owner accepts.
    function test_Ownership_IsTwoStep() public {
        vm.prank(owner);
        factory.transferOwnership(bob);
        assertEq(factory.owner(), owner);
        vm.prank(bob);
        factory.acceptOwnership();
        assertEq(factory.owner(), bob);
    }

    // The factory is immutable, so a zero address or a fee above the cap at deploy time
    // could never be corrected.
    function test_Constructor_RevertsBadConfig() public {
        vm.expectRevert(CampaignFactory.ZeroAddress.selector);
        new CampaignFactory(owner, address(0), usdcToken, eurcToken, messenger, 0, 0, _eurcDomains());
        vm.expectRevert(CampaignFactory.ZeroAddress.selector);
        new CampaignFactory(owner, treasury, IERC20(address(0)), eurcToken, messenger, 0, 0, _eurcDomains());
        vm.expectRevert(CampaignFactory.ZeroAddress.selector);
        new CampaignFactory(owner, treasury, usdcToken, IERC20(address(0)), messenger, 0, 0, _eurcDomains());
        vm.expectRevert(CampaignFactory.ZeroAddress.selector);
        new CampaignFactory(owner, treasury, usdcToken, eurcToken, ITokenMessengerV2(address(0)), 0, 0, _eurcDomains());
        vm.expectRevert(CampaignFactory.FeeTooHigh.selector);
        new CampaignFactory(owner, treasury, usdcToken, eurcToken, messenger, 501, 0, _eurcDomains());
        vm.expectRevert(CampaignFactory.FeeTooHigh.selector);
        new CampaignFactory(owner, treasury, usdcToken, eurcToken, messenger, 0, 501, _eurcDomains());
    }

    // Arc payouts are plain transfers and always allowed. An Arc entry in the EURC list would
    // suggest Arc goes through CCTP, so the deploy fails instead.
    function test_Constructor_RevertsArcInEurcList() public {
        uint32[] memory d = new uint32[](2);
        d[0] = 6;
        d[1] = 26;
        vm.expectRevert(CampaignFactory.InvalidDomain.selector);
        new CampaignFactory(owner, treasury, usdcToken, eurcToken, messenger, 0, 0, d);
    }

    // The EURC list is fixed at deploy. Each listed domain is stored and announced, and no
    // other domain is allowed.
    function test_Constructor_StoresEurcDomains() public {
        uint32[] memory d = _eurcDomains();
        for (uint256 i = 0; i < d.length; ++i) {
            vm.expectEmit(true, true, true, true);
            emit CampaignFactory.EurcPayoutDomainSet(d[i]);
        }
        CampaignFactory f = new CampaignFactory(owner, treasury, usdcToken, eurcToken, messenger, 0, 0, d);

        assertTrue(f.isEurcPayoutDomain(0));
        assertTrue(f.isEurcPayoutDomain(1));
        assertTrue(f.isEurcPayoutDomain(6));
        assertFalse(f.isEurcPayoutDomain(3));
        assertFalse(f.isEurcPayoutDomain(26));
    }

    // Only the pending owner can complete a transfer, so a typo'd or hostile address
    // cannot take the factory by calling acceptOwnership itself.
    function test_AcceptOwnership_RevertsForNonPending() public {
        address carol = makeAddr("carol");
        vm.prank(owner);
        factory.transferOwnership(bob);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, carol));
        factory.acceptOwnership();
        assertEq(factory.owner(), owner);
        assertEq(factory.pendingOwner(), bob);
    }

    // Renouncing would leave fees and the treasury frozen forever with no way to rotate a
    // compromised treasury, so the owner cannot give up ownership by accident.
    function test_RenounceOwnership_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(CampaignFactory.RenounceDisabled.selector);
        factory.renounceOwnership();
        assertEq(factory.owner(), owner);
    }

    // A second initialize would let anyone rewrite the creator and steal the funds.
    function test_Initialize_CannotBeCalledTwice() public {
        address c = _create(usdcToken, 1e6);
        vm.prank(address(factory));
        vm.expectRevert(Campaign.AlreadyInitialized.selector);
        Campaign(c).initialize(bob, usdcToken, 1, 0, 0, _meta());
        assertEq(address(Campaign(c).factory()), address(factory));
        assertEq(Campaign(c).creator(), alice);
    }

    // The implementation behind the clones can never be initialized by anyone.
    function test_Implementation_IsLocked() public {
        Campaign impl = Campaign(factory.implementation());
        vm.prank(bob);
        vm.expectRevert(Campaign.AlreadyInitialized.selector);
        impl.initialize(bob, usdcToken, 1, 0, 0, _meta());
    }

    function test_GetCampaigns_Bounds() public {
        address c0 = _create(usdcToken, 1e6);
        address c1 = _create(eurcToken, 1e6);
        address c2 = _create(usdcToken, 1e6);

        address[] memory page = factory.getCampaigns(1, 10);
        assertEq(page.length, 2);
        assertEq(page[0], c1);
        assertEq(page[1], c2);
        assertEq(factory.getCampaigns(5, 10).length, 0);
        assertEq(factory.getCampaigns(3, 1).length, 0);

        address[] memory all = factory.getCampaigns(0, type(uint256).max);
        assertEq(all.length, 3);
        assertEq(all[0], c0);
        assertEq(factory.getCampaigns(0, 1).length, 1);
    }

    function test_Summary_FreshCampaignRaisedZero() public {
        Summary memory s = Campaign(_create(usdcToken, 1e6)).summary();
        assertEq(s.raised, 0);
        assertEq(s.available, 0);
        assertEq(s.withdrawn, 0);
    }

    // Tokens that arrive without donate() (plain transfer, CCTP mint) count as raised at once,
    // and available already nets out the donation fee they will be charged on settle.
    function test_Summary_CountsUnaccountedInflow() public {
        address c = _create(usdcToken, 1e6);
        usdc.mint(c, 40e6);
        Summary memory s = Campaign(c).summary();
        assertEq(s.raised, 40e6);
        assertEq(s.available, 39e6);
        assertEq(Campaign(c).unaccounted(), 40e6);
    }

    function _expectInvalid(Metadata memory m) internal {
        vm.prank(alice);
        vm.expectRevert(MetadataLib.InvalidMetadata.selector);
        factory.createCampaign(usdcToken, 1e6, m);
    }

    function _bytesOf(uint256 n) internal pure returns (bytes memory b) {
        b = new bytes(n);
        for (uint256 i = 0; i < n; i++) {
            b[i] = "a";
        }
    }
}
// forge-lint: disable-end(reentrancy-events, unused-return, unsafe-typecast, calls-loop)

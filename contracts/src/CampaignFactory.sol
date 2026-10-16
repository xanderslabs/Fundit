// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Campaign} from "./Campaign.sol";
import {ICampaignFactory} from "./interfaces/ICampaignFactory.sol";
import {ITokenMessengerV2} from "./interfaces/ITokenMessengerV2.sol";
import {Metadata} from "./Types.sol";

/// @notice Deploys Campaign clones with CREATE2 and snapshots the current fees into each one.
/// The owner sets fees, the treasury, the featured campaign and can pause new campaigns.
/// The owner can never touch funds or pause donations and withdrawals on existing campaigns.
contract CampaignFactory is Ownable2Step, ICampaignFactory {
    error UnsupportedToken();
    error CreationPaused();
    error InvalidGoal();
    error FeeTooHigh();
    error ZeroAddress();
    error NotCampaign();
    error RenounceDisabled();
    error InvalidDomain();
    error InvalidBackup();

    event CampaignCreated(
        address indexed campaign,
        address indexed creator,
        address indexed token,
        uint256 goal,
        uint16 donationFeeBps,
        uint16 withdrawFeeBps
    );
    event FeesUpdated(uint16 donationFeeBps, uint16 withdrawFeeBps);
    event TreasuryUpdated(address indexed treasury);
    event FeaturedUpdated(address indexed campaign);
    event CreationPausedSet(bool paused);
    event EurcPayoutDomainSet(uint32 domain);
    event CampaignCreatorChanged(address indexed campaign, address indexed oldCreator, address indexed newCreator);

    uint16 public constant MAX_FEE_BPS = 500;
    /// @notice CCTP domain of Arc. EURC payouts there are plain transfers and need no list entry.
    uint32 public constant ARC_DOMAIN = 26;

    address public immutable implementation;
    IERC20 public immutable usdc;
    IERC20 public immutable eurc;
    ITokenMessengerV2 public immutable tokenMessenger;

    address public treasury;
    uint16 public donationFeeBps;
    uint16 public withdrawFeeBps;
    bool public creationPaused;
    address public featuredCampaign;
    mapping(address => bool) public isCampaign;
    mapping(address => uint256) public creatorNonce;
    /// @notice CCTP domains where EURC campaigns may pay out. Fixed at deploy, with no setter.
    mapping(uint32 => bool) public isEurcPayoutDomain;

    address[] private campaigns;
    mapping(address => address[]) private byCreator;

    constructor(
        address owner_,
        address treasury_,
        IERC20 usdc_,
        IERC20 eurc_,
        ITokenMessengerV2 messenger_,
        uint16 donationFeeBps_,
        uint16 withdrawFeeBps_,
        uint32[] memory eurcPayoutDomains_
    ) Ownable(owner_) {
        if (
            treasury_ == address(0) || address(usdc_) == address(0) || address(eurc_) == address(0)
                || address(messenger_) == address(0)
        ) revert ZeroAddress();
        if (donationFeeBps_ > MAX_FEE_BPS || withdrawFeeBps_ > MAX_FEE_BPS) revert FeeTooHigh();

        // The list is set here once and has no setter. Arc needs no entry: its payouts are plain transfers.
        for (uint256 i = 0; i < eurcPayoutDomains_.length; ++i) {
            uint32 domain = eurcPayoutDomains_[i];
            // A bad entry must fail the whole deploy, so the revert belongs in the loop.
            // forge-lint: disable-next-line(require-revert-in-loop)
            if (domain == ARC_DOMAIN) revert InvalidDomain();
            // forge-lint: disable-next-line(costly-loop)
            isEurcPayoutDomain[domain] = true;
            emit EurcPayoutDomainSet(domain);
        }

        implementation = address(new Campaign());
        usdc = usdc_;
        eurc = eurc_;
        tokenMessenger = messenger_;
        treasury = treasury_;
        donationFeeBps = donationFeeBps_;
        withdrawFeeBps = withdrawFeeBps_;
    }

    /// @param backup Address that can recover the campaign if the creator loses their key. Zero for none.
    function createCampaign(IERC20 token, uint256 goal, address backup, Metadata calldata meta)
        external
        returns (address campaign)
    {
        if (token != usdc && token != eurc) revert UnsupportedToken();
        if (creationPaused) revert CreationPaused();
        if (goal == 0) revert InvalidGoal();
        if (backup == msg.sender) revert InvalidBackup();

        campaign = Clones.cloneDeterministic(implementation, _salt(msg.sender, creatorNonce[msg.sender]++));
        isCampaign[campaign] = true;
        campaigns.push(campaign);
        byCreator[msg.sender].push(campaign);
        emit CampaignCreated(campaign, msg.sender, address(token), goal, donationFeeBps, withdrawFeeBps);

        Campaign(campaign).initialize(msg.sender, backup, token, goal, donationFeeBps, withdrawFeeBps, meta);
    }

    /// @notice Adds the calling campaign to campaignsOf(newCreator) after a completed recovery.
    /// @dev The old creator's list keeps the entry, so the app filters by summary().creator.
    function recordCreatorChange(address oldCreator, address newCreator) external {
        if (!isCampaign[msg.sender]) revert NotCampaign();
        byCreator[newCreator].push(msg.sender);
        emit CampaignCreatorChanged(msg.sender, oldCreator, newCreator);
    }

    function predictAddress(address creator, uint256 nonce) external view returns (address) {
        return Clones.predictDeterministicAddress(implementation, _salt(creator, nonce));
    }

    function campaignCount() external view returns (uint256) {
        return campaigns.length;
    }

    function campaignAt(uint256 index) external view returns (address) {
        return campaigns[index];
    }

    /// @notice Campaigns in creation order. Out-of-range offsets and limits are clamped.
    function getCampaigns(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        uint256 total = campaigns.length;
        if (offset >= total) return new address[](0);
        uint256 n = total - offset;
        if (limit < n) n = limit;
        page = new address[](n);
        for (uint256 i = 0; i < n; ++i) {
            page[i] = campaigns[offset + i];
        }
    }

    function campaignsOf(address creator) external view returns (address[] memory) {
        return byCreator[creator];
    }

    function setFees(uint16 donationBps, uint16 withdrawBps) external onlyOwner {
        if (donationBps > MAX_FEE_BPS || withdrawBps > MAX_FEE_BPS) revert FeeTooHigh();
        donationFeeBps = donationBps;
        withdrawFeeBps = withdrawBps;
        emit FeesUpdated(donationBps, withdrawBps);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    /// @notice Sets the featured campaign. Zero clears it.
    function setFeatured(address campaign) external onlyOwner {
        if (campaign != address(0) && !isCampaign[campaign]) revert NotCampaign();
        featuredCampaign = campaign;
        emit FeaturedUpdated(campaign);
    }

    function pauseCreation() external onlyOwner {
        creationPaused = true;
        emit CreationPausedSet(true);
    }

    function unpauseCreation() external onlyOwner {
        creationPaused = false;
        emit CreationPausedSet(false);
    }

    /// @notice Always reverts. Without an owner the treasury could never be rotated.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    function _salt(address creator, uint256 nonce) private pure returns (bytes32) {
        return keccak256(abi.encode(creator, nonce));
    }
}

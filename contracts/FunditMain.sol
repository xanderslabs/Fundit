// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { OApp, Origin, MessagingFee } from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol"; 
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract FunditMain is OApp, Pausable, ReentrancyGuard  {
    using SafeERC20 for IERC20;

    // --- CONSTRUCTOR ---
    constructor(address _endpoint, address _feeWallet, address _vaultWallet, uint256 _feeBasisPoints) OApp(_endpoint, msg.sender) Ownable(msg.sender) {
        require(_feeWallet != address(0), "Invalid fee wallet");
        require(_vaultWallet != address(0), "Invalid vault wallet");
        require(_feeBasisPoints < BASIS_POINTS_DIVISOR, "Fee too high");
        feeWallet = _feeWallet;
        vaultWallet = _vaultWallet;
        feeBasisPoints = _feeBasisPoints;
    }

    // --- STRUCTS & STATE ---

    struct Campaign {
        string name;
        uint256 target;
        string description;
        string socialLink;
        uint256 imageId;
        address creator;
        bool ended;
        uint256 totalStable;
    }

    struct WithdrawalRequest {
        uint256 requestId;
        address requester;
        uint256 amount;
        address token;
        uint256 targetChainId;
        bool processed;
    }

    uint256 public campaignCount;
    mapping(uint256 => Campaign) public campaigns;

    uint256 public withdrawalRequestCount;
    mapping(uint256 => WithdrawalRequest) public withdrawalRequests;

    // --- BALANCE RECORD KEEPING ---
    mapping(address => uint256) public userTotalBalance;
    mapping(address => uint256) public creatorEndedBalance;
    mapping(address => uint256) public userWithdrawnBalance;

     // --- TOKEN PRICE FEED ---
    mapping(address => address) public tokenToPriceFeed;

    // USD decimals constant for reference.
    uint8 public constant USD_DECIMALS = 8;

    // --- ADDRESSES ---
    address public feeWallet;
    address public vaultWallet;

    // --- FEE CONFIGURATION ---
    uint256 public feeBasisPoints; // e.g., 14 means 1.4%.
    uint256 public constant BASIS_POINTS_DIVISOR = 1000;

    // --- EVENTS
    event FeeWalletUpdated(address indexed newFeeWallet);
    event VaultWalletUpdated(address indexed newVaultWallet);
    event FeeBasisPointsUpdated(uint256 newFeeBasisPoints);
    event CampaignCreated(uint256 indexed campaignId, address indexed creator);
    event CampaignEdited(uint256 indexed campaignId);
    event DonationMade(uint256 indexed campaignId, address indexed donor, uint256 netUSDValue);
    event CampaignEnded(uint256 indexed campaignId, uint256 finalStableValue);
    event WithdrawalRequested(uint256 requestId, address indexed requester, uint256 amount, address token, uint256 targetChainId);
    event WithdrawalProcessed(uint256 requestId, address indexed requester, uint256 amount, address token, uint256 targetChainId);
    event FeaturedCampaignSet(uint256 indexed campaignId);
    event PriceFeedSet(address indexed token, address priceFeed);

    /// @notice Update the fee wallet address.
    function updateFeeWallet(address newFeeWallet) external onlyOwner {
        require(newFeeWallet != address(0), "Invalid fee wallet");
        feeWallet = newFeeWallet;
        emit FeeWalletUpdated(newFeeWallet);
    }

    /// @notice Update the vault wallet address.
    function updateVaultWallet(address newVaultWallet) external onlyOwner {
        require(newVaultWallet != address(0), "Invalid vault wallet");
        vaultWallet = newVaultWallet;
        emit VaultWalletUpdated(newVaultWallet);
    }

    /// @notice Update the fee percentage in basis points.
    function updateFeeBasisPoints(uint256 newFeeBasisPoints) external onlyOwner {
        require(newFeeBasisPoints < BASIS_POINTS_DIVISOR, "Fee too high");
        feeBasisPoints = newFeeBasisPoints;
        emit FeeBasisPointsUpdated(newFeeBasisPoints);
    }

    // --- NEW: setPeer function ---
    function setPeer(uint32 _eid, address _peerAddress) external onlyOwner {
        bytes32 peerBytes = bytes32(uint256(uint160(_peerAddress)));
        peers[_eid] = peerBytes;
        emit PeerSet(_eid, peerBytes);
    }

    // Modify the setPriceFeed function:
    function setPriceFeed(address token, address priceFeed) external onlyOwner {
        require(priceFeed != address(0), "Invalid price feed address");
        require(tokenToPriceFeed[token] == address(0), "Price feed already set for this token");
        tokenToPriceFeed[token] = priceFeed;
        emit PriceFeedSet(token, priceFeed);
    }

    function addressToBytes32(address _addr) public pure returns (bytes32) {
        return bytes32(uint256(uint160(_addr)));
    }


    function bytes32ToAddress(bytes32 _b) public pure returns (address) {
        return address(uint160(uint256(_b)));
    }

    // --- FEATURED CAMPAIGN ---
    uint256 public featuredCampaignId;

    function setFeaturedCampaign(uint256 campaignId) external onlyOwner {
        require(campaigns[campaignId].creator != address(0), "Campaign does not exist");
        featuredCampaignId = campaignId;
        emit FeaturedCampaignSet(campaignId);
    }

    // --- USERNAMES ---

    mapping(address => string) public usernames;

    function setUsername(string calldata username) external whenNotPaused {
        usernames[msg.sender] = username;
    }


    /// @notice Pause the contract.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause the contract.
    function unpause() external onlyOwner {
        _unpause();
    }

    // --- PAUSABLE WITHDRAWALS ---
    bool public withdrawalsPaused;

    /// @notice Pause new withdrawal requests.
    function pauseWithdrawals() external onlyOwner {
        withdrawalsPaused = true;
    }

    /// @notice Unpause new withdrawal requests.
    function unpauseWithdrawals() external onlyOwner {
        withdrawalsPaused = false;
    }

    // --- CAMPAIGN MANAGEMENT FUNCTIONS ---
    /// @notice Create a new crowdfunding campaign.
    function createCampaign( string calldata name, uint256 target, string calldata description, string calldata socialLink, uint256 imageId) external whenNotPaused {
        campaignCount++;
        campaigns[campaignCount] = Campaign({
            name: name,
            target: target,
            description: description,
            socialLink: socialLink,
            imageId: imageId,
            creator: msg.sender,
            ended: false,
            totalStable: 0
        });
        emit CampaignCreated(campaignCount, msg.sender);
    }

    /// @notice Edit an active campaign. Only the campaign creator may edit.
    /// For each field, if the input is "empty" (for strings: length 0, for numbers: 0), that field is not updated.
    function editCampaign( uint256 campaignId, string calldata name, uint256 target, string calldata description, string calldata socialLink, uint256 imageId) external whenNotPaused {
        Campaign storage campaign = campaigns[campaignId];
        require(msg.sender == campaign.creator, "Only creator can edit");
        require(!campaign.ended, "Cannot edit ended campaign");

        if (bytes(name).length > 0) {
            campaign.name = name;
        }
        if (target > 0) {
            campaign.target = target;
        }
        if (bytes(description).length > 0) {
            campaign.description = description;
        }
        if (bytes(socialLink).length > 0) {
            campaign.socialLink = socialLink;
        }
        if (imageId > 0) {
            campaign.imageId = imageId;
        }
        emit CampaignEdited(campaignId);
    }

    /// @notice End a campaign. Only the campaign creator may end their campaign.
    /// Upon ending, the campaign’s total donated funds become withdrawable.
    function endCampaign(uint256 campaignId) external whenNotPaused {
        Campaign storage campaign = campaigns[campaignId];
        require(msg.sender == campaign.creator, "Only creator can end campaign");
        require(!campaign.ended, "Campaign already ended");
        campaign.ended = true;
        creatorEndedBalance[campaign.creator] += campaign.totalStable;
        emit CampaignEnded(campaignId, campaign.totalStable);
    }

    // --- DONATION FUNCTIONS ---

    /// @notice Donate to a campaign using either an ERC20 token or native coin.
    /// For native coin donations, pass address(0) as the token and send native coin in msg.value;
    /// For native coin donations, the `amount` parameter is ignored (you can pass 0).
    function donate(uint256 campaignId, address token, uint256 amount) external payable nonReentrant whenNotPaused {
        Campaign storage campaign = campaigns[campaignId];
        require(!campaign.ended, "Campaign ended");

        uint256 usdValue;
        if (token == address(0)) {
            // --- Native Coin Donation ---
            require(msg.value > 0, "No native coin sent");
            usdValue = convertNativeToUSD(msg.value);
            uint256 feeUsd = (usdValue * feeBasisPoints) / BASIS_POINTS_DIVISOR;
            uint256 netUsd = usdValue - feeUsd;
            (bool feeSent, ) = feeWallet.call{value: (msg.value * feeBasisPoints) / BASIS_POINTS_DIVISOR}("");
            require(feeSent, "Fee transfer failed");
            (bool vaultSent, ) = vaultWallet.call{value: msg.value - ((msg.value * feeBasisPoints) / BASIS_POINTS_DIVISOR)}("");
            require(vaultSent, "Vault transfer failed");
            campaign.totalStable += netUsd;
            userTotalBalance[campaign.creator] += netUsd;
            emit DonationMade(campaignId, msg.sender, netUsd);
        } else {
            // --- ERC20 Donation ---
            require(tokenToPriceFeed[token] != address(0), "Token not supported");
            require(amount > 0, "Donation must be > 0");
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
            usdValue = convertTokenToUSD(token, amount);
            uint256 tokenFee = (amount * feeBasisPoints) / BASIS_POINTS_DIVISOR;
            uint256 netToken = amount - tokenFee;
            IERC20(token).safeTransfer(feeWallet, tokenFee);
            IERC20(token).safeTransfer(vaultWallet, netToken);
            uint256 feeUsd = (usdValue * feeBasisPoints) / BASIS_POINTS_DIVISOR;
            uint256 netUsd = usdValue - feeUsd;
            campaign.totalStable += netUsd;
            userTotalBalance[campaign.creator] += netUsd;
            emit DonationMade(campaignId, msg.sender, netUsd);
        }
    }


    function _lzReceive(Origin calldata _origin, bytes32, bytes calldata payload, address, bytes calldata) internal override {
        require(_origin.sender == peers[_origin.srcEid], "Untrusted sender");
        (uint256 campaignId, uint256 donationAmount) = abi.decode(payload, (uint256, uint256));
        require(campaignId > 0 && campaignId <= campaignCount, "Invalid campaign");
        Campaign storage campaign = campaigns[campaignId];
        require(!campaign.ended, "Campaign ended");
        campaign.totalStable += donationAmount;
        userTotalBalance[campaign.creator] += donationAmount;
        emit DonationMade(campaignId, address(uint160(uint256(_origin.sender))), donationAmount);
    }

    function requestWithdrawal(uint256 amount, address token, uint256 targetChainId) external whenNotPaused {
        require(token != address(0), "Token not supported for withdrawal");
        require(!withdrawalsPaused, "Withdrawal requests are paused");
        uint256 withdrawable = creatorEndedBalance[msg.sender] - userWithdrawnBalance[msg.sender];
        uint256 usdValue = convertTokenToUSD(token, amount);
        require(usdValue <= withdrawable, "Amount exceeds withdrawable balance");

        uint256 feeUsd = (usdValue * feeBasisPoints) / BASIS_POINTS_DIVISOR;
        uint256 netUsd = usdValue - feeUsd;
        userWithdrawnBalance[msg.sender] += usdValue;

        withdrawalRequestCount++;
        withdrawalRequests[withdrawalRequestCount] = WithdrawalRequest({
            requestId: withdrawalRequestCount,
            requester: msg.sender,
            amount: netUsd,
            token: token,
            targetChainId: targetChainId,
            processed: false
        });
        emit WithdrawalRequested(withdrawalRequestCount, msg.sender, netUsd, token, targetChainId);
    }


    function processWithdrawalRequest(uint256 requestId) external onlyOwner nonReentrant {
        WithdrawalRequest storage req = withdrawalRequests[requestId];
        require(!req.processed, "Already processed");
        req.processed = true;
        emit WithdrawalProcessed(requestId, req.requester, req.amount, req.token, req.targetChainId);
    }

    // --- PRICE FEED CONVERSION HELPERS ---

    function convertTokenToUSD(address token, uint256 tokenAmount) public view returns (uint256 usdValue) {
        address priceFeedAddress = tokenToPriceFeed[token];
        require(priceFeedAddress != address(0), "Price feed not set for token");
        AggregatorV3Interface priceFeed = AggregatorV3Interface(priceFeedAddress);
        (, int256 price, , , ) = priceFeed.latestRoundData();
        require(price > 0, "Invalid price");
        uint8 tokenDecimals = IERC20Metadata(token).decimals();
        usdValue = (tokenAmount * uint256(price)) / (10 ** tokenDecimals);
    }

    function convertNativeToUSD(uint256 nativeAmount) public view returns (uint256 usdValue) {
        address priceFeedAddress = tokenToPriceFeed[address(0)];
        require(priceFeedAddress != address(0), "Native coin price feed not set");
        AggregatorV3Interface priceFeed = AggregatorV3Interface(priceFeedAddress);
        (, int256 price, , , ) = priceFeed.latestRoundData();
        require(price > 0, "Invalid price");
        usdValue = (nativeAmount * uint256(price)) / 1e18;
    }


    function getCampaigns(uint256 offset, uint256 limit) external view returns (Campaign[] memory) {
        if (offset < 1) {
            offset = 1;
        }
        uint256 end = offset + limit - 1;
        if (end > campaignCount) {
            end = campaignCount;
        }
        uint256 count = end - offset + 1;
        Campaign[] memory result = new Campaign[](count);
        uint256 j = 0;
        for (uint256 i = offset; i <= end; i++) {
            result[j] = campaigns[i];
            j++;
        }
        return result;
    }


    function emergencyRescue(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            (bool sent, ) = owner().call{value: amount}("");
            require(sent, "Failed to send native coin");
        } else {
            IERC20(token).safeTransfer(owner(), amount);
        }
    }

    receive() external payable {}
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { OApp, Origin, MessagingFee } from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { OptionsBuilder } from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract FunditRemote is OApp, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using OptionsBuilder for bytes;

    // --- CONSTRUCTOR ---
    constructor(address _endpoint, address _feeWallet, address _vaultWallet, uint256 _feeBasisPoints) OApp(_endpoint, msg.sender) Ownable(msg.sender) {
        require(_feeWallet != address(0), "Invalid fee wallet");
        require(_vaultWallet != address(0), "Invalid vault wallet");
        require(_feeBasisPoints < BASIS_POINTS_DIVISOR, "Fee too high");
        feeWallet = _feeWallet;
        vaultWallet = _vaultWallet;
        feeBasisPoints = _feeBasisPoints;
    }

    // --- State Variables ---
    uint256 public donationCount;
    struct Donation {
        uint256 campaignId;
        uint256 netUsd;
        bool relayed;
        address donor;
    }
    mapping(uint256 => Donation) public donations;

    // USD decimals constant for reference (e.g., 8 decimals).
    uint8 public constant USD_DECIMALS = 8;

    // --- ADDRESSES ---
    address public feeWallet;
    address public vaultWallet;

    // --- FEE CONFIGURATION ---
    uint256 public feeBasisPoints; // e.g., 14 means 1.4%.
    uint256 public constant BASIS_POINTS_DIVISOR = 1000;

    // --- TOKEN PRICE FEED ---
    mapping(address => address) public tokenToPriceFeed;

    // --- EVENTS ---
    event FeeWalletUpdated(address indexed newFeeWallet);
    event VaultWalletUpdated(address indexed newVaultWallet);
    event FeeBasisPointsUpdated(uint256 newFeeBasisPoints);
    event DonationMade(uint256 indexed donationId, uint256 campaignId, address indexed donor, uint256 netUSDValue);
    event DonationRelayed(uint256 indexed donationId, uint32 dstEid);
    event PriceFeedSet(address indexed token, address priceFeed);

    /// @notice Update the fee wallet address. Only the owner can call this.
    function updateFeeWallet(address newFeeWallet) external onlyOwner {
        require(newFeeWallet != address(0), "Invalid fee wallet");
        feeWallet = newFeeWallet;
        emit FeeWalletUpdated(newFeeWallet);
    }

    /// @notice Update the vault wallet address. Only the owner can call this.
    function updateVaultWallet(address newVaultWallet) external onlyOwner {
        require(newVaultWallet != address(0), "Invalid vault wallet");
        vaultWallet = newVaultWallet;
        emit VaultWalletUpdated(newVaultWallet);
    }

    /// @notice Update the fee percentage in basis points. Only the owner can call this.
    function updateFeeBasisPoints(uint256 newFeeBasisPoints) external onlyOwner {
        require(newFeeBasisPoints < BASIS_POINTS_DIVISOR, "Fee too high");
        feeBasisPoints = newFeeBasisPoints;
        emit FeeBasisPointsUpdated(newFeeBasisPoints);
    }

    // Modify the setPriceFeed function:
    function setPriceFeed(address token, address priceFeed) external onlyOwner {
        require(priceFeed != address(0), "Invalid price feed address");
        require(tokenToPriceFeed[token] == address(0), "Price feed already set for this token");
        tokenToPriceFeed[token] = priceFeed;
        emit PriceFeedSet(token, priceFeed);
    }

    function setPeer(uint32 _eid, address _peerAddress) external onlyOwner {
        bytes32 peerBytes = bytes32(uint256(uint160(_peerAddress)));
        peers[_eid] = peerBytes;
        emit PeerSet(_eid, peerBytes);
    }

    function generateOptions(uint128 gasLimit) public pure returns (bytes memory) {
        return OptionsBuilder.newOptions().addExecutorLzReceiveOption(gasLimit, 0);
    }

    function addressToBytes32(address _addr) public pure returns (bytes32) {
        return bytes32(uint256(uint160(_addr)));
    }


    function bytes32ToAddress(bytes32 _b) public pure returns (address) {
        return address(uint160(uint256(_b)));
    }

    /// @notice Pause the contract. Only the owner can call this.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause the contract. Only the owner can call this.
    function unpause() external onlyOwner {
        _unpause();
    }

    // --- FEE QUOTE VIEW FUNCTION ---
    /// @notice Returns a fee estimate (native fee) based on a demo donation payload.
    function getQuote(uint32 _dstEid, uint256 campaignId, bytes calldata _options) external view returns (uint256 nativeFee) {
        bool payInLzToken = false;
        uint256 dummyDonationUsd = 1000000000;
        bytes memory payload = abi.encode(campaignId, dummyDonationUsd);
        MessagingFee memory fee = _quote( _dstEid, payload, _options, payInLzToken);
        nativeFee = fee.nativeFee + ((fee.nativeFee * 2) / 10);
    }


    function donate(uint256 campaignId, address token, uint256 amount) external payable nonReentrant whenNotPaused returns (uint256 donationId){
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
            donationCount++;
            donationId = donationCount;
            donations[donationId] = Donation({
                campaignId: campaignId,
                netUsd: netUsd,
                relayed: false,
                donor: msg.sender
            });
            emit DonationMade(donationId, campaignId, msg.sender, netUsd);
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
            donationCount++;
            donationId = donationCount;
            donations[donationId] = Donation({
                campaignId: campaignId,
                netUsd: netUsd,
                relayed: false,
                donor: msg.sender
            });
            emit DonationMade(donationId, campaignId, msg.sender, netUsd);
        }
        return donationId;
    }

    /// @dev Sends the cross-chain message with the net donation USD amount.
    function _sendCrossChainMessage(
        uint256 donationId,
        uint32 _dstEid,
        bytes calldata _options
    ) external payable nonReentrant {
         Donation storage donation = donations[donationId];
        require(!donation.relayed, "Donation already relayed");
        bytes memory payload = abi.encode(donation.campaignId, donation.netUsd);
        
        _lzSend(
            _dstEid,
            payload,
            _options,
            MessagingFee(msg.value, 0),
            payable(msg.sender)
        );
        donation.relayed = true;
        emit DonationRelayed(donationId, _dstEid);
    }




    // --- PRICE FEED CONVERSION HELPERS ---
    function convertTokenToUSD(address token, uint256 tokenAmount) public view returns (uint256 usdValue) {
        address priceFeedAddress = tokenToPriceFeed[token];
        require(priceFeedAddress != address(0), "Price feed not set for token");
        AggregatorV3Interface priceFeed = AggregatorV3Interface(priceFeedAddress);
        (, int256 price, , , ) = priceFeed.latestRoundData();
        require(price > 0, "Invalid price");
        uint8 tokenDecimals = IERC20Metadata(token).decimals();
        usdValue = (tokenAmount * uint256(price)) / (10**tokenDecimals);
    }

    function convertNativeToUSD(uint256 nativeAmount) public view returns (uint256 usdValue) {
        address priceFeedAddress = tokenToPriceFeed[address(0)];
        require( priceFeedAddress != address(0), "Native coin price feed not set");
        AggregatorV3Interface priceFeed = AggregatorV3Interface(priceFeedAddress);
        (, int256 price, , , ) = priceFeed.latestRoundData();
        require(price > 0, "Invalid price");
        usdValue = (nativeAmount * uint256(price)) / 1e18;
    }

    function _lzReceive( Origin calldata,  bytes32, bytes calldata, address, bytes calldata) internal pure override {
        revert("Not implemented");
    }

    // --- EMERGENCY WITHDRAW FUNCTIONS ---

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

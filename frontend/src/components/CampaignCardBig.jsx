import PropTypes from "prop-types";
import { useState, useEffect, useMemo, useRef } from "react";
import { ethers } from "ethers";
import {
  useWriteContract,
  useAccount,
  useSwitchChain,
  useChainId,
  usePublicClient,
} from "wagmi";
import { ref, getDownloadURL } from "firebase/storage";
import mainChainABI from "../abis/mainChainABI.json";
import remoteChainABI from "../abis/remoteChainABI.json";
import erc20ABI from "../abis/erc20ABI.json";
import networks from "../config/networks.json";
import TransactionProcessingModal from "../components/TransactionProcessingModal";
import TransactionSuccessModal from "../components/TransactionSuccessModal";
import TransactionFailedModal from "../components/TransactionFailedModal";
import { storage } from "../firebase/config";
import { shortenWalletAddress } from "../utils/helpers";
import Modal from "./Modal.jsx";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function TopUpModal({
  visible,
  onClose,
  campaign,
  onproxyDonate,
  onCardDonate,
}) {
  return (
    <Modal visible={visible} onClose={onClose}>
      <div className="top-up-content">
        <div className="modal-l1">
          <h2>More Donation Options</h2>
        </div>
        <div className="top-up-options">
          <div
            className="top-up-optionsa"
            onClick={() => onproxyDonate(campaign.id)}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g clipPath="url(#clip0_2254_1722)">
                <path
                  d="M16.05 12.05L21 17L16.05 21.95L14.636 20.536L17.172 17.999L4 18V16H17.172L14.636 13.464L16.05 12.05ZM7.95 2.04999L9.364 3.46399L6.828 5.99999H20V7.99999H6.828L9.364 10.536L7.95 11.95L3 6.99999L7.95 2.04999Z"
                  fill="#586283"
                />
              </g>
              <defs>
                <clipPath id="clip0_2254_1722">
                  <rect width="24" height="24" fill="white" />
                </clipPath>
              </defs>
            </svg>
            <span>Donate by Proxy</span>
          </div>
          <div
            className="top-up-optionsa"
            onClick={() => onCardDonate(campaign.id)}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g clipPath="url(#clip0_2254_1725)">
                <path
                  d="M3 3H21C21.2652 3 21.5196 3.10536 21.7071 3.29289C21.8946 3.48043 22 3.73478 22 4V20C22 20.2652 21.8946 20.5196 21.7071 20.7071C21.5196 20.8946 21.2652 21 21 21H3C2.73478 21 2.48043 20.8946 2.29289 20.7071C2.10536 20.5196 2 20.2652 2 20V4C2 3.73478 2.10536 3.48043 2.29289 3.29289C2.48043 3.10536 2.73478 3 3 3ZM20 11H4V19H20V11ZM20 9V5H4V9H20ZM14 15H18V17H14V15Z"
                  fill="#586283"
                />
              </g>
              <defs>
                <clipPath id="clip0_2254_1725">
                  <rect width="24" height="24" fill="white" />
                </clipPath>
              </defs>
            </svg>
            <span>Donate by Card</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

TopUpModal.propTypes = {
  visible: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  campaign: PropTypes.object.isRequired,
  onproxyDonate: PropTypes.func.isRequired,
  onCardDonate: PropTypes.func.isRequired,
};

function CampaignCardBig({
  campaign,
  onShare,
  selectedTokenSymbol,
  selectedChain,
  onTokenSelectorClick,
  onproxyDonate,
}) {
  const [imageUrl, setImageUrl] = useState("/assets/images/placeholderimg.png");
  const [imageError, setImageError] = useState(false);
  const { address, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  const activeChain = useChainId();
  const [topUpModalVisible, setTopUpModalVisible] = useState(false);

  const chainReference = useRef(activeChain);
  useEffect(() => {
    chainReference.current = activeChain;
  }, [activeChain]);

  const [processingModalVisible, setProcessingModalVisible] = useState(false);
  const [successModalVisible, setSuccessModalVisible] = useState(false);
  const [failedModalVisible, setFailedModalVisible] = useState(false);
  const [donationAmount, setDonationAmount] = useState("");
  const [usdValue, setUsdValue] = useState("0");
  const [tokenBalance, setTokenBalance] = useState("0");

  useEffect(() => {
    async function loadImageFromFirebase() {
      // Use campaign.image instead of campaign.imageId
      const imageIdentifier = campaign.image;

      // Check for invalid image identifiers
      if (
        !imageIdentifier ||
        imageIdentifier === "0" ||
        imageIdentifier === 0
      ) {
        setImageUrl("/assets/images/placeholderimg.png");
        setImageError(true);
        return;
      }

      try {
        const imageReference = ref(storage, `images/${imageIdentifier}`);
        const url = await getDownloadURL(imageReference);
        setImageUrl(url);
        setImageError(false);
      } catch (error) {
        console.error(
          "Error loading image:",
          error.message,
          "for image:",
          imageIdentifier,
        );
        setImageUrl("/assets/images/placeholderimg.png");
        setImageError(true);
      }
    }

    loadImageFromFirebase();
  }, [campaign.image]);

  const networkConfig = useMemo(() => {
    const found = networks.find(
      (net) => net.chain.toLowerCase() === selectedChain.toLowerCase(),
    );
    return (
      found || {
        chain: selectedChain,
        chainId: 0,
        funditContract: ZERO_ADDRESS,
        nativeToken: { address: ZERO_ADDRESS },
        tokens: {},
      }
    );
  }, [selectedChain]);

  // Helper function to wait until the chain updates
  const waitForChainChange = async (
    targetChainId,
    timeout = 10_000,
    intervalTime = 500,
  ) => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (chainReference.current === targetChainId) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalTime));
    }

    throw new Error("Network change timeout");
  };

  const USD_DECIMALS = 8;

  // Inside the WithdrawModal component
  // Current implementation is good but could be more robust
  const formatUSDValue = (value) => {
    try {
      const formatted = ethers.formatUnits(value, USD_DECIMALS);
      return isNaN(formatted) ? "0" : formatted;
    } catch (error) {
      console.error("Error formatting USD value:", error);
      return "0";
    }
  };

  const publicClient = usePublicClient({
    chainId: networkConfig.chainId,
  });

  const tokenKey = selectedTokenSymbol.toLowerCase();
  const tokenData = networkConfig.tokens[tokenKey];
  const tokenAddress = tokenData
    ? tokenData.address
    : networkConfig.nativeToken.address;

  useEffect(() => {
    const updateUSDValue = async () => {
      if (!donationAmount) {
        setUsdValue("0");
        return;
      }

      try {
        let tokenDecimals = 18;

        if (tokenAddress !== ZERO_ADDRESS) {
          const decimalsData = await publicClient.readContract({
            address: tokenAddress,
            abi: erc20ABI,
            functionName: "decimals",
          });
          tokenDecimals = Number(decimalsData);
        }

        const parsedAmount = ethers.parseUnits(donationAmount, tokenDecimals);
        const contractABI =
          networkConfig.chainId === 137 ? mainChainABI : remoteChainABI;
        let converted;
        if (tokenAddress === ZERO_ADDRESS) {
          converted = await publicClient.readContract({
            address: networkConfig.funditContract,
            abi: contractABI,
            functionName: "convertNativeToUSD",
            args: [parsedAmount],
          });
        } else {
          converted = await publicClient.readContract({
            address: networkConfig.funditContract,
            abi: contractABI,
            functionName: "convertTokenToUSD",
            args: [tokenAddress, parsedAmount],
          });
        }

        // Format the USD value with 8 decimals
        const formattedUSD = formatUSDValue(converted);
        setUsdValue(formattedUSD);
      } catch (error) {
        console.error("Conversion error:", error);
        setUsdValue("0");
      }
    };

    const debounceTimer = setTimeout(() => {
      updateUSDValue();
    }, 500);

    return () => clearTimeout(debounceTimer);
  }, [donationAmount, tokenAddress, networkConfig, publicClient]);

  const formatAmount = (amount) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);

  const { writeContractAsync: approveWrite } = useWriteContract();
  const donationABI =
    networkConfig.chainId === 137 ? mainChainABI : remoteChainABI;
  const { writeContractAsync: donateWrite } = useWriteContract();
  const { writeContractAsync: sendCrosschainWrite } = useWriteContract();

  const polygonNetwork = networks.find((net) => net.chainId === 137);

  const handleDonate = async () => {
    if (!donationAmount || !isConnected) {
      return;
    }

    try {
      if (activeChain !== networkConfig.chainId && switchChain) {
        switchChain({ chainId: networkConfig.chainId });
        await waitForChainChange(networkConfig.chainId);
      }

      setProcessingModalVisible(true);

      let tokenDecimals = 18;
      if (tokenAddress !== ZERO_ADDRESS) {
        const decimalsData = await publicClient.readContract({
          address: tokenAddress,
          abi: erc20ABI,
          functionName: "decimals",
        });
        tokenDecimals = Number(decimalsData);
      }

      const amountWei = ethers.parseUnits(donationAmount, tokenDecimals);

      // For ERC20 tokens, check allowance and approve if needed
      if (tokenAddress !== ZERO_ADDRESS) {
        // Direct contract call for allowance
        const currentAllowance = await publicClient.readContract({
          address: tokenAddress,
          abi: erc20ABI,
          functionName: "allowance",
          args: [address, networkConfig.funditContract],
        });

        if (!currentAllowance || BigInt(currentAllowance) < amountWei) {
          const approveTx = await approveWrite({
            address: tokenAddress,
            abi: erc20ABI,
            functionName: "approve",
            args: [networkConfig.funditContract, amountWei],
          });
          await publicClient.waitForTransactionReceipt({
            hash: approveTx,
          });
        }
      }

      if (networkConfig.chainId === 137) {
        const donateTx = await donateWrite({
          address: networkConfig.funditContract,
          abi: donationABI,
          functionName: "donate",
          args: [campaign.id, tokenAddress, amountWei],
          value: tokenAddress === ZERO_ADDRESS ? amountWei : 0n,
        });
        await publicClient.waitForTransactionReceipt({
          hash: donateTx,
        });
      } else {
        const donationResult = await donateWrite({
          address: networkConfig.funditContract,
          abi: donationABI,
          functionName: "donate",
          args: [campaign.id, tokenAddress, amountWei],
          value: tokenAddress === ZERO_ADDRESS ? amountWei : 0n,
        });
        const donationReceipt = await publicClient.waitForTransactionReceipt({
          hash: donationResult,
        });
        const donationEvents = [];
        for (const log of donationReceipt.logs) {
          try {
            const iface = new ethers.Interface(donationABI);
            // Try with the new format first
            try {
              const parsedLog = iface.parseLog({
                topics: log.topics,
                data: log.data,
              });
              if (parsedLog) {
                donationEvents.push(parsedLog);
              }
            } catch (error) {
              console.log(
                "Failed to parse with new format, trying old format:",
                error.message,
              );
              // Fallback: try with the old format for compatibility
              try {
                const parsedLog = iface.parseLog(log);
                if (parsedLog) {
                  donationEvents.push(parsedLog);
                }
              } catch (error) {
                console.log(
                  "Failed to parse with old format too:",
                  error.message,
                );
              }
            }
          } catch (error) {
            console.log("Error processing log:", error.message);
            continue;
          }
        }

        const donationEvent = donationEvents.find(
          (event) => event && event.name === "DonationMade",
        );

        if (!donationEvent) {
          console.error("DonationMade event not found in logs!");
          throw new Error("DonationMade event not found");
        }

        // Handle both possible event argument formats
        let donationId;
        if (donationEvent.args.donationId !== undefined) {
          donationId = donationEvent.args.donationId;
        } else if (donationEvent.args[0]) {
          donationId = donationEvent.args[0];
        } else {
          console.error(
            "Could not extract donationId from event:",
            donationEvent,
          );
          throw new Error("Failed to extract donationId from event");
        }

        try {
          // Direct call to generateOptions using publicClient
          const options = await publicClient.readContract({
            address: networkConfig.funditContract,
            abi: donationABI,
            functionName: "generateOptions",
            args: [300_000n],
          });

          if (!options) {
            throw new Error("Failed to generate cross-chain options");
          }

          // Direct call to getQuote using publicClient
          const quote = await publicClient.readContract({
            address: networkConfig.funditContract,
            abi: donationABI,
            functionName: "getQuote",
            args: [BigInt(polygonNetwork.layerzeroEid), campaign.id, options],
          });

          if (!quote) {
            throw new Error("Failed to get cross-chain quote - quote is empty");
          }

          const crosschainTx = await sendCrosschainWrite({
            address: networkConfig.funditContract,
            abi: donationABI,
            functionName: "_sendCrossChainMessage",
            args: [donationId, BigInt(polygonNetwork.layerzeroEid), options],
            value: quote,
          });

          await publicClient.waitForTransactionReceipt({
            hash: crosschainTx,
          });
        } catch (crossChainError) {
          console.error("Cross-chain process failed:", crossChainError);
          console.error(
            "Error details:",
            JSON.stringify(
              {
                message: crossChainError.message,
                code: crossChainError.code,
                data: crossChainError.data,
                stack: crossChainError.stack,
              },
              null,
              2,
            ),
          );
          throw crossChainError;
        }
      }

      setProcessingModalVisible(false);
      setSuccessModalVisible(true);
    } catch (error) {
      console.error("Donation failed:", error);
      console.error(
        "Error details:",
        JSON.stringify(
          {
            message: error.message,
            code: error.code,
            data: error.data,
            stack: error.stack,
          },
          null,
          2,
        ),
      );
      setProcessingModalVisible(false);
      setFailedModalVisible(true);
    }
  };

  const progressPercentage = Math.min(
    100,
    (campaign.amountRaised / campaign.targetAmount) * 100,
  );

  const getAbsoluteUrl = (url) =>
    // Check if the url starts with 'http://' or 'https://'
    /^(http:\/\/|https:\/\/)/.test(url) ? url : `https://${url}`;
  const handleImageError = () => {
    setImageError(true);
    setImageUrl("/assets/images/placeholderimg.png");
  };

  // Modify the balance fetching effect
  useEffect(() => {
    const fetchBalance = async () => {
      if (!address || !isConnected) {
        setTokenBalance("0");
        return;
      }

      try {
        let balance;
        if (tokenAddress === ZERO_ADDRESS) {
          // For native token
          balance = await publicClient.getBalance({
            address,
          });
        } else {
          // For ERC20 tokens
          balance = await publicClient.readContract({
            address: tokenAddress,
            abi: erc20ABI,
            functionName: "balanceOf",
            args: [address],
          });
        }

        // Get token decimals
        let tokenDecimals = 18;
        if (tokenAddress !== ZERO_ADDRESS) {
          const decimalsData = await publicClient.readContract({
            address: tokenAddress,
            abi: erc20ABI,
            functionName: "decimals",
          });
          tokenDecimals = Number(decimalsData);
        }

        // Format balance with proper decimals and round to 2 decimal places
        const formattedBalance = Number(
          ethers.formatUnits(balance, tokenDecimals),
        ).toFixed(2);
        setTokenBalance(formattedBalance);
      } catch (error) {
        console.error("Error fetching balance:", error);
        setTokenBalance("0.00");
      }
    };

    fetchBalance();
  }, [address, isConnected, tokenAddress, publicClient]);

  return (
    <div className="campaign-card-big">
      <div className="ccb-bottom">
        <div className="ca-card-img">
          <img
            src={imageError ? "/assets/images/placeholderimg.png" : imageUrl}
            alt={campaign.title}
            onError={handleImageError}
            loading="lazy"
          />
        </div>
        <div className="ca-card-details">
          <div className="ca-card-head">
            <div className="ca-card-name">{campaign.title}</div>
          </div>
          <p>{campaign.description}</p>
          <div className="ca-card-tags">
            <div className="ca-card-username">
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <g clipPath="url(#clip0_2312_618)">
                  <path
                    d="M10 11H9V10C9 9.60218 8.84196 9.22064 8.56066 8.93934C8.27936 8.65804 7.89782 8.5 7.5 8.5H4.5C4.10218 8.5 3.72064 8.65804 3.43934 8.93934C3.15804 9.22064 3 9.60218 3 10V11H2V10C2 9.33696 2.26339 8.70107 2.73223 8.23223C3.20107 7.76339 3.83696 7.5 4.5 7.5H7.5C8.16304 7.5 8.79893 7.76339 9.26777 8.23223C9.73661 8.70107 10 9.33696 10 10V11ZM6 6.5C5.60603 6.5 5.21593 6.4224 4.85195 6.27164C4.48797 6.12087 4.15726 5.8999 3.87868 5.62132C3.6001 5.34274 3.37913 5.01203 3.22836 4.64805C3.0776 4.28407 3 3.89397 3 3.5C3 3.10603 3.0776 2.71593 3.22836 2.35195C3.37913 1.98797 3.6001 1.65726 3.87868 1.37868C4.15726 1.1001 4.48797 0.879125 4.85195 0.728361C5.21593 0.577597 5.60603 0.5 6 0.5C6.79565 0.5 7.55871 0.81607 8.12132 1.37868C8.68393 1.94129 9 2.70435 9 3.5C9 4.29565 8.68393 5.05871 8.12132 5.62132C7.55871 6.18393 6.79565 6.5 6 6.5ZM6 5.5C6.53043 5.5 7.03914 5.28929 7.41421 4.91421C7.78929 4.53914 8 4.03043 8 3.5C8 2.96957 7.78929 2.46086 7.41421 2.08579C7.03914 1.71071 6.53043 1.5 6 1.5C5.46957 1.5 4.96086 1.71071 4.58579 2.08579C4.21071 2.46086 4 2.96957 4 3.5C4 4.03043 4.21071 4.53914 4.58579 4.91421C4.96086 5.28929 5.46957 5.5 6 5.5Z"
                    fill="#03053D"
                  />
                </g>
                <defs>
                  <clipPath id="clip0_2312_618">
                    <rect width="12" height="12" fill="white" />
                  </clipPath>
                </defs>
              </svg>
              <span>{shortenWalletAddress(campaign.creator)}</span>
            </div>
            <a
              href={getAbsoluteUrl(campaign.moreinfo)}
              className="ca-card-more"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>More Info</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <g clipPath="url(#clip0_2312_622)">
                  <path
                    d="M8.0022 4.707L3.6987 9.0105L2.9917 8.3035L7.2947 4H3.5022V3H9.0022V8.5H8.0022V4.707V4.707Z"
                    fill="#101928"
                  />
                </g>
                <defs>
                  <clipPath id="clip0_2312_622">
                    <rect width="12" height="12" fill="white" />
                  </clipPath>
                </defs>
              </svg>
            </a>
            <div className="ca-card-share" onClick={() => onShare(campaign.id)}>
              <span>Share</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <g clipPath="url(#clip0_2889_1221)">
                  <path
                    d="M6.5 7H5.5C4.6798 6.99969 3.87512 7.22357 3.17294 7.64745C2.47076 8.07133 1.8978 8.67908 1.516 9.405C1.50527 9.27027 1.49993 9.13516 1.5 9C1.5 6.2385 3.7385 4 6.5 4V1.5L11.5 5.5L6.5 9.5V7Z"
                    fill="#101928"
                  />
                </g>
                <defs>
                  <clipPath id="clip0_2889_1221">
                    <rect width="12" height="12" fill="white" />
                  </clipPath>
                </defs>
              </svg>
            </div>
          </div>
          <div className="ca-card-progress">
            <div className="progress-bar">
              <div
                className="progress-bar-fill"
                style={{ width: `${progressPercentage}%` }}
              ></div>
            </div>
            <div className="progress-stats">
              <div className="ps1">
                Target: <span>{formatAmount(campaign.targetAmount)}</span>
              </div>
              <div className="ps2">
                Raised: <span>{formatAmount(campaign.amountRaised)}</span>
              </div>
            </div>
          </div>
          <div className="ca-card-donation-box">
            <div className="donation-input-wrapper">
              <div className="donation-input-label">Enter Amount</div>
              <div className="token-selector" onClick={onTokenSelectorClick}>
                <div className="token-icon">
                  <img
                    src={`/assets/images/${selectedTokenSymbol.toLowerCase()}.png`}
                    alt={selectedTokenSymbol}
                  />
                </div>
                <div className="chain-icon">
                  <img
                    src={`/assets/images/${selectedChain.toLowerCase()}.png`}
                    alt={selectedChain}
                  />
                </div>
                <div className="token-chain-text">
                  <span className="token-text">{selectedTokenSymbol}</span>
                  <span className="chain-text">{selectedChain}</span>
                </div>
                <span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <g clipPath="url(#clip0_2254_1831)">
                      <path d="M6 8L3 5H9L6 8Z" fill="#586283" />
                    </g>
                    <defs>
                      <clipPath id="clip0_2254_1831">
                        <rect width="12" height="12" fill="white" />
                      </clipPath>
                    </defs>
                  </svg>
                </span>
              </div>
            </div>
            <div className="donation-input-wrapper">
              <input
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                className="donation-amount"
                placeholder="0.00"
                step="any"
                name="donationAmount"
                value={donationAmount}
                onChange={(e) => setDonationAmount(e.target.value)}
              />
            </div>
            <div className="donation-input-wrapper">
              <div className="usd-value">${Number(usdValue).toFixed(2)}</div>
              <div
                className="token-balance"
                onClick={() => setDonationAmount(tokenBalance)}
              >
                Balance: {tokenBalance} {selectedTokenSymbol}
              </div>
            </div>
          </div>
          <div className="a-button-1 ca-card-btn" onClick={handleDonate}>
            <span>Donate with {selectedTokenSymbol}</span>
          </div>
          <div
            className="anon-donate-prompt"
            onClick={() => setTopUpModalVisible(true)}
          >
            <span>More Donation Options Here</span>
            <svg
              width="29"
              height="30"
              viewBox="0 0 29 30"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g clipPath="url(#clip0_2812_952)">
                <path
                  d="M8.24949 9.10744C11.5022 5.85475 16.7819 5.85475 20.0346 9.10744C23.2873 12.3601 23.2873 17.6399 20.0346 20.8926C16.7819 24.1452 11.5022 24.1452 8.24949 20.8926C4.9968 17.6399 4.9968 12.3601 8.24949 9.10744ZM13.5528 14.4107L11.1958 16.7678L12.3743 17.9463L14.7313 15.5893L16.4991 17.357V12.643H11.785L13.5528 14.4107Z"
                  fill="#FF7C0A"
                ></path>
              </g>
              <defs>
                <clipPath id="clip0_2812_952">
                  <rect
                    width="20"
                    height="20"
                    fill="white"
                    transform="translate(0 15) rotate(-45)"
                  ></rect>
                </clipPath>
              </defs>
            </svg>
          </div>
        </div>
      </div>
      {/* Transaction State Modals */}
      <TransactionProcessingModal
        visible={processingModalVisible}
        onClose={() => setProcessingModalVisible(false)}
      />
      <TransactionSuccessModal
        visible={successModalVisible}
        onClose={() => setSuccessModalVisible(false)}
      />
      <TransactionFailedModal
        visible={failedModalVisible}
        onClose={() => setFailedModalVisible(false)}
      />
      <TopUpModal
        visible={topUpModalVisible}
        onClose={() => setTopUpModalVisible(false)}
        campaign={campaign}
        onproxyDonate={onproxyDonate}
      />
    </div>
  );
}

CampaignCardBig.propTypes = {
  campaign: PropTypes.object.isRequired,
  onShare: PropTypes.func.isRequired,
  onproxyDonate: PropTypes.func.isRequired,
  selectedTokenSymbol: PropTypes.string.isRequired,
  selectedChain: PropTypes.string.isRequired,
  onTokenSelectorClick: PropTypes.func.isRequired,
};

export default CampaignCardBig;

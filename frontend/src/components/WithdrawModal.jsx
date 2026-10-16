import PropTypes from "prop-types";
import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import {
  useWriteContract,
  useReadContract,
  useAccount,
  useSwitchChain,
  useChainId,
  usePublicClient,
} from "wagmi";
import mainChainABI from "../abis/mainChainABI.json";
import erc20ABI from "../abis/erc20ABI.json";
import remoteChainABI from "../abis/remoteChainABI.json";
import networks from "../config/networks.json";
import TransactionProcessingModal from "../components/TransactionProcessingModal";
import TransactionSuccessModal from "../components/TransactionSuccessModal";
import TransactionFailedModal from "../components/TransactionFailedModal";
import Modal from "./Modal.jsx";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const WithdrawModal = ({
  visible,
  onClose,
  selectedTokenSymbol,
  selectedChain,
  onTokenSelectorClick,
}) => {
  const navigate = useNavigate();

  function handleError(error, message = "") {
    console.error(message, error);
  }

  const { address, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  const activeChain = useChainId();

  const chainReference = useRef(activeChain);
  useEffect(() => {
    chainReference.current = activeChain;
  }, [activeChain]);

  const [transactionProcessingVisible, setTransactionProcessingVisible] =
    useState(false);
  const [transactionSuccessVisible, setTransactionSuccessVisible] =
    useState(false);
  const [transactionFailedVisible, setTransactionFailedVisible] =
    useState(false);
  const [withdrawalAmount, setWithdrawalAmount] = useState("");
  const [usdValue, setUsdValue] = useState("0");

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

  // USD decimals from contract
  const USD_DECIMALS = 8;

  // Format USD values
  const formatUSDValue = (value) => {
    try {
      // Convert BigInt to string before formatting
      const valueString = value.toString();
      const formatted = ethers.formatUnits(valueString, USD_DECIMALS);
      return isNaN(Number.parseFloat(formatted)) ? "0" : formatted;
    } catch (error) {
      console.error("Error formatting USD value:", error);
      return "0";
    }
  };

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

  const targetChainId = networkConfig.chainId;
  const tokenKey = selectedTokenSymbol.toLowerCase();
  const tokenData = networkConfig.tokens[tokenKey];
  const tokenAddress = tokenData
    ? tokenData.address
    : networkConfig.nativeToken.address;

  const polygonCampaignContract = (() => {
    const found = networks.find((net) => net.chainId === 137);
    return found && found.funditContract ? found.funditContract : ZERO_ADDRESS;
  })();

  const { writeContractAsync: withdrawWrite } = useWriteContract();

  const { data: ended_balance } = useReadContract({
    abi: mainChainABI,
    address: polygonCampaignContract,
    functionName: "creatorEndedBalance",
    args: [address],
    enabled: Boolean(address),
  });

  const { data: withdrawn_balance } = useReadContract({
    abi: mainChainABI,
    address: polygonCampaignContract,
    functionName: "userWithdrawnBalance",
    args: [address],
    enabled: Boolean(address),
  });

  const withdrawable_balance =
    ended_balance && withdrawn_balance ? ended_balance - withdrawn_balance : 0n;

  const publicClient = usePublicClient({
    chainId: networkConfig.chainId,
  });

  useEffect(() => {
    if (!withdrawalAmount || !networkConfig.funditContract) {
      setUsdValue("0");
      return;
    }

    const updateUSDValue = async () => {
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

        // Validate input is a number
        if (isNaN(Number.parseFloat(withdrawalAmount))) {
          setUsdValue("0");
          return;
        }

        const parsedAmount = ethers.parseUnits(withdrawalAmount, tokenDecimals);
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
  }, [withdrawalAmount, tokenAddress, networkConfig, publicClient]);

  // Request withdrawal function
  const requestWithdrawal = async () => {
    if (!withdrawalAmount || !isConnected) {
      return null;
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

      const amountParsed = ethers.parseUnits(withdrawalAmount, tokenDecimals);
      const tx = await withdrawWrite({
        address: polygonCampaignContract,
        abi: mainChainABI,
        functionName: "requestWithdrawal",
        args: [amountParsed, tokenAddress, BigInt(targetChainId)],
      });

      return { status: 1, transactionHash: tx };
    } catch (error) {
      handleError(error, `Error requesting withdrawal: ${error.message}`);
      return null;
    }
  };

  // Handle withdrawal button click
  const handleWithdraw = async () => {
    if (!isConnected) {
      return;
    }

    try {
      // Check for sufficient balance
      const withdrawalAmountUSD = ethers.parseUnits(usdValue, USD_DECIMALS);
      if (withdrawalAmountUSD > withdrawable_balance) {
        handleError(new Error("Insufficient withdrawable balance"));
        setTransactionFailedVisible(true);
        return;
      }

      // Switch to Polygon if needed
      if (activeChain !== 137 && switchChain) {
        switchChain({ chainId: 137 });
        await waitForChainChange(137);
      }

      // Show processing modal
      setTransactionProcessingVisible(true);

      // Send transaction
      const receipt = await requestWithdrawal();
      setTransactionProcessingVisible(false);

      // Handle result
      if (receipt && receipt.status === 1) {
        setTransactionSuccessVisible(true);
      } else {
        setTransactionFailedVisible(true);
      }
    } catch (error) {
      handleError(error, `Withdrawal error: ${error.message}`);
      setTransactionProcessingVisible(false);
      setTransactionFailedVisible(true);
    }
  };

  // Handle body overflow when modal is open
  useEffect(() => {
    document.body.style.overflow = visible ? "hidden" : "unset";

    return () => {
      document.body.style.overflow = "unset";
    };
  }, [visible]);

  if (!visible) {
    return null;
  }

  const handleModalClose = () => {
    setWithdrawalAmount("");
    setTransactionSuccessVisible(false);
    setTransactionFailedVisible(false);
    navigate("/Profile");
  };

  return (
    <Modal visible={visible} onClose={onClose}>
      <div className="modal-l1">
        <h2>Withdraw Funds</h2>
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
            min="0"
            value={withdrawalAmount}
            onChange={(e) => setWithdrawalAmount(e.target.value)}
          />
          <div className="usd-value">~ ${Number(usdValue).toFixed(2)} USD</div>
        </div>
      </div>
      <div className="wc-balances">
        <div className="wc-balance-row">
          <span>Withdrawable Balance</span>
          <span className="wcb-rr" id="my-withdrawable-balance">
            {formatUSDValue(withdrawable_balance)} USD
          </span>
        </div>
      </div>
      <div className="a-button-1" id="my-withdraw-btn" onClick={handleWithdraw}>
        Withdraw
      </div>

      {/* Transaction State Modals */}
      <TransactionProcessingModal
        visible={transactionProcessingVisible}
        onClose={() => setTransactionProcessingVisible(false)}
      />
      <TransactionSuccessModal
        visible={transactionSuccessVisible}
        onClose={handleModalClose}
      />
      <TransactionFailedModal
        visible={transactionFailedVisible}
        onClose={handleModalClose}
      />
    </Modal>
  );
};

WithdrawModal.propTypes = {
  visible: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  selectedTokenSymbol: PropTypes.string.isRequired,
  selectedChain: PropTypes.string.isRequired,
  onTokenSelectorClick: PropTypes.func.isRequired,
};

export default WithdrawModal;

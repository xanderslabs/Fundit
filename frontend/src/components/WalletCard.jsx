import PropTypes from "prop-types";
import { createIcon } from "@download/blockies";
import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { useAccount, usePublicClient } from "wagmi";
import { shortenWalletAddress } from "../utils/helpers";
import mainChainABI from "../abis/mainChainABI.json";
import networks from "../config/networks.json";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const WalletCard = ({ onWithdraw, onUsernameClick }) => {
  const { address, isConnected } = useAccount();
  const [displayUsername, setDisplayUsername] = useState("");
  const [fundsBalance, setFundsBalance] = useState("0");

  const publicClient = usePublicClient({
    chainId: 137,
  });

  // Find Polygon network and contract address
  const polygonNetwork = networks.find((net) => net.chainId === 137);
  const contractAddress = polygonNetwork?.funditContract || "";

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

  useEffect(() => {
    const fetchData = async () => {
      if (!isConnected || !address || !contractAddress) {
        // Reset values when disconnected
        setFundsBalance("0");
        setDisplayUsername(shortenWalletAddress(ZERO_ADDRESS));
        return;
      }

      try {
        const [totalBalance, withdrawnBalance, contractUsername] =
          await Promise.all([
            publicClient.readContract({
              address: contractAddress,
              abi: mainChainABI,
              functionName: "userTotalBalance",
              args: [address],
            }),
            publicClient.readContract({
              address: contractAddress,
              abi: mainChainABI,
              functionName: "userWithdrawnBalance",
              args: [address],
            }),
            publicClient.readContract({
              address: contractAddress,
              abi: mainChainABI,
              functionName: "usernames",
              args: [address],
            }),
          ]);

        // Update balance
        if (totalBalance !== undefined && withdrawnBalance !== undefined) {
          const available = totalBalance - withdrawnBalance;
          setFundsBalance(formatUSDValue(available));
        } else {
          setFundsBalance("0");
        }

        // Update username
        if (contractUsername && contractUsername !== "") {
          setDisplayUsername(contractUsername);
        } else {
          setDisplayUsername(shortenWalletAddress(address));
        }
      } catch (error) {
        console.error("Error fetching wallet data:", error);
        setFundsBalance("0");
        setDisplayUsername(address ? shortenWalletAddress(address) : "");
      }
    };

    fetchData();

    // When disconnected, reset to zero address
    if (!isConnected) {
      setDisplayUsername(shortenWalletAddress(ZERO_ADDRESS));
      setFundsBalance("0");
    }
  }, [address, isConnected, publicClient, contractAddress]);

  const iconSeed = isConnected && address ? address : ZERO_ADDRESS;
  const icon = createIcon({
    seed: iconSeed,
    size: 10,
    scale: 5,
  });

  const dataURL = icon ? icon.toDataURL() : "";

  return (
    <div className="dash-card wallet-card">
      <div className="wallet-card-top">
        <div className="user-blockies">
          {dataURL && <img src={dataURL} alt="Identicon" />}
        </div>
      </div>
      <div className="wallet-card-bottom">
        <div className="wcb-l">
          <div className="wallet-user-info">
            <div className="wallet-address" id="my-wallet-address">
              {isConnected
                ? shortenWalletAddress(address)
                : shortenWalletAddress(ZERO_ADDRESS)}
            </div>
            <div className="wallet-username" onClick={onUsernameClick}>
              <span id="my-username">{displayUsername}</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <g clipPath="url(#clip0_2596_508)">
                  <path
                    d="M2.5 9.49998H3.207L7.864 4.84298L7.157 4.13598L2.5 8.79298V9.49998ZM10.5 10.5H1.5V8.37848L8.2175 1.66098C8.31126 1.56725 8.43842 1.51459 8.571 1.51459C8.70358 1.51459 8.83074 1.56725 8.9245 1.66098L10.339 3.07548C10.4327 3.16924 10.4854 3.2964 10.4854 3.42898C10.4854 3.56156 10.4327 3.68872 10.339 3.78248L4.6215 9.49998H10.5V10.5ZM7.864 3.42898L8.571 4.13598L9.278 3.42898L8.571 2.72198L7.864 3.42898Z"
                    fill="#03053D"
                  />
                </g>
                <defs>
                  <clipPath id="clip0_2596_508">
                    <rect width="12" height="12" fill="white" />
                  </clipPath>
                </defs>
              </svg>
            </div>
          </div>
          <div className="wc-actions">
            <div className="a-button-1 buy-fun-btn">Buy $Fun</div>
            <div className="a-button-1 withdraw-btn" onClick={onWithdraw}>
              <span>Withdraw Funds</span>
            </div>
          </div>
        </div>
        <div className="wc-balances">
          <div className="wc-balance-row">
            <span>Funds Balance</span>
            <span className="wcb-rr" id="my-funds-balance">
              ${Number.parseFloat(fundsBalance).toFixed(2)} USD
            </span>
          </div>
          <div className="wc-balance-row">
            <span>$Fun Balance</span>
            <span className="wcb-rr" id="my-fun-balance">
              0 $FUN
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

WalletCard.propTypes = {
  onWithdraw: PropTypes.func.isRequired,
  onUsernameClick: PropTypes.func.isRequired,
};

export default WalletCard;

import { usePublicClient } from "wagmi";
import networks from "../config/networks.json";
import mainChainABI from "../abis/mainChainABI.json";
import { shortenWalletAddress } from "../utils/helpers";

// Create a custom hook to get username
export const useGetUsername = () => {
  const publicClient = usePublicClient({
    chainId: 137,
  });

  // Function to get username or shortened address
  const getUsernameOrShortAddress = async (walletAddress) => {
    try {
      // Get the contract address from your networks config
      const polygonNetwork = networks.find((net) => net.chainId === 137);
      const contractAddress = polygonNetwork?.funditContract || null;

      if (!contractAddress || !walletAddress) {
        return shortenWalletAddress(walletAddress);
      }

      // Call the usernames function on the contract
      const username = await publicClient.readContract({
        address: contractAddress,
        abi: mainChainABI,
        functionName: "usernames",
        args: [walletAddress],
      });

      // If username is empty or null, return shortened address
      if (!username || username === "") {
        return shortenWalletAddress(walletAddress);
      }

      return username;
    } catch (error) {
      console.error("Failed to fetch username:", error);
      // Fallback to shortened address
      return shortenWalletAddress(walletAddress);
    }
  };

  return getUsernameOrShortAddress;
};

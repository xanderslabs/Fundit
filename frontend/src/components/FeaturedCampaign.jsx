import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { usePublicClient } from "wagmi";
import axios from "axios";
import mainChainABI from "../abis/mainChainABI.json";
import networks from "../config/networks.json";
import CampaignCardBig from "./CampaignCardBig.jsx";
import { CampaignCardSkeleton } from "./SkeletonLoaders.jsx";

const API_BASE_URL =
  import.meta.env.VITE_APP_API_URL || "http://localhost:3000";

function FeaturedCampaign({
  onShare,
  onTokenSelectorClick,
  onproxyDonate,
  selectedTokenSymbol,
  selectedChain,
}) {
  const [featuredCampaign, setFeaturedCampaign] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const publicClient = usePublicClient({
    chainId: 137, // Polygon chain ID
  });

  // Find Polygon network and contract address
  const polygonNetwork = networks.find((net) => net.chainId === 137);
  const contractAddress = polygonNetwork?.funditContract || "";

  useEffect(() => {
    const fetchFeaturedCampaign = async () => {
      if (!contractAddress) {
        console.error("Contract address not found");
        setIsLoading(false);
        return;
      }

      try {
        // Step 1: Fetch featured campaign ID from blockchain
        const featuredId = await publicClient.readContract({
          address: contractAddress,
          abi: mainChainABI,
          functionName: "featuredCampaignId",
        });

        // If no featured campaign is set (id is 0), exit early
        if (featuredId === 0n) {
          setIsLoading(false);
          return;
        }

        // Step 2: Fetch campaign details from API using the featured ID
        const response = await axios.get(
          `${API_BASE_URL}/campaigns/${featuredId.toString()}`,
        );

        if (response.data && response.data.id) {
          setFeaturedCampaign(response.data);
        }
      } catch (error) {
        console.error("Error fetching featured campaign:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchFeaturedCampaign();
  }, [publicClient, contractAddress]);

  // Show skeleton loader while loading
  if (isLoading) {
    return (
      <div id="featured-campaign">
        <CampaignCardSkeleton />
      </div>
    );
  }

  // If no featured campaign, don't render anything
  if (!featuredCampaign) {
    return null;
  }

  return (
    <div id="featured-campaign">
      <CampaignCardBig
        campaign={featuredCampaign}
        onClose={() => {}}
        onShare={onShare}
        onproxyDonate={onproxyDonate}
        selectedTokenSymbol={selectedTokenSymbol}
        selectedChain={selectedChain}
        onTokenSelectorClick={onTokenSelectorClick}
      />
    </div>
  );
}

FeaturedCampaign.propTypes = {
  onShare: PropTypes.func.isRequired,
  onTokenSelectorClick: PropTypes.func.isRequired,
  onproxyDonate: PropTypes.func.isRequired,
  selectedTokenSymbol: PropTypes.string.isRequired,
  selectedChain: PropTypes.string.isRequired,
};

export default FeaturedCampaign;

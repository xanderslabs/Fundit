import { useState } from "react";
import axios from "axios";
import Header from "../components/Header";
import HeaderSpacer from "../components/HeaderSpace";
import CampaignsPageSection from "../components/CampiagnsPageSection";
import ShareModal from "../components/ShareModal";
import TokenSelectorModal from "../components/TokenSelectorModal";
import CampaignModal from "../components/CampaignModal";
import TopUpModal from "../components/TopUpModal";
import ProxyDonateModal from "../components/ProxyDonation";

const API_BASE_URL =
  import.meta.env.VITE_APP_API_URL || "http://localhost:3000";

function Campaigns() {
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [tokenModalVisible, setTokenModalVisible] = useState(false);
  const [campaignModalVisible, setCampaignModalVisible] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [shareLink, setShareLink] = useState("");
  const [data, setData] = useState({});
  const [ProxyDonateModalVisible, setproxyDonateModalVisible] = useState(false);
  const [topUpModalVisible, setTopUpModalVisible] = useState(false);

  // Token selection state (could also come from context)
  const [selectedChain, setSelectedChain] = useState("Polygon");
  const [selectedTokenSymbol, setSelectedTokenSymbol] = useState("USDT");

  // Callbacks that will be passed to children:

  const handleproxyDonate = async (campaignId) => {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/campaigns/${encodeURIComponent(campaignId)}/direct-wallet`,
      );
      // With axios, the data is already parsed - no need for .json()
      setData(response.data);
      setproxyDonateModalVisible(true);
    } catch (error) {
      console.error("Error fetching wallet:", error);
      // Handle the error appropriately
    }
  };

  const handleShare = (campaignId) => {
    // Create a share link based on campaign id:
    const link =
      window.location.origin +
      window.location.pathname +
      "?campaignId=" +
      encodeURIComponent(campaignId);
    setShareLink(link);
    setShareModalVisible(true);
  };

  const handleTokenSelectorClick = () => {
    setTokenModalVisible(true);
  };

  // Const handleTopUp = () => {
  // setTopUpModalVisible(true);
  // };

  // Callback for clicking a small card from the grid
  const handleCampaignSelect = (campaign) => {
    setSelectedCampaign(campaign);
    setCampaignModalVisible(true);
  };

  return (
    <div className="body">
      <Header />
      <HeaderSpacer />
      <CampaignsPageSection onCampaignSelect={handleCampaignSelect} />
      <ProxyDonateModal
        visible={ProxyDonateModalVisible}
        onClose={() => setproxyDonateModalVisible(false)}
        data={data}
      />
      <ShareModal
        visible={shareModalVisible}
        onClose={() => setShareModalVisible(false)}
        shareLink={shareLink}
      />
      <TokenSelectorModal
        visible={tokenModalVisible}
        onClose={() => setTokenModalVisible(false)}
        selectedChain={selectedChain}
        selectedTokenSymbol={selectedTokenSymbol}
        onSelectToken={(tokenSymbol, chain) => {
          setSelectedTokenSymbol(tokenSymbol);
          setSelectedChain(chain);
          setTokenModalVisible(false);
        }}
        onChainChange={(chain) => setSelectedChain(chain)}
      />
      <CampaignModal
        visible={campaignModalVisible}
        onClose={() => setCampaignModalVisible(false)}
        campaign={selectedCampaign}
        selectedTokenSymbol={selectedTokenSymbol}
        selectedChain={selectedChain}
        onShare={handleShare}
        onproxyDonate={handleproxyDonate}
        onTokenSelectorClick={handleTokenSelectorClick}
      />
      <TopUpModal
        visible={topUpModalVisible}
        onClose={() => setTopUpModalVisible(false)}
      />
    </div>
  );
}

export default Campaigns;

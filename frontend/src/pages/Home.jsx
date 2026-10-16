import { useState } from "react";
import axios from "axios";
import Header from "../components/Header";
import HeaderSpacer from "../components/HeaderSpace";
import Hero from "../components/Hero";
import FeaturedCampaign from "../components/FeaturedCampaign";
import HowItWorks from "../components/HowItWorks";
import CampaignsSection from "../components/CampaignsSection";
import HomeFAQ from "../components/HomeFAQ";
import Footer from "../components/Footer";
import ShareModal from "../components/ShareModal";
import ProxyDonateModal from "../components/ProxyDonation";
import TokenSelectorModal from "../components/TokenSelectorModal";
import TransactionProcessingModal from "../components/TransactionProcessingModal";
import TransactionSuccessModal from "../components/TransactionSuccessModal";
import TransactionFailedModal from "../components/TransactionFailedModal";
import CampaignModal from "../components/CampaignModal";
import TopUpModal from "../components/TopUpModal";

const API_BASE_URL =
  import.meta.env.VITE_APP_API_URL || "http://localhost:3000";

function Home() {
  // Modal visibility states
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [proxyDonateModalVisible, setProxyDonateModalVisible] = useState(false);
  const [tokenModalVisible, setTokenModalVisible] = useState(false);
  const [transactionProcessingVisible, setTransactionProcessingVisible] =
    useState(false);
  const [transactionSuccessVisible, setTransactionSuccessVisible] =
    useState(false);
  const [transactionFailedVisible, setTransactionFailedVisible] =
    useState(false);
  const [campaignModalVisible, setCampaignModalVisible] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [shareLink, setShareLink] = useState("");
  const [data, setData] = useState({});
  const [topUpModalVisible, setTopUpModalVisible] = useState(false);

  // Token selection state (could also come from context)
  const [selectedChain, setSelectedChain] = useState("Polygon");
  const [selectedTokenSymbol, setSelectedTokenSymbol] = useState("USDT");

  // Callbacks that will be passed to children:

  const handleAnonDonate = async (campaignId) => {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/campaigns/${encodeURIComponent(campaignId)}/direct-wallet`,
      );
      // With axios, the data is already parsed - no need for .json()
      setData(response.data);
      setProxyDonateModalVisible(true);
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
      "campaigns/?campaignId=" +
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
      <Hero />
      <FeaturedCampaign
        onShare={handleShare}
        onproxyDonate={handleAnonDonate}
        onTokenSelectorClick={handleTokenSelectorClick}
        selectedTokenSymbol={selectedTokenSymbol}
        selectedChain={selectedChain}
      />
      <HowItWorks />
      <CampaignsSection onCampaignSelect={handleCampaignSelect} />
      <HomeFAQ />
      <Footer />
      <ProxyDonateModal
        visible={proxyDonateModalVisible}
        onClose={() => setProxyDonateModalVisible(false)}
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
      <TransactionProcessingModal
        visible={transactionProcessingVisible}
        onClose={() => setTransactionProcessingVisible(false)}
      />
      <TransactionSuccessModal
        visible={transactionSuccessVisible}
        onClose={() => setTransactionSuccessVisible(false)}
      />
      <TransactionFailedModal
        visible={transactionFailedVisible}
        onClose={() => setTransactionFailedVisible(false)}
      />
      <CampaignModal
        visible={campaignModalVisible}
        onClose={() => setCampaignModalVisible(false)}
        campaign={selectedCampaign}
        selectedTokenSymbol={selectedTokenSymbol}
        selectedChain={selectedChain}
        onShare={handleShare}
        onproxyDonate={handleAnonDonate}
        onTokenSelectorClick={handleTokenSelectorClick}
      />
      <TopUpModal
        visible={topUpModalVisible}
        onClose={() => setTopUpModalVisible(false)}
      />
    </div>
  );
}

export default Home;

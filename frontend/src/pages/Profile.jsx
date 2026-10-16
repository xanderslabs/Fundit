import { useState } from "react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import Header from "../components/Header";
import HeaderSpacer from "../components/HeaderSpace";
import WalletCard from "../components/WalletCard";
import VerifyAccountsCard from "../components/VerifyAccountsCard";
import MyCampaignsSection from "../components/MyCampaignsSection";
import TransactionHistorySection from "../components/TransactionHistorySection";
import MyCampaignModal from "../components/MyCampaignModal";
import WithdrawModal from "../components/WithdrawModal";
import UsernameModal from "../components/UsernameModal";
import TokenSelectorModal from "../components/TokenSelectorModal";
import TransactionProcessingModal from "../components/TransactionProcessingModal";
import TransactionSuccessModal from "../components/TransactionSuccessModal";
import TransactionFailedModal from "../components/TransactionFailedModal";
import {
  SmallCardSkeletonGrid,
  TransactionHistorySkeleton,
} from "../components/SkeletonLoaders";

const API_BASE_URL =
  import.meta.env.VITE_APP_API_URL || "http://localhost:3000";

const Profile = () => {
  const { address } = useAccount();

  // State for active tab
  const [activeTab, setActiveTab] = useState("myCampaigns");

  // State for modals
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [withdrawModalVisible, setWithdrawModalVisible] = useState(false);
  const [usernameModalVisible, setUsernameModalVisible] = useState(false);

  const [tokenModalVisible, setTokenModalVisible] = useState(false);
  const [transactionProcessingVisible, setTransactionProcessingVisible] =
    useState(false);
  const [transactionSuccessVisible, setTransactionSuccessVisible] =
    useState(false);
  const [transactionFailedVisible, setTransactionFailedVisible] =
    useState(false);

  // Token selection state (could also come from context)
  const [selectedChain, setSelectedChain] = useState("Polygon");
  const [selectedTokenSymbol, setSelectedTokenSymbol] = useState("USDT");

  // Handler for tab switching
  const handleTabClick = (tab) => setActiveTab(tab);

  // When a small card is clicked in "My Campaigns"
  const handleCampaignSelect = (campaign) => {
    setSelectedCampaign(campaign);
  };

  // Fetch user campaigns
  const {
    data: userCampaigns = [],
    isLoading: campaignsLoading,
    refetch: refetchCampaigns,
  } = useQuery({
    queryKey: ["userCampaigns", address],
    async queryFn() {
      if (!address) {
        return [];
      }

      const response = await axios.get(
        `${API_BASE_URL}/user-campaigns/${address}`,
      );
      return response.data;
    },
    enabled: Boolean(address),
  });

  // Fetch user transactions
  const { data: userTransactions = [], isLoading: transactionsLoading } =
    useQuery({
      queryKey: ["userTransactions", address],
      async queryFn() {
        if (!address) {
          return [];
        }

        const response = await axios.get(
          `${API_BASE_URL}/transactions/${address}`,
        );
        return response.data;
      },
      enabled: Boolean(address),
    });

  const closeMyCampaignModal = () => setSelectedCampaign(null);

  const handleTokenSelectorClick = () => {
    setTokenModalVisible(true);
  };

  return (
    <div className="body">
      <Header />
      <HeaderSpacer />
      <div className="dashboard-container">
        <div className="dash-top-row">
          <WalletCard
            onWithdraw={() => setWithdrawModalVisible(true)}
            onUsernameClick={() => setUsernameModalVisible(true)}
          />
          <VerifyAccountsCard />
        </div>

        {/* Tab Buttons */}
        <div className="tab-buttons">
          <button
            className={`tab-btn ${activeTab === "myCampaigns" ? "active" : ""}`}
            onClick={() => handleTabClick("myCampaigns")}
          >
            My Campaigns
          </button>
          <button
            className={`tab-btn ${
              activeTab === "transactionHistory" ? "active" : ""
            }`}
            onClick={() => handleTabClick("transactionHistory")}
          >
            Transaction History
          </button>
        </div>

        {/* Tab Contents */}
        <div
          className="tab-content"
          id="myCampaigns"
          style={{ display: activeTab === "myCampaigns" ? "flex" : "none" }}
        >
          {campaignsLoading ? (
            <SmallCardSkeletonGrid count={4} />
          ) : (
            <MyCampaignsSection
              campaigns={userCampaigns}
              isLoading={false} // We're handling loading state here now
              onCampaignSelect={handleCampaignSelect}
            />
          )}
        </div>
        <div
          className="tab-content"
          id="transactionHistory"
          style={{
            display: activeTab === "transactionHistory" ? "flex" : "none",
          }}
        >
          {transactionsLoading ? (
            <TransactionHistorySkeleton rows={5} />
          ) : (
            <TransactionHistorySection
              transactions={userTransactions}
              isLoading={false} // We're handling loading state here now
            />
          )}
        </div>
      </div>

      {/* Modals */}
      {selectedCampaign && (
        <MyCampaignModal
          visible={true}
          onClose={closeMyCampaignModal}
          campaign={selectedCampaign}
          onUpdate={() => refetchCampaigns()}
        />
      )}
      {withdrawModalVisible && (
        <WithdrawModal
          visible={true}
          onClose={() => setWithdrawModalVisible(false)}
          selectedTokenSymbol={selectedTokenSymbol}
          selectedChain={selectedChain}
          onTokenSelectorClick={handleTokenSelectorClick}
        />
      )}
      {usernameModalVisible && (
        <UsernameModal
          visible={true}
          onClose={() => setUsernameModalVisible(false)}
        />
      )}
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
    </div>
  );
};

export default Profile;

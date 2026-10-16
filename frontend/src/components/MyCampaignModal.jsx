import PropTypes from "prop-types";
import { useState, useEffect, useRef } from "react";
import {
  useWriteContract,
  useReadContract,
  useAccount,
  useSwitchChain,
  useChainId,
} from "wagmi";
import { ref, getDownloadURL } from "firebase/storage";
import mainChainABI from "../abis/mainChainABI.json";
import networks from "../config/networks.json";
import TransactionProcessingModal from "../components/TransactionProcessingModal";
import TransactionSuccessModal from "../components/TransactionSuccessModal";
import TransactionFailedModal from "../components/TransactionFailedModal";
import { storage } from "../firebase/config";
import Modal from "./Modal.jsx";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const MyCampaignModal = ({ visible, onClose, campaign }) => {
  const [imageUrl, setImageUrl] = useState("/assets/images/placeholderimg.png");
  const [imageError, setImageError] = useState(false);

  function handleError(error, message = "") {
    console.error(message, error);
  }

  const { isConnected } = useAccount();
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

  useEffect(() => {
    async function loadImageFromFirebase() {
      // Use campaign.image instead of campaign.imageId
      const imageIdentifier = campaign.image;

      if (!imageIdentifier) {
        console.log("No image identifier available for", campaign.title);
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
        setImageError(true);
      }
    }

    loadImageFromFirebase();
  }, [campaign.image, campaign.title]);

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

  const polygonCampaignContract = (() => {
    const found = networks.find((net) => net.chainId === 137);
    return found && found.funditContract ? found.funditContract : ZERO_ADDRESS;
  })();

  const { writeContractAsync: campaignEndWrite } = useWriteContract();

  const { data: campaigns } = useReadContract({
    abi: mainChainABI,
    address: polygonCampaignContract,
    functionName: "Campaigns",
    args: [campaign.id],
  });

  const campaign_ended = campaigns?.ended || false;

  const requestEnd = async () => {
    if (!campaign.id || !isConnected) {
      return;
    }

    try {
      const tx = await campaignEndWrite({
        address: polygonCampaignContract,
        abi: mainChainABI,
        functionName: "endCampaign",
        args: [campaign.id],
      });
      return { status: 1, transactionHash: tx };
    } catch (error) {
      handleError(error, `Error creating campaign: ${error.message}`);
      return null;
    }
  };

  const handleEndCampaign = async () => {
    if (!isConnected) {
      return;
    }

    if (campaign_ended) {
      handleError(new Error("Campaign already Ended"));
      return;
    }

    if (
      !window.confirm(
        "Are you sure you want to end this campaign? This action cannot be undone.",
      )
    ) {
      return;
    }

    try {
      if (activeChain !== 137 && switchChain) {
        switchChain({ chainId: 137 });
        await waitForChainChange(137);
      }

      setTransactionProcessingVisible(true);
      const receipt = await requestEnd();
      setTransactionProcessingVisible(false);
      if (receipt && receipt.status === 1) {
        setTransactionSuccessVisible(true);
      } else {
        setTransactionFailedVisible(true);
      }
    } catch (error) {
      handleError(error, `Error: ${error.message}`);
      setTransactionProcessingVisible(false);
      setTransactionFailedVisible(true);
    }
  };

  const handleModalClose = () => {
    setTransactionSuccessVisible(false);
    setTransactionFailedVisible(false);
  };

  useEffect(() => {
    document.body.style.overflow = visible ? "hidden" : "unset";

    return () => {
      // Cleanup if the component unmounts while the modal is open.
      document.body.style.overflow = "unset";
    };
  }, [visible]);
  if (!visible) {
    return null;
  }

  const handleImageError = () => {
    setImageError(true);
    setImageUrl("/assets/images/placeholderimg.png");
  };

  return (
    <Modal visible={visible} onClose={onClose} customStyle="my-campaign">
      <div className="my-campaign-card-big-container">
        <div className="campaign-card-big">
          <div className="ccb-bottom">
            <div className="ca-card-img">
              <img
                src={
                  imageError ? "/assets/images/placeholderimg.png" : imageUrl
                }
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
              <div className="wc-balances">
                <div className="wc-balance-row">
                  <span>Target</span>
                  <span className="wcb-rr">${campaign.targetAmount}</span>
                </div>
                <div className="wc-balance-row">
                  <span>Total Raised</span>
                  <span className="wcb-rr">${campaign.amountRaised}</span>
                </div>
              </div>
              <div className="campaign-actions">
                <div
                  className={`a-button-1 edit-btn ${campaign_ended ? "disabled-btn" : ""}`}
                  onClick={() => {
                    if (!campaign_ended) {
                      window.location.href = `/edit-campaign?campaignId=${campaign.id}`;
                    }
                  }}
                >
                  Edit
                </div>
                <div
                  className={`a-button-1 end-btn ${campaign_ended ? "disabled-btn" : ""}`}
                  onClick={campaign_ended ? undefined : handleEndCampaign}
                >
                  End
                </div>
              </div>
            </div>
          </div>
        </div>
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

MyCampaignModal.propTypes = {
  visible: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  campaign: PropTypes.object.isRequired,
};

export default MyCampaignModal;

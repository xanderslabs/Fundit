import PropTypes from "prop-types";
import { useEffect } from "react";
import Modal from "./Modal.jsx";
import CampaignCardBig from "./CampaignCardBig.jsx";

function CampaignModal({
  visible,
  onClose,
  campaign,
  selectedTokenSymbol,
  selectedChain,
  onShare,
  onproxyDonate,
  onTokenSelectorClick,
}) {
  useEffect(() => {
    document.body.style.overflow = visible ? "hidden" : "unset";

    return () => {
      // Cleanup if the component unmounts while the modal is open.
      document.body.style.overflow = "unset";
    };
  }, [visible]);
  if (!campaign) {
    return null;
  }

  return (
    <Modal visible={visible} onClose={onClose} customStyle="campaign">
      <div id="campaign-card-big-container">
        <CampaignCardBig
          campaign={campaign}
          onClose={onClose}
          onShare={onShare}
          onproxyDonate={onproxyDonate}
          selectedTokenSymbol={selectedTokenSymbol}
          selectedChain={selectedChain}
          onTokenSelectorClick={onTokenSelectorClick}
        />
      </div>
    </Modal>
  );
}

CampaignModal.propTypes = {
  visible: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  campaign: PropTypes.object.isRequired,
  selectedTokenSymbol: PropTypes.string.isRequired,
  selectedChain: PropTypes.string.isRequired,
  onShare: PropTypes.func.isRequired,
  onproxyDonate: PropTypes.func.isRequired,
  onTokenSelectorClick: PropTypes.func.isRequired,
};

export default CampaignModal;

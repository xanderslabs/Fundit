import PropTypes from "prop-types";
import { useState, useEffect, useRef } from "react";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWriteContract,
  usePublicClient,
} from "wagmi";
import mainChainABI from "../abis/mainChainABI.json";
import networks from "../config/networks.json";
import TransactionProcessingModal from "../components/TransactionProcessingModal";
import TransactionSuccessModal from "../components/TransactionSuccessModal";
import TransactionFailedModal from "../components/TransactionFailedModal";
import Modal from "./Modal.jsx";

const UsernameModal = ({ visible, onClose, onUpdate }) => {
  const { isConnected } = useAccount();
  const activeChain = useChainId();
  const { switchChain } = useSwitchChain();
  const [username, setUsername] = useState("");
  const [processingVisible, setProcessingVisible] = useState(false);
  const [successVisible, setSuccessVisible] = useState(false);
  const [failedVisible, setFailedVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const publicClient = usePublicClient({ chainId: 137 });

  const chainReference = useRef(activeChain);
  useEffect(() => {
    chainReference.current = activeChain;
  }, [activeChain]);

  // Find Polygon network and contract address
  const polygonNetwork = networks.find((net) => net.chainId === 137);
  const contractAddress = polygonNetwork?.funditContract || "";

  const { writeContractAsync: setUsernameWrite } = useWriteContract();

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

  const handleUpdateUsername = async () => {
    if (!isConnected) {
      setErrorMessage("Please connect your wallet first");
      setFailedVisible(true);
      return;
    }

    if (!username || username.trim() === "") {
      setErrorMessage("Please enter a valid username");
      setFailedVisible(true);
      return;
    }

    try {
      // Check if we need to switch to Polygon network
      if (activeChain !== 137 && switchChain) {
        try {
          switchChain({ chainId: 137 });
          await waitForChainChange(137);
        } catch (error) {
          setErrorMessage(
            `Failed to switch to Polygon network: ${error.message}`,
          );
          setFailedVisible(true);
          return;
        }
      }

      // Show processing modal
      setProcessingVisible(true);

      // Send the transaction
      const tx = await setUsernameWrite({
        address: contractAddress,
        abi: mainChainABI,
        functionName: "setUsername",
        args: [username],
      });

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: tx,
      });

      // Hide processing modal
      setProcessingVisible(false);

      // Show success or failure modal
      if (receipt && receipt.status === "success") {
        setSuccessVisible(true);
        // Call onUpdate to refresh parent component data
        if (onUpdate) {
          onUpdate(username);
        }
      } else {
        setErrorMessage("Transaction failed");
        setFailedVisible(true);
      }
    } catch (error) {
      console.error("Error updating username:", error);
      setProcessingVisible(false);
      setErrorMessage(error.message || "Error updating username");
      setFailedVisible(true);
    }
  };

  const handleModalClose = () => {
    setSuccessVisible(false);
    setFailedVisible(false);
    onClose();
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

  return (
    <div>
      <Modal visible={visible} onClose={onClose}>
        <div className="modal-l1">
          <h2>Change Username</h2>
        </div>
        <div className="ccf-d">
          <span>Username</span>
          <div className="ccf-d-id">
            <input
              type="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
              name="new-username"
              id="new-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
        </div>
        <div
          className="a-button-1"
          id="update-username-btn"
          onClick={handleUpdateUsername}
        >
          Update Username
        </div>
      </Modal>
      {/* Transaction State Modals */}
      <TransactionProcessingModal
        visible={processingVisible}
        onClose={() => setProcessingVisible(false)}
      />
      <TransactionSuccessModal
        visible={successVisible}
        onClose={handleModalClose}
      />
      <TransactionFailedModal
        visible={failedVisible}
        onClose={handleModalClose}
        message={errorMessage}
      />
    </div>
  );
};

UsernameModal.propTypes = {
  visible: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onUpdate: PropTypes.func.isRequired,
};

export default UsernameModal;

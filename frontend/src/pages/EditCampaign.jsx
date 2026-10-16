import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { ethers } from "ethers";
import {
  useWriteContract,
  useAccount,
  useSwitchChain,
  useChainId,
} from "wagmi";
import { storage } from "../firebase/config";
import Header from "../components/Header";
import HeaderSpacer from "../components/HeaderSpace";
import TransactionProcessingModal from "../components/TransactionProcessingModal";
import TransactionSuccessModal from "../components/TransactionSuccessModal";
import TransactionFailedModal from "../components/TransactionFailedModal";
import mainChainABI from "../abis/mainChainABI.json";
import networks from "../config/networks.json";

// ------------------ Utility Functions ------------------
function handleError(error, message = "") {
  console.error(message, error);
}

function generateUniqueId() {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1_000_000);
  return `${timestamp}${random}`;
}

// Create a provider for Polygon mainnet
const polygonProvider = new ethers.JsonRpcProvider("https://polygon-rpc.com");

// ------------------ CreateCampaignPage Component ------------------
const EditCampaign = () => {
  const navigate = useNavigate();

  // Form field state
  const [campaignID, setCampaignID] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [description, setDescription] = useState("");
  const [additionalLink, setAdditionalLink] = useState("");
  const [imageLink, setImageLink] = useState("");
  const [imageId, setImageId] = useState("");
  const [uploadStatus, setUploadStatus] = useState("Upload an image");
  const [transactionProcessingVisible, setTransactionProcessingVisible] =
    useState(false);
  const [transactionSuccessVisible, setTransactionSuccessVisible] =
    useState(false);
  const [transactionFailedVisible, setTransactionFailedVisible] =
    useState(false);

  // Placeholder state for campaign details
  const [placeholders, setPlaceholders] = useState({
    name: "",
    target: "",
    desc: "",
    link: "",
    imgId: "",
  });

  // Reference to hidden file input
  const fileInputReference = useRef(null);

  // Wagmi hooks for account and chain switching
  const { isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  const activeChain = useChainId();
  const chainReference = useRef(activeChain);

  const polygonCampaignContract = (() => {
    const found = networks.find((net) => net.chainId === 137);
    return found && found.funditContract
      ? found.funditContract
      : "0x0000000000000000000000000000000000000000";
  })();

  // Create contract instance for reading
  const contract = useMemo(
    () =>
      new ethers.Contract(
        polygonCampaignContract,
        mainChainABI,
        polygonProvider,
      ),
    [polygonCampaignContract],
  );

  // Read campaign details using ethers
  useEffect(() => {
    const fetchCampaignDetails = async () => {
      if (!campaignID) {
        return;
      }

      try {
        const details = await contract.campaigns(BigInt(campaignID));

        const [name, target, desc, link, imgId] = details;
        setPlaceholders({
          name: name || "",
          target: ethers.formatUnits(target || "0", 8),
          desc: desc || "",
          link: link || "",
          imgId: imgId?.toString() || "",
        });
        setUploadStatus(imgId ? "Upload a New Image?" : "Tap to Upload");
      } catch (error) {
        console.error("Error fetching campaign details:", error);
      }
    };

    fetchCampaignDetails();
  }, [campaignID, contract]);

  // On mount, check for a campaignId parameter in the URL
  useEffect(() => {
    const urlParameters = new URLSearchParams(window.location.search);
    const campaignIdParameter = urlParameters.get("campaignId");
    if (campaignIdParameter) {
      setCampaignID(Number(campaignIdParameter));
    }
  }, []);

  useEffect(() => {
    chainReference.current = activeChain;
  }, [activeChain]);

  // Helper: Wait until the active chain equals the target chain (with timeout in ms)
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

  // Handle click on the Upload button (triggers the hidden file input)
  const handleUploadClick = () => {
    if (fileInputReference.current) {
      fileInputReference.current.click();
    }
  };

  // Handle file selection and upload to Firebase Storage
  const handleFileChange = async (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    try {
      setUploadStatus("Uploading Image");
      const uniqueId = generateUniqueId();
      console.log("Generated Image ID:", uniqueId);
      setImageId(uniqueId);
      const storageReference = ref(storage, "images/" + uniqueId);
      const snapshot = await uploadBytes(storageReference, file);
      const downloadURL = await getDownloadURL(snapshot.ref);
      setImageLink(downloadURL);
      console.log("image uploaded:", imageLink);
      setUploadStatus("Image Uploaded");
    } catch (error) {
      handleError(error, "Upload Failed");
      setUploadStatus("Tap to Upload");
      setImageLink("");
      setImageId("");
    }
  };

  const { writeContractAsync: editCampaignWrite } = useWriteContract();

  const editCampaign = async () => {
    try {
      const targetParsed = ethers.parseUnits(targetAmount || "0", 8);
      const tx = await editCampaignWrite({
        address: polygonCampaignContract,
        abi: mainChainABI,
        functionName: "editCampaign",
        args: [
          campaignID,
          campaignName,
          targetParsed,
          description,
          additionalLink,
          BigInt(imageId || "0"),
        ],
      });
      return { status: 1, transactionHash: tx };
    } catch (error) {
      handleError(error, `Error creating campaign: ${error.message}`);
      return null;
    }
  };

  // Handle Create Campaign button click
  const handleEditCampaign = async () => {
    if (!isConnected) {
      return;
    }

    try {
      if (activeChain !== 137 && switchChain) {
        switchChain({ chainId: 137 });
        await waitForChainChange(137);
      }

      setTransactionProcessingVisible(true);
      const receipt = await editCampaign();
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

  // This function clears all fields and navigates to home
  const handleModalClose = () => {
    setCampaignID("");
    setCampaignName("");
    setTargetAmount("");
    setDescription("");
    setAdditionalLink("");
    setImageLink("");
    setImageId("");
    setUploadStatus("Tap to Upload");
    setTransactionSuccessVisible(false);
    setTransactionFailedVisible(false);
    navigate("/Profile");
  };

  return (
    <div className="body">
      <Header />
      <HeaderSpacer />
      <div className="cc-container">
        <div className="cc-header">
          <h1>Edit Campaign</h1>
          <span className="heart-icon">
            <svg
              width="61"
              height="60"
              viewBox="0 0 61 60"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g clipPath="url(#clip0_2057_2178)">
                <path
                  d="M48 35V42.5H55.5V47.5H48V55H43V47.5H35.5V42.5H43V35H48ZM51.1075 11.8925C56.5075 17.3075 56.93 25.785 52.375 31.6675C50.315 30.6 47.975 30 45.5 30C37.215 30 30.5 36.715 30.5 45C30.5 47.5225 31.1225 49.9 32.2225 51.985L30.4975 53.7125L9.30252 32.4825C4.04252 26.5925 4.24002 17.5475 9.89252 11.8925C15.555 6.23251 24.6125 6.04251 30.5025 11.3225C36.375 6.05001 45.45 6.22501 51.1075 11.8925V11.8925Z"
                  fill="#19B820"
                />
              </g>
              <defs>
                <clipPath id="clip0_2057_2178">
                  <rect
                    width="60"
                    height="60"
                    fill="white"
                    transform="translate(0.5)"
                  />
                </clipPath>
              </defs>
            </svg>
          </span>
        </div>

        <div className="campaign-form">
          <div className="ccf-d">
            <span>Campaign ID</span>
            <div className="ccf-d-id">
              <input
                type="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                name="campaignID"
                id="campaignID"
                value={campaignID}
                readOnly
                placeholder="Campaign ID will be auto-generated"
              />
            </div>
          </div>
          <div className="ccf-d">
            <span>Campaign Name</span>
            <div className="ccf-d-id">
              <input
                type="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                name="campaignName"
                id="campaignName"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder={`${placeholders.name}`}
              />
            </div>
          </div>

          <div className="ccf-d">
            <span>Target Amount (in USD)</span>
            <div className="ccf-d-id">
              <input
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                name="targetAmount"
                id="targetAmount"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value)}
                placeholder={`${placeholders.target}`}
              />
            </div>
          </div>

          <div className="ccf-d">
            <span>Description</span>
            <div className="ccf-d-id">
              <textarea
                rows="5"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                name="description"
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={`${placeholders.desc}`}
              ></textarea>
            </div>
          </div>

          <div className="ccf-d">
            <span>Additional Link</span>
            <div className="ccf-d-id">
              <input
                type="url"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                name="additionalLink"
                id="additionalLink"
                value={additionalLink}
                onChange={(e) => setAdditionalLink(e.target.value)}
                placeholder={`${placeholders.link || "None"}`}
              />
            </div>
          </div>

          {/* Upload Section */}
          <div className="upload-section">
            <div className="upsl">
              <svg
                width="33"
                height="32"
                viewBox="0 0 33 32"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="16.5" cy="16" r="16" fill="#FAF7FC" />
                <g clipPath="url(#clip0_2449_375)">
                  <path
                    d="M23.1667 24.3333H9.83333C9.61232 24.3333 9.40036 24.2455 9.24408 24.0892C9.0878 23.9329 9 23.721 9 23.5V8.49996C9 8.27895 9.0878 8.06698 9.24408 7.9107C9.40036 7.75442 9.61232 7.66663 9.83333 7.66663H23.1667C23.3877 7.66663 23.5996 7.75442 23.7559 7.9107C23.9122 8.06698 24 8.27895 24 8.49996V23.5C24 23.721 23.9122 23.9329 23.7559 24.0892C23.5996 24.2455 23.3877 24.3333 23.1667 24.3333ZM22.3333 22.6666V9.33329H10.6667V22.6666H22.3333ZM13.1667 11.8333H19.8333V13.5H13.1667V11.8333ZM13.1667 15.1666H19.8333V16.8333H13.1667V15.1666ZM13.1667 18.5H17.3333V20.1666H13.1667V18.5Z"
                    fill="#586283"
                  />
                </g>
                <defs>
                  <clipPath id="clip0_2449_375">
                    <rect
                      width="20"
                      height="20"
                      fill="white"
                      transform="translate(6.5 6)"
                    />
                  </clipPath>
                </defs>
              </svg>
              <span
                className="uploadimg-span"
                id="uploadimg-span"
                data-default-text="Upload an image"
              >
                {uploadStatus}
                <br />
                <span style={{ color: "#586283", fontSize: "11px" }}>
                  (PNG, JPG | 10MB max.)
                </span>
              </span>
            </div>
            <div
              id="ccfi-upload"
              className="a-button-1 ccfi-upbtn"
              onClick={handleUploadClick}
            >
              Upload
            </div>
            {/* Hidden file input */}
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              ref={fileInputReference}
              onChange={handleFileChange}
            />
          </div>
        </div>

        {/* Submit Button */}
        <div
          className="a-button-1 ccf-btn"
          id="edit-campaign"
          onClick={handleEditCampaign}
        >
          Edit Campaign
        </div>
      </div>
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
    </div>
  );
};

export default EditCampaign;

import PropTypes from "prop-types";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import Modal from "./Modal.jsx";

function ProxyDonateModal({ visible, onClose, data }) {
  const [copyStatus, setCopyStatus] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [qrCodeSvg, setQrCodeSvg] = useState("");

  // Handle body scroll lock
  useEffect(() => {
    document.body.style.overflow = visible ? "hidden" : "unset";

    return () => {
      document.body.style.overflow = "unset";
    };
  }, [visible]);

  // Generate QR code when modal is visible and data is available
  useEffect(() => {
    if (visible && data && data.wallet_address) {
      setIsLoading(true);

      QRCode.toString(
        data.wallet_address,
        {
          type: "svg",
          margin: 0,
          width: 250,
          color: {
            dark: "#101928",
            light: "#ffffff",
          },
          backgroundColor: "none",
        },
        (error, svgString) => {
          if (error) {
            console.error("Error generating QR code:", error);
          } else {
            setQrCodeSvg(svgString);
          }

          setIsLoading(false);
        },
      );
    }
  }, [visible, data]);

  // Reset loading state when modal is closed
  useEffect(() => {
    if (!visible) {
      setIsLoading(true);
      setQrCodeSvg("");
    }
  }, [visible]);

  // Clear copy status after a delay
  useEffect(() => {
    if (copyStatus) {
      const timer = setTimeout(() => {
        setCopyStatus("");
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [copyStatus]);

  if (!visible) {
    return null;
  }

  const copyToClipboard = async () => {
    try {
      if (!data || !data.wallet_address) {
        return;
      }

      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(data.wallet_address);
        setCopyStatus("Copied!");
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = data.wallet_address;

        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.append(textArea);

        textArea.focus();
        textArea.select();

        const successful = document.execCommand("copy");
        textArea.remove();

        if (successful) {
          setCopyStatus("Copied!");
        } else {
          setCopyStatus("Failed to copy");
        }
      }
    } catch (error) {
      console.error("Copy failed:", error);
      setCopyStatus("Failed to copy");
    }
  };

  return (
    <Modal visible={visible} onClose={onClose}>
      <div className="modal-l1">
        <h2>Proxy Donation</h2>
        <div className="chain-btn-icon">
          <img alt="Polygon" src="/assets/images/polygon.png" />
        </div>
      </div>

      {isLoading || !data || !data.wallet_address ? (
        <div
          className="loader-container"
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            width: "100%",
            padding: "20px",
          }}
        >
          {/* Pulsating skeleton boxes */}
          <div
            className="skeleton-box"
            style={{ width: "80%", height: "50px", marginBottom: "15px" }}
          ></div>
          <div
            className="skeleton-box"
            style={{ width: "80%", height: "200px", marginBottom: "15px" }}
          ></div>
          <div
            className="skeleton-box"
            style={{ width: "60%", height: "40px" }}
          ></div>
        </div>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignSelf: "center",
              alignItems: "center",
            }}
            dangerouslySetInnerHTML={{ __html: qrCodeSvg }}
          />
          <div className="share-link">
            <label>Donation Address Recieves only POL Coin</label>
            <div className="wadr copy-container">
              <span id="wallet-address" className="copy-text">
                {data.wallet_address}
              </span>
              <div style={{ position: "relative" }}>
                <svg
                  id="copy-addr"
                  className="copy-icon"
                  onClick={copyToClipboard}
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  style={{ cursor: "pointer" }}
                >
                  <g clipPath="url(#clip0_2290_1903)">
                    <path
                      d="M4.66667 4.00001V2.00001C4.66667 1.8232 4.7369 1.65363 4.86193 1.52861C4.98695 1.40358 5.15652 1.33334 5.33333 1.33334H13.3333C13.5101 1.33334 13.6797 1.40358 13.8047 1.52861C13.9298 1.65363 14 1.8232 14 2.00001V11.3333C14 11.5102 13.9298 11.6797 13.8047 11.8047C13.6797 11.9298 13.5101 12 13.3333 12H11.3333V14C11.3333 14.368 11.0333 14.6667 10.662 14.6667H2.67133C2.58342 14.6672 2.49626 14.6504 2.41488 14.6171C2.3335 14.5838 2.25949 14.5348 2.19711 14.4729C2.13472 14.4109 2.0852 14.3373 2.05137 14.2561C2.01754 14.175 2.00009 14.0879 2 14L2.002 4.66668C2.002 4.29868 2.302 4.00001 2.67333 4.00001H4.66667ZM3.33533 5.33334L3.33333 13.3333H10V5.33334H3.33533ZM6 4.00001H11.3333V10.6667H12.6667V2.66668H6V4.00001Z"
                      fill="#586283"
                    />
                  </g>
                  <defs>
                    <clipPath id="clip0_2290_1903">
                      <rect width="16" height="16" fill="white" />
                    </clipPath>
                  </defs>
                </svg>
                {copyStatus && (
                  <div
                    style={{
                      position: "absolute",
                      top: "-30px",
                      right: "-20px",
                      background: "#19B820",
                      color: "white",
                      padding: "4px 8px",
                      borderRadius: "4px",
                      fontSize: "12px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {copyStatus}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

ProxyDonateModal.propTypes = {
  visible: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  data: PropTypes.shape({
    campaign_id: PropTypes.string,
    wallet_address: PropTypes.string,
  }),
};

export default ProxyDonateModal;

import PropTypes from "prop-types";
import { useEffect, useState } from "react";
import Modal from "./Modal.jsx";

function TopUpModal({ visible, onClose }) {
  const [isLoading, setIsLoading] = useState(true);

  // Load the ChangeNOW stepper connector script when the modal becomes visible
  useEffect(() => {
    if (visible) {
      const script = document.createElement("script");
      script.src =
        "https://changenow.io/embeds/exchange-widget/v2/stepper-connector.js";
      script.defer = true;
      script.id = "changenow-connector-script";
      document.body.append(script);

      return () => {
        // Clean up script when modal closes
        const existingScript = document.querySelector(
          "#changenow-connector-script",
        );
        if (existingScript) {
          existingScript.remove();
        }
      };
    }
  }, [visible]);

  // Reset loading state when modal is closed
  useEffect(() => {
    if (!visible) {
      setIsLoading(true);
    }
  }, [visible]);

  const handleIframeLoad = () => {
    setIsLoading(false);
  };

  return (
    <Modal visible={visible} onClose={onClose}>
      <div className="top-up-content">
        <div className="modal-l1">
          <h2>Top Up (Exchange/Buy)</h2>
        </div>

        <div
          className="widget-container"
          style={{ width: "100%", position: "relative", minHeight: "356px" }}
        >
          {isLoading && (
            <div
              className="loader-container"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                backgroundColor: "#ffffff",
                padding: "20px",
              }}
            >
              {/* Pulsating skeleton boxes */}
              <div
                className="skeleton-box"
                style={{ width: "80%", height: "50px", marginBottom: "15px" }}
              ></div>
              <div
                style={{
                  display: "flex",
                  width: "80%",
                  gap: "10px",
                  marginBottom: "15px",
                }}
              >
                <div
                  className="skeleton-box"
                  style={{ width: "50%", height: "40px" }}
                ></div>
                <div
                  className="skeleton-box"
                  style={{ width: "50%", height: "40px" }}
                ></div>
              </div>
              <div
                className="skeleton-box"
                style={{ width: "80%", height: "40px", marginBottom: "15px" }}
              ></div>
              <div
                className="skeleton-box"
                style={{ width: "80%", height: "40px", marginBottom: "15px" }}
              ></div>
              <div
                className="skeleton-box"
                style={{ width: "60%", height: "50px" }}
              ></div>
            </div>
          )}

          <iframe
            id="iframe-widget"
            src="https://changenow.io/embeds/exchange-widget/v2/widget.html?FAQ=false&amount=1&amountFiat=100&backgroundColor=FFFFFF&darkMode=false&from=sol&fromFiat=usd&horizontal=false&isFiat=true&lang=en-US&link_id=33f4061ed59e9b&locales=false&logo=true&primaryColor=19B820&to=polmainnet&toFiat=polmainnet&toTheMoon=true"
            style={{
              height: "356px",
              width: "100%",
              border: "none",
              opacity: isLoading ? 0 : 1,
              transition: "opacity 0.3s ease-in-out",
            }}
            title="ChangeNOW Exchange Widget"
            onLoad={handleIframeLoad}
          />
        </div>
      </div>
    </Modal>
  );
}

TopUpModal.propTypes = {
  visible: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};

export default TopUpModal;

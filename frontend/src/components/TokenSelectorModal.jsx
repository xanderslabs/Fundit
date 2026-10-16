import { useState, useRef, useEffect } from "react";
import PropTypes from "prop-types";
import { tokenData } from "../data/data";
import Modal from "./Modal.jsx";

function TokenSelectorModal({
  visible,
  onClose,
  selectedChain,
  selectedTokenSymbol,
  onSelectToken,
  onChainChange,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownReference = useRef(null);
  const chainOptions = [
    "Polygon",
    "Ethereum",
    "BSC",
    "Arbitrum",
    "Base",
    "Optimism",
    "Avalanche",
    "Sonic",
    "Soneium",
    "Mantle",
    "Linea",
    "Unichain",
    "Metis",
  ];
  const tokens = tokenData[selectedChain] || [];
  const filteredTokens = tokens.filter(
    (t) =>
      t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleChainSelect = (chain) => {
    onChainChange(chain);
    setIsDropdownOpen(false);
  };

  const chain = selectedChain || "Polygon";

  // Close dropdown if click happens outside of dropdownRef
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        dropdownReference.current &&
        !dropdownReference.current.contains(event.target)
      ) {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isDropdownOpen]);

  return (
    <Modal visible={visible} onClose={onClose}>
      <div className="token-modal-content">
        <div className="modal-l1">
          <h2>Select a token</h2>
        </div>
        <div className="search-chain-container">
          <div className="token-search">
            <input
              type="text"
              placeholder="Search Token name"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div
            className="chain-dropdown"
            style={{ flexShrink: 0, position: "relative" }}
            ref={dropdownReference}
          >
            <div
              key={chain}
              className="chain-dropdown-toggle"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            >
              <div className="chain-dropdown-toggle-icon">
                <img
                  src={`/assets/images/${chain.toLowerCase()}.png`}
                  alt={chain}
                />
              </div>
              <span className="chain-text">{chain}</span>
              <span>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <g clipPath="url(#clip0_2254_1831)">
                    <path d="M6 8L3 5H9L6 8Z" fill="#586283" />
                  </g>
                  <defs>
                    <clipPath id="clip0_2254_1831">
                      <rect width="12" height="12" fill="white" />
                    </clipPath>
                  </defs>
                </svg>
              </span>
            </div>
            {isDropdownOpen && (
              <div className="chain-dropdown-menu">
                {chainOptions.map((chain) => (
                  <div
                    key={chain}
                    onClick={() => handleChainSelect(chain)}
                    className="chain-dropdown-item"
                  >
                    <div className="chain-dropdown-toggle-icon">
                      <img
                        src={`/assets/images/${chain.toLowerCase()}.png`}
                        alt={chain}
                      />
                    </div>
                    <span className="chain-text">{chain}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="token-list">
          {filteredTokens.map((token) => (
            <div
              key={token.symbol}
              className={`token-option ${
                token.symbol === selectedTokenSymbol ? "active" : ""
              }`}
              onClick={() => onSelectToken(token.symbol, selectedChain)}
            >
              <div className="token-option-img">
                <img src={token.icon} alt={token.symbol} />
              </div>
              <span>{token.symbol}</span>
              <span className="token-name">{token.name}</span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

TokenSelectorModal.propTypes = {
  visible: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  selectedChain: PropTypes.string.isRequired,
  selectedTokenSymbol: PropTypes.string.isRequired,
  onSelectToken: PropTypes.func.isRequired,
  onChainChange: PropTypes.func.isRequired,
};

export default TokenSelectorModal;

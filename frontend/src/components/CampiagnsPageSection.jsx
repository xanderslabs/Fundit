import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { usePublicClient } from "wagmi";
import SmallCard from "../components/SmallCard";
import mainChainABI from "../abis/mainChainABI.json";
import networks from "../config/networks.json";
import { SmallCardSkeletonGrid } from "./SkeletonLoaders.jsx";

// Base URL for API calls
const API_BASE_URL =
  import.meta.env.VITE_APP_API_URL || "http://localhost:3000";

function CampaignsPageSection({ onCampaignSelect }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [campaigns, setCampaigns] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isInUrlIdMode, setIsInUrlIdMode] = useState(false);
  const [urlCampaignId, setUrlCampaignId] = useState(null);
  const pageSize = 24;

  const publicClient = usePublicClient({
    chainId: 137,
  });

  // Find Polygon network and contract address
  const polygonNetwork = networks.find((net) => net.chainId === 137);
  const contractAddress = polygonNetwork?.funditContract || "";

  // Fetch total campaigns count from blockchain
  useEffect(() => {
    // Don't fetch campaign count if we're in URL ID mode
    if (isInUrlIdMode) {
      return;
    }

    const fetchTotalCampaignsCount = async () => {
      try {
        if (!publicClient || !contractAddress) {
          return;
        }

        const totalCampaigns = await publicClient.readContract({
          address: contractAddress,
          abi: mainChainABI,
          functionName: "campaignCount",
        });

        if (!searchQuery) {
          setTotalPages(Math.ceil(Number(totalCampaigns) / pageSize));
        }
      } catch (error) {
        console.error("Failed to fetch total campaigns:", error);
      }
    };

    fetchTotalCampaignsCount();
  }, [publicClient, contractAddress, pageSize, searchQuery, isInUrlIdMode]);

  // Handle URL parameters on page load - only runs once
  useEffect(() => {
    const checkUrlForCampaignId = async () => {
      const urlParameters = new URLSearchParams(window.location.search);
      const campaignId = urlParameters.get("campaignId");

      if (campaignId) {
        setIsLoading(true);
        setIsInUrlIdMode(true);
        setUrlCampaignId(campaignId);

        try {
          // Direct API call to get specific campaign by ID
          const response = await fetch(
            `${API_BASE_URL}/campaigns/${campaignId}`,
          );

          if (response.ok) {
            const campaign = await response.json();
            setCampaigns([campaign]);
            setTotalPages(1);
          } else {
            // If campaign not found by ID, show empty state
            setCampaigns([]);
            setTotalPages(0);
            console.log(`Campaign with ID ${campaignId} not found`);
          }
        } catch (error) {
          console.error("Error fetching campaign by ID:", error);
          setCampaigns([]);
        } finally {
          setIsLoading(false);
        }
      }
    };

    checkUrlForCampaignId();
  }, []); // Empty dependency array means this runs once on mount

  // Main effect for regular campaign search and pagination
  useEffect(() => {
    // Skip if we're in URL ID mode
    if (isInUrlIdMode) {
      return;
    }

    const fetchCampaigns = async () => {
      setIsLoading(true);

      try {
        // Normal search - do not attempt ID-based search
        let url;

        if (searchQuery.trim() === "") {
          // Regular pagination - newest first
          url = `${API_BASE_URL}/campaigns?limit=${pageSize}&page=${currentPage}&sort=newest`;
        } else {
          // Text search only
          url = `${API_BASE_URL}/campaigns/search?query=${encodeURIComponent(
            searchQuery.trim(),
          )}&limit=${pageSize}&page=${currentPage}`;
        }

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        setCampaigns(data.campaigns || []);

        // Update pagination based on API response
        if (data.pagination) {
          setTotalPages(data.pagination.totalPages);
        }
      } catch (error) {
        console.error("Error fetching campaigns:", error);
        setCampaigns([]);
      } finally {
        setIsLoading(false);
      }
    };

    // Set a small delay to prevent API hammering while typing
    const debounceTimer = setTimeout(() => {
      fetchCampaigns();
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [searchQuery, currentPage, pageSize, isInUrlIdMode]);

  // Handle search input changes
  const handleSearchChange = (e) => {
    // If we're in URL ID mode, exit that mode first
    if (isInUrlIdMode) {
      exitUrlIdMode();
    }

    setSearchQuery(e.target.value);
    setCurrentPage(1); // Reset to first page on search
  };

  // Function to exit URL ID mode
  const exitUrlIdMode = () => {
    setIsInUrlIdMode(false);
    setUrlCampaignId(null);
    setSearchQuery("");
    // Update URL to remove the campaignId parameter
    const url = new URL(window.location);
    url.searchParams.delete("campaignId");
    window.history.pushState({}, "", url);
    // Reset to first page
    setCurrentPage(1);
  };

  // Pagination handlers
  const handlePageClick = (page) => {
    // Don't allow pagination in URL ID mode
    if (isInUrlIdMode) {
      return;
    }

    setCurrentPage(page);
    // Scroll to top of campaign grid
    document
      .querySelector("#campaigns-grid-cp")
      ?.scrollIntoView({ behavior: "smooth" });
  };

  const handleClickForward = () => {
    // Don't allow pagination in URL ID mode
    if (isInUrlIdMode) {
      return;
    }

    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
      document
        .querySelector("#campaigns-grid-cp")
        ?.scrollIntoView({ behavior: "smooth" });
    }
  };

  const handleClickBackward = () => {
    // Don't allow pagination in URL ID mode
    if (isInUrlIdMode) {
      return;
    }

    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
      document
        .querySelector("#campaigns-grid-cp")
        ?.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div className="c-sect">
      <div className="cs-l1">
        <div className="csl1ti">Campaigns</div>
        <div className="search-clist">
          <input
            type="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
            placeholder={
              isInUrlIdMode
                ? `Viewing campaign #${urlCampaignId}`
                : "Search Campaigns"
            }
            id="search-campaigns"
            value={searchQuery}
            onChange={handleSearchChange}
            disabled={isInUrlIdMode}
          />
          <svg
            width="46"
            height="47"
            viewBox="0 0 46 47"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect y="0.5" width="46" height="46" rx="23" fill="#19B820" />
            <g clipPath="url(#clip0_2081_1124)">
              <path
                d="M28.0262 27.3475L31.5953 30.9158L30.4162 32.095L26.8478 28.5258C25.5201 29.5902 23.8687 30.1691 22.167 30.1667C18.027 30.1667 14.667 26.8067 14.667 22.6667C14.667 18.5267 18.027 15.1667 22.167 15.1667C26.307 15.1667 29.667 18.5267 29.667 22.6667C29.6694 24.3683 29.0905 26.0198 28.0262 27.3475ZM26.3545 26.7292C27.4121 25.6416 28.0027 24.1837 28.0003 22.6667C28.0003 19.4433 25.3895 16.8333 22.167 16.8333C18.9437 16.8333 16.3337 19.4433 16.3337 22.6667C16.3337 25.8892 18.9437 28.5 22.167 28.5C23.684 28.5024 25.1419 27.9118 26.2295 26.8542L26.3545 26.7292Z"
                fill="white"
              />
            </g>
            <defs>
              <clipPath id="clip0_2081_1124">
                <rect
                  width="20"
                  height="20"
                  fill="white"
                  transform="translate(13 13.5)"
                />
              </clipPath>
            </defs>
          </svg>
        </div>
      </div>

      {/* URL ID Mode indicator with exit button */}
      {isInUrlIdMode && (
        <div
          className="url-id-mode-banner"
          style={{
            backgroundColor: "#f5f5f5",
            padding: "10px 15px",
            borderRadius: "8px",
            marginBottom: "20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>Viewing specific campaign #{urlCampaignId}</span>
          <button
            onClick={exitUrlIdMode}
            style={{
              backgroundColor: "#19B820",
              color: "white",
              border: "none",
              borderRadius: "4px",
              padding: "8px 15px",
              cursor: "pointer",
            }}
          >
            View All Campaigns
          </button>
        </div>
      )}

      <div className="campaigns-grid" id="campaigns-grid-cp">
        {isLoading ? (
          <SmallCardSkeletonGrid count={pageSize} />
        ) : campaigns.length === 0 ? (
          <div style={{ width: "100%", textAlign: "center", padding: "2rem" }}>
            {isInUrlIdMode
              ? `Campaign #${urlCampaignId} not found.`
              : "No campaigns found."}
          </div>
        ) : (
          campaigns.map((campaign) => (
            <SmallCard
              key={campaign.id}
              campaign={campaign}
              onClick={() => onCampaignSelect(campaign)}
            />
          ))
        )}
      </div>

      {/* Don't show pagination in URL ID mode */}
      {!isInUrlIdMode && totalPages > 1 && (
        <div className="cs-l2" id="campaigns-more">
          <div className="pagination-controls">
            <span
              className={`cs-pagination ${currentPage === 1 ? "disabled" : ""}`}
              onClick={handleClickBackward}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <g clipPath="url(#clip0_2706_771)">
                  <path
                    d="M9.02366 9.99999L13.1487 14.125L11.9703 15.3033L6.66699 9.99999L11.9703 4.69666L13.1487 5.87499L9.02366 9.99999Z"
                    fill="#101928"
                  />
                </g>
                <defs>
                  <clipPath id="clip0_2706_771">
                    <rect width="20" height="20" fill="white" />
                  </clipPath>
                </defs>
              </svg>
            </span>

            {/* Dynamic page number generation */}
            {totalPages <= 7 ? (
              // Display all pages if 7 or fewer
              Array.from({ length: totalPages }, (_, i) => i + 1).map(
                (page) => (
                  <span
                    className={`cs-pagination ${
                      page === currentPage ? "active" : ""
                    }`}
                    key={page}
                    onClick={() => handlePageClick(page)}
                    style={{
                      backgroundColor:
                        page === currentPage
                          ? "var(--fun-green) !important"
                          : "",
                      color:
                        page === currentPage ? "var(--white) !important" : "",
                    }}
                  >
                    {page}
                  </span>
                ),
              )
            ) : (
              // Display limited pages with ellipsis for many pages
              <>
                {/* First page */}
                <span
                  className={`cs-pagination ${
                    currentPage === 1 ? "active" : ""
                  }`}
                  onClick={() => handlePageClick(1)}
                  style={{
                    backgroundColor:
                      currentPage === 1 ? "var(--fun-green) !important" : "",
                    color: currentPage === 1 ? "var(--white) !important" : "",
                  }}
                >
                  1
                </span>

                {/* Show ellipsis if not near start */}
                {currentPage > 3 && (
                  <span className="cs-pagination-ellipsis">...</span>
                )}

                {/* Pages around current page */}
                {Array.from({ length: 5 }, (_, i) => {
                  // Center around current page, but ensure valid page numbers
                  const offset = Math.min(
                    Math.max(currentPage - 2, 2),
                    totalPages - 4,
                  );
                  const page = offset + i;

                  // Skip if out of range or already shown
                  if (page <= 1 || page >= totalPages) {
                    return null;
                  }

                  return (
                    <span
                      className={`cs-pagination ${
                        page === currentPage ? "active" : ""
                      }`}
                      key={page}
                      onClick={() => handlePageClick(page)}
                      style={{
                        backgroundColor:
                          page === currentPage
                            ? "var(--fun-green) !important"
                            : "",
                        color:
                          page === currentPage ? "var(--white) !important" : "",
                      }}
                    >
                      {page}
                    </span>
                  );
                })}

                {/* Show ellipsis if not near end */}
                {currentPage < totalPages - 2 && (
                  <span className="cs-pagination-ellipsis">...</span>
                )}

                {/* Last page */}
                <span
                  className={`cs-pagination ${
                    totalPages === currentPage ? "active" : ""
                  }`}
                  onClick={() => handlePageClick(totalPages)}
                  style={{
                    backgroundColor:
                      totalPages === currentPage
                        ? "var(--fun-green) !important"
                        : "",
                    color:
                      totalPages === currentPage
                        ? "var(--white) !important"
                        : "",
                  }}
                >
                  {totalPages}
                </span>
              </>
            )}

            <span
              className={`cs-pagination ${
                currentPage === totalPages ? "disabled" : ""
              }`}
              onClick={handleClickForward}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <g clipPath="url(#clip0_2706_777)">
                  <path
                    d="M10.9766 9.99999L6.85156 5.87499L8.0299 4.69666L13.3332 9.99999L8.0299 15.3033L6.85156 14.125L10.9766 9.99999Z"
                    fill="#101928"
                  />
                </g>
                <defs>
                  <clipPath id="clip0_2706_777">
                    <rect width="20" height="20" fill="white" />
                  </clipPath>
                </defs>
              </svg>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

CampaignsPageSection.propTypes = {
  onCampaignSelect: PropTypes.func.isRequired,
};

export default CampaignsPageSection;

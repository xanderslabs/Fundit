import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import PropTypes from "prop-types";
import axios from "axios";
import SmallCard from "./SmallCard.jsx";
import { SmallCardSkeletonGrid } from "./SkeletonLoaders.jsx";

const API_BASE_URL =
  import.meta.env.VITE_APP_API_URL || "http://localhost:3000";

function CampaignsSection({ onCampaignSelect }) {
  const [recentCampaigns, setRecentCampaigns] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchCampaigns = async () => {
      setIsLoading(true);
      try {
        // Fetch campaigns from API
        const response = await axios.get(`${API_BASE_URL}/campaigns`, {
          params: {
            limit: 8,
            page: 1,
            sort: "newest",
            ended: false,
          },
        });

        // Format campaigns from API
        if (response.data && response.data.campaigns) {
          setRecentCampaigns(response.data.campaigns);
        }
      } catch (error) {
        console.error("Error fetching campaigns from API:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCampaigns();
  }, []);

  return (
    <div className="c-sect" id="campaigns">
      <div className="cs-l1">
        <div className="csl1ti">
          The future
          <br />
          of Campaigns
        </div>
        <span>
          Experience the joy of giving and receiving, all powered by blockchain
          technology. Fundit.fun is a Web3 platform making charitable
          decentralized.
        </span>
      </div>

      {isLoading ? (
        <SmallCardSkeletonGrid count={8} />
      ) : (
        <div className="campaigns-grid" id="campaigns-grid-home">
          {recentCampaigns.map((campaign) => (
            <SmallCard
              key={campaign.id}
              campaign={campaign}
              onClick={() => onCampaignSelect(campaign)}
            />
          ))}
        </div>
      )}

      <div className="cs-l2" id="campaigns-more">
        <Link to="/campaigns">View All Campaigns</Link>
        <svg
          width="24"
          height="25"
          viewBox="0 0 24 25"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect
            x="0.3"
            y="1.17988"
            width="23.4"
            height="23.4"
            rx="11.7"
            fill="white"
          />
          <rect
            x="0.3"
            y="1.17988"
            width="23.4"
            height="23.4"
            rx="11.7"
            stroke="#586283"
            strokeWidth="0.6"
          />
          <path
            d="M14.625 11.0049L16.5 12.8799M16.5 12.8799L14.625 14.7549M16.5 12.8799H7.5"
            stroke="#586283"
            strokeWidth="0.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

CampaignsSection.propTypes = {
  onCampaignSelect: PropTypes.func.isRequired,
};

export default CampaignsSection;

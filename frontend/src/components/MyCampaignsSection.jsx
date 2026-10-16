import PropTypes from "prop-types";
import SmallCard from "./SmallCard.jsx";

const MyCampaignsSection = ({ campaigns, onCampaignSelect }) => (
  <div className="campaigns-grid" id="my-campaigns-grid">
    {campaigns.map((campaign) => (
      <SmallCard
        key={campaign.id}
        campaign={campaign}
        onClick={() => onCampaignSelect(campaign)}
      />
    ))}
  </div>
);

MyCampaignsSection.propTypes = {
  campaigns: PropTypes.array.isRequired,
  onCampaignSelect: PropTypes.func.isRequired,
};

export default MyCampaignsSection;

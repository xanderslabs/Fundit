import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { ref, getDownloadURL } from "firebase/storage";
import { storage } from "../firebase/config";

function SmallCard({ campaign, onClick }) {
  const [imageUrl, setImageUrl] = useState("/assets/images/placeholderimg.png");
  const [imageError, setImageError] = useState(false);

  const progressPercentage = Math.min(
    100,
    (campaign.amountRaised / campaign.targetAmount) * 100,
  );

  useEffect(() => {
    async function loadImageFromFirebase() {
      const imageIdentifier = campaign.image;

      // Check for invalid image identifiers
      if (
        !imageIdentifier ||
        imageIdentifier === "0" ||
        imageIdentifier === 0
      ) {
        setImageUrl("/assets/images/placeholderimg.png");
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
        setImageUrl("/assets/images/placeholderimg.png");
        setImageError(true);
      }
    }

    loadImageFromFirebase();
  }, [campaign.image]);

  const handleImageError = () => {
    setImageError(true);
    setImageUrl("/assets/images/placeholderimg.png");
  };

  return (
    <div className="small-card" onClick={() => onClick(campaign)}>
      <div className="card-top">
        <img
          className="ct-campaign-image"
          src={imageError ? "/assets/images/placeholderimg.png" : imageUrl}
          alt={campaign.title}
          onError={handleImageError}
          loading="lazy"
        />
        <div
          className={`ct-campaign-status status-${campaign.status.toLowerCase()}`}
        >
          <svg
            width="12"
            height="13"
            viewBox="0 0 12 13"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <g clipPath="url(#clip0_2290_1975)">
              <path
                d="M6 11.8799C3.2385 11.8799 1 9.64138 1 6.87988C1 4.11838 3.2385 1.87988 6 1.87988C8.7615 1.87988 11 4.11838 11 6.87988C11 9.64138 8.7615 11.8799 6 11.8799ZM5.5015 8.87988L9.0365 5.34438L8.3295 4.63738L5.5015 7.46588L4.087 6.05138L3.38 6.75838L5.5015 8.87988Z"
                fill="white"
              ></path>
            </g>
            <defs>
              <clipPath id="clip0_2290_1975">
                <rect
                  width="12"
                  height="12"
                  fill="white"
                  transform="translate(0 0.879883)"
                ></rect>
              </clipPath>
            </defs>
          </svg>
          <span>{campaign.status}</span>
        </div>
      </div>
      <div className="card-bottom">
        <h2 className="cb-campaign-title">{campaign.title}</h2>
        <div className="cb-progress-bar">
          <div
            className="cb-progress-fill progress-ended"
            style={{ width: `${progressPercentage}%` }}
          ></div>
        </div>
        <div className="cb-campaign-stats">
          <div className="cbcs1">
            Target:{" "}
            <span>${Number(campaign.targetAmount).toLocaleString()}</span>
          </div>
          <div className="cb-raised cbr-ended">
            Raised:{" "}
            <span>${Number(campaign.amountRaised).toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

SmallCard.propTypes = {
  campaign: PropTypes.shape({
    id: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    image: PropTypes.string, // Updated from imageId to image
    amountRaised: PropTypes.number.isRequired,
    targetAmount: PropTypes.number.isRequired,
    status: PropTypes.string.isRequired,
  }).isRequired,
  onClick: PropTypes.func.isRequired,
};

export default SmallCard;

import { Link } from "react-router-dom";

function Hero() {
  return (
    <div className="hero">
      <a
        href="/campaigns?campaignId=1"
        target="_blank"
        className="announcement"
      >
        <div className="ann1">🎉 New</div>
        <span>$Fun Campaign is Live</span>
        <span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <g clipPath="url(#clip0_2010_377)">
              <path
                d="M6.45867 0.566132C6.54027 2.78893 9.33882 4.59921 11.3966 5.66879L11.3963 6.65671C9.33783 7.56295 6.62046 9.29271 6.61975 11.4332L5.13786 11.4337C5.05633 9.04629 7.52667 7.3989 9.25573 6.82207L0.0351562 6.66044L0.0356437 5.17856L9.25623 5.34018C7.44522 4.84681 4.89367 2.95413 4.97679 0.566619L6.45867 0.566132Z"
                fill="#586283"
              />
            </g>
            <defs>
              <clipPath id="clip0_2010_377">
                <rect width="12" height="12" fill="white" />
              </clipPath>
            </defs>
          </svg>
        </span>
      </a>
      <div className="he-h-pair">
        <h1 style={{ display: "none" }}>FUNDIT.FUN</h1>
        <h2>CROWDFUNDING THE $FUN WAY</h2>
        <p>
          Transforming charitable donations into an enjoyable and fulfilling
          journey.
        </p>
      </div>
      <div className="he-btn-pair">
        <div className="a-button-1">
          <Link to="/create-campaign">Start a Campaign</Link>
        </div>
        <a href="#how-it-works" className="a-button-1 htd-btn">
          How it Works
        </a>
      </div>
    </div>
  );
}

export default Hero;

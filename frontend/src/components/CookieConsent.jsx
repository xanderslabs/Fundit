import { useState, useEffect } from "react";
import { Link } from "react-router-dom";

function CookieConsent() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const hasConsent = localStorage.getItem("cookieConsent");
    if (!hasConsent) {
      setIsVisible(true);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem("cookieConsent", "true");
    setIsVisible(false);
  };

  const handleDecline = () => {
    localStorage.setItem("cookieConsent", "false");
    setIsVisible(false);
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="cookie-consent">
      <div className="cookie-content">
        <p>
          We use cookies to enhance your experience. By continuing to visit this
          site you agree to our use of cookies.{" "}
          <Link to="/cookies">Learn more</Link>
        </p>
        <div className="cookie-buttons">
          <div onClick={handleDecline} className="a-button-1">
            Decline
          </div>
          <div onClick={handleAccept} className="a-button-1">
            Accept
          </div>
        </div>
      </div>
    </div>
  );
}

export default CookieConsent;

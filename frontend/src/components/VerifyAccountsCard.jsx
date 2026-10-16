const VerifyAccountsCard = () => {
  const platforms = ["X", "Telegram", "Discord", "Instagram"];
  return (
    <div className="dash-card verify-card">
      <h3>Verify Social Accounts</h3>
      <div className="vr-l">
        {platforms.map((platform) => (
          <div key={platform} className="verify-row">
            <div className="verify-image-row">
              <img
                src={`assets/images/${platform.toLowerCase()}.svg`}
                alt={platform}
              />
              <span>{platform}</span>
            </div>
            <div className="a-button-1 verify-btn">Verify</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default VerifyAccountsCard;

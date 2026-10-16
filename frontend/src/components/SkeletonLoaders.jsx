import PropTypes from "prop-types";

// Campaign Card Skeleton Component
export const CampaignCardSkeleton = () => (
  <div className="campaign-card-big skeleton-container">
    <div className="ccb-bottom">
      <div
        className="ca-card-img skeleton-box"
        style={{ height: "240px" }}
      ></div>
      <div className="ca-card-details">
        <div className="ca-card-head">
          <div
            className="ca-card-name skeleton-box"
            style={{ width: "70%", height: "24px" }}
          ></div>
        </div>
        <div
          className="skeleton-box"
          style={{ width: "100%", height: "80px", marginTop: "16px" }}
        ></div>
        <div className="ca-card-tags" style={{ marginTop: "16px" }}>
          <div
            className="skeleton-box"
            style={{ width: "40%", height: "20px" }}
          ></div>
          <div
            className="skeleton-box"
            style={{ width: "25%", height: "20px" }}
          ></div>
          <div
            className="skeleton-box"
            style={{ width: "20%", height: "20px" }}
          ></div>
        </div>
        <div className="ca-card-progress" style={{ marginTop: "16px" }}>
          <div
            className="progress-bar skeleton-box"
            style={{ height: "12px" }}
          ></div>
          <div className="progress-stats" style={{ marginTop: "8px" }}>
            <div
              className="skeleton-box"
              style={{ width: "30%", height: "16px" }}
            ></div>
            <div
              className="skeleton-box"
              style={{ width: "30%", height: "16px" }}
            ></div>
          </div>
        </div>
        <div className="ca-card-donation-box" style={{ marginTop: "16px" }}>
          <div
            className="skeleton-box"
            style={{ width: "100%", height: "60px" }}
          ></div>
        </div>
        <div
          className="skeleton-box"
          style={{ width: "100%", height: "40px", marginTop: "16px" }}
        ></div>
        <div
          className="skeleton-box"
          style={{ width: "60%", height: "20px", marginTop: "8px" }}
        ></div>
      </div>
    </div>
  </div>
);

// Small Campaign Card Skeleton
export const SmallCardSkeleton = () => (
  <div className="campaign-card skeleton-container">
    <div
      className="skeleton-box"
      style={{ width: "100%", height: "150px" }}
    ></div>
    <div style={{ padding: "12px" }}>
      <div
        className="skeleton-box"
        style={{ width: "70%", height: "20px", marginBottom: "8px" }}
      ></div>
      <div
        className="skeleton-box"
        style={{ width: "100%", height: "12px", marginBottom: "4px" }}
      ></div>
      <div
        className="skeleton-box"
        style={{ width: "90%", height: "12px", marginBottom: "8px" }}
      ></div>
      <div
        className="skeleton-box"
        style={{ width: "100%", height: "8px", marginBottom: "4px" }}
      ></div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: "8px",
        }}
      >
        <div
          className="skeleton-box"
          style={{ width: "40%", height: "16px" }}
        ></div>
        <div
          className="skeleton-box"
          style={{ width: "40%", height: "16px" }}
        ></div>
      </div>
    </div>
  </div>
);

// Multiple Small Cards Skeleton
export const SmallCardSkeletonGrid = ({ count = 8 }) => (
  <div className="campaigns-grid" style={{ gap: "20px" }}>
    {new Array(count).fill(0).map((_, i) => (
      <SmallCardSkeleton key={i} />
    ))}
  </div>
);

// Transaction History Skeleton
const TransactionSkeletonRow = () => (
  <div
    style={{ display: "flex", padding: "12px", borderBottom: "1px solid #eee" }}
  >
    <div
      className="skeleton-box"
      style={{ width: "20%", height: "24px", marginRight: "16px" }}
    ></div>
    <div
      className="skeleton-box"
      style={{ width: "30%", height: "24px", marginRight: "16px" }}
    ></div>
    <div
      className="skeleton-box"
      style={{ width: "20%", height: "24px", marginRight: "16px" }}
    ></div>
    <div
      className="skeleton-box"
      style={{ width: "20%", height: "24px" }}
    ></div>
  </div>
);

export const TransactionHistorySkeleton = ({ rows = 5 }) => (
  <div style={{ width: "100%" }}>
    {new Array(rows).fill(0).map((_, i) => (
      <TransactionSkeletonRow key={i} />
    ))}
  </div>
);

// Spinner Component
export const Spinner = () => (
  <div className="spinner-container">
    <div className="spinner"></div>
  </div>
);

SmallCardSkeletonGrid.propTypes = {
  count: PropTypes.number,
};

TransactionHistorySkeleton.propTypes = {
  rows: PropTypes.number,
};

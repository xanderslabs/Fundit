import PropTypes from "prop-types";
import { explorers } from "../data/data";

const TransactionHistorySection = ({ transactions }) => {
  const formatDate = (dateString) => {
    const date = new Date(dateString);

    // Get date parts
    const month = date.toLocaleString("en-US", { month: "short" });
    const day = date.getUTCDate();
    const year = date.getUTCFullYear();

    // Get time parts
    let hours = date.getUTCHours();
    const minutes = date.getUTCMinutes().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";

    // Convert hours to 12-hour format
    hours %= 12;
    hours = hours ? hours : 12; // If hours is 0, make it 12

    // Format as "Feb 25, 2025. 05:31 AM UTC"
    return `${month} ${day}, ${year}. ${hours}:${minutes} ${ampm} UTC`;
  };

  return (
    <div className="transaction-content">
      <div className="transaction-list" id="txhistorybody">
        {transactions.map((tx, index) => (
          <a
            key={index}
            className="transaction-row"
            href={(explorers[tx.chain.toLowerCase()] || "#") + tx.txhash}
            target="_blank"
            rel="noopener noreferrer"
          >
            <div className="tx-info">
              <div className="tx-title">{tx.type}</div>
              <div className="tx-datetime">{formatDate(tx.date)}</div>
            </div>
            <div className="tx-amount-status">
              <div className="tx-amount">${tx.amount || 0}</div>
              <div className={`tx-status ${tx.status.toLowerCase()}`}>
                {tx.status}
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
};

TransactionHistorySection.propTypes = {
  transactions: PropTypes.array.isRequired,
};

export default TransactionHistorySection;

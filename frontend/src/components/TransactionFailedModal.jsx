import PropTypes from "prop-types";
import Modal from "./Modal.jsx";

function TransactionFailedModal({ visible, onClose }) {
  return (
    <Modal visible={visible} onClose={onClose}>
      <div className="modal-l1"></div>
      <div className="transaction-status-icon">
        <svg
          width="100"
          height="100"
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect width="100" height="100" rx="50" fill="#FFEBEA" />
          <path
            d="M49.9997 79.1666C33.8909 79.1666 20.833 66.1087 20.833 49.9999C20.833 33.8912 33.8909 20.8333 49.9997 20.8333C66.1084 20.8333 79.1663 33.8912 79.1663 49.9999C79.1663 66.1087 66.1084 79.1666 49.9997 79.1666ZM49.9997 45.8758L41.7513 37.6245L37.6243 41.7516L45.8755 49.9999L37.6243 58.2482L41.7513 62.3753L49.9997 54.1241L58.248 62.3753L62.3751 58.2482L54.1238 49.9999L62.3751 41.7516L58.248 37.6245L49.9997 45.8758Z"
            fill="#FF3B30"
          />
        </svg>
      </div>
      <h2 className="transaction-status">Transaction Failed</h2>
      <div className="a-button-1 btn-explorer" onClick={onClose}>
        Done
      </div>
    </Modal>
  );
}

TransactionFailedModal.propTypes = {
  visible: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};

export default TransactionFailedModal;

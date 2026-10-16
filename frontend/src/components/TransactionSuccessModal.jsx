import PropTypes from "prop-types";
import Modal from "./Modal.jsx";

function TransactionSuccessModal({ visible, onClose }) {
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
          <rect width="100" height="100" rx="50" fill="#E8F8E9" />
          <path
            d="M44.5462 20.4369C40.3593 19.0815 35.8078 20.9668 33.8056 24.8858L31.3984 29.5973C31.1124 30.1571 30.6571 30.6124 30.0973 30.8984L25.3858 33.3056C21.4668 35.3078 19.5815 39.8593 20.9369 44.0462L22.5663 49.0798C22.7599 49.6779 22.7599 50.3219 22.5663 50.92L20.9369 55.9536C19.5815 60.1406 21.4668 64.692 25.3858 66.6944L30.0973 69.1013C30.6571 69.3875 31.1124 69.8427 31.3984 70.4026L33.8056 75.1141C35.8078 79.0332 40.3593 80.9185 44.5462 79.5631L49.5798 77.9336C50.1779 77.74 50.8219 77.74 51.42 77.9336L56.4536 79.5631C60.6406 80.9185 65.192 79.0332 67.1944 75.1141L69.6013 70.4026C69.8875 69.8427 70.3427 69.3875 70.9026 69.1013L75.6141 66.6944C79.5332 64.692 81.4185 60.1406 80.0631 55.9536L78.4336 50.92C78.24 50.3219 78.24 49.6779 78.4336 49.0798L80.0631 44.0462C81.4185 39.8593 79.5332 35.3078 75.6141 33.3056L70.9026 30.8984C70.3427 30.6124 69.8875 30.1571 69.6013 29.5973L67.1944 24.8858C65.192 20.9668 60.6406 19.0815 56.4536 20.4369L51.42 22.0663C50.8219 22.2599 50.1779 22.2599 49.5798 22.0663L44.5462 20.4369ZM34.8458 49.2749L39.0705 45.0499L47.5198 53.4995L64.4186 36.6008L68.6433 40.8255L47.5198 61.9488L34.8458 49.2749Z"
            fill="#19B820"
          />
        </svg>
      </div>
      <h2 className="transaction-status">Transaction Successful</h2>
      <div className="a-button-1 btn-explorer" onClick={onClose}>
        Done
      </div>
    </Modal>
  );
}

TransactionSuccessModal.propTypes = {
  visible: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};

export default TransactionSuccessModal;

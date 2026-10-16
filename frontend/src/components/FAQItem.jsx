// FAQItem.jsx
import PropTypes from "prop-types";

const FAQItem = ({ question, answer, isOpen, onToggle }) => (
  <div className={`faq-item ${isOpen ? "active" : ""}`} onClick={onToggle}>
    <div className={`faq-question ${isOpen ? "active" : ""}`}>
      {question}
      <span className="toggle-icon">{isOpen ? "-" : "+"}</span>
    </div>
    {isOpen && <div className="faq-answer active">{answer}</div>}
  </div>
);

FAQItem.propTypes = {
  question: PropTypes.string.isRequired,
  answer: PropTypes.string.isRequired,
  isOpen: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
};

export default FAQItem;

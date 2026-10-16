import { Link } from "react-router-dom";
import { useState } from "react";
import FAQItem from "./FAQItem.jsx";

function HomeFAQ() {
  // Five most important FAQs for homepage display
  const faqs = [
    {
      question: "What is fundit.fun?",
      answer:
        "fundit.fun is a decentralized crowdfunding platform that leverages blockchain technology to provide a transparent, secure, and rewarding experience for campaign creators and donors. It integrates Web3 features like smart contracts.",
    },
    {
      question:
        "How is fundit.fun different from traditional crowdfunding platforms?",
      answer:
        "Unlike traditional platforms, fundit.fun uses blockchain to ensure transparency, reduce fees, and eliminate geographical restrictions.",
    },
    {
      question: "Do I need a crypto wallet to use fundit.fun?",
      answer:
        "Yes, you'll need a Web3 wallet (like MetaMask, Trust Wallet, or Coinbase Wallet) to interact with fundit.fun. This allows you to connect to the blockchain, make secure donations, and receive FUN Tokens. We have simple guides to help first-time crypto users get set up.",
    },
    {
      question: "How are funds managed during a campaign?",
      answer:
        "Funds are held in smart contracts until the campaign reaches its goal or ends. This ensures transparency and security for both creators and donors.",
    },
  ];

  const [openIndex, setOpenIndex] = useState(0);

  const handleToggle = (index) => {
    // If the clicked item is already open, close it; otherwise, open the clicked one.
    setOpenIndex((previousIndex) => (previousIndex === index ? null : index));
  };

  return (
    <div className="faq-section" id="faq">
      <div className="faq-header">
        <span className="faq-label">FAQ</span>
        <h1>Have questions? We&#39;re here to help</h1>
      </div>
      <div className="faq-items">
        {faqs.map((faq, index) => (
          <FAQItem
            key={index}
            question={faq.question}
            answer={faq.answer}
            isOpen={openIndex === index}
            onToggle={() => handleToggle(index)}
          />
        ))}
      </div>
      <div className="faq-seemore">
        <Link to="/faq" className="sm-btn">
          <span>See More</span>
          <svg
            width="17"
            height="17"
            viewBox="0 0 17 17"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <g clipPath="url(#clip0_2358_325)">
              <path
                d="M11.1694 7.15588L5.43144 12.8939L4.48877 11.9512L10.2261 6.21322H5.16944V4.87988H12.5028V12.2132H11.1694V7.15588V7.15588Z"
                fill="#101928"
              />
            </g>
            <defs>
              <clipPath id="clip0_2358_325">
                <rect
                  width="16"
                  height="16"
                  fill="white"
                  transform="translate(0.5 0.879883)"
                />
              </clipPath>
            </defs>
          </svg>
        </Link>
      </div>
    </div>
  );
}

export default HomeFAQ;

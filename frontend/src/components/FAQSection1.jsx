import { useState } from "react";
import FAQItem from "./FAQItem.jsx";

function FAQSection1() {
  // First category: General Questions & Getting Started
  const faqs1 = [
    {
      question: "What is fundit.fun?",
      answer:
        "fundit.fun is a decentralized crowdfunding platform that leverages blockchain technology to provide a transparent and secure experience for campaign creators and donors. It integrates Web3 features like smart contracts.",
    },
    {
      question:
        "How is fundit.fun different from traditional crowdfunding platforms?",
      answer:
        "Unlike traditional platforms, fundit.fun uses blockchain to ensure transparency, reduce fees, and eliminate geographical restrictions.",
    },
    {
      question: "Who can use fundit.fun?",
      answer:
        "Anyone can use fundit.fun! Whether you're an entrepreneur, artist, nonprofit, or individual with a creative idea, you can create a campaign. ",
    },
    {
      question: "Do I need a crypto wallet to use fundit.fun?",
      answer:
        "Yes, you'll need a Web3 wallet (like MetaMask, Trust Wallet, or Coinbase Wallet) to interact with fundit.fun. This allows you to connect to the blockchain, make secure donations, and receive FUN Tokens. We have simple guides to help first-time crypto users get set up.",
    },
    {
      question: "What blockchain networks does fundit.fun support?",
      answer:
        "fundit.fun primarily operates on Polygon for its low fees and environmental efficiency, but also supports Ethereum, Arbitrum, Base, and other major EVM-compatible networks. This multi-chain approach offers flexibility while maintaining security and interoperability.",
    },
  ];

  // Second category: Creating Campaigns
  const faqs2 = [
    {
      question: "How do I create a campaign on fundit.fun?",
      answer:
        "To create a campaign, sign up on the platform, provide details like your campaign name, target amount, and purpose, and submit it. Once approved, you can start raising funds.",
    },
    {
      question: "What types of campaigns can I create?",
      answer:
        "You can create campaigns for charitable causes, personal reasons, entrepreneurial ventures, creative projects, community initiatives, and more. All campaigns must comply with fundit.fun's guidelines.",
    },
    {
      question: "Are there any fees for creating or funding campaigns?",
      answer:
        "fundit.fun charges no fees for creating a campaign and a small fee (1.4%) on campaigns deposits and withdrawals, which is lower than most traditional platforms.",
    },
    {
      question: "Can I edit my campaign after it launches?",
      answer:
        "Yes, you can edit certain aspects of your campaign after launch, including the description, images, and updates.",
    },
    {
      question: "Is there a time limit for campaigns?",
      answer:
        "They are no time limits for a campaign , it would be manually ended by its creator.",
    },
    {
      question: "Can I create private/invite-only campaigns?",
      answer:
        "Currently, all campaigns on fundit.fun are public. However, we're developing a private campaign feature for projects that require a more targeted audience, coming soon to the platform.",
    },
  ];

  // Third category: Funding & Donations
  const faqs3 = [
    {
      question: "What cryptocurrencies can I use to donate?",
      answer:
        "You can donate using USDC, USDT, Native Coins or other supported cryptocurrencies.",
    },
    {
      question: "How are funds managed during a campaign?",
      answer:
        "Funds are held in smart contracts until the campaign reaches its goal or ends. This ensures transparency and security for both creators and donors.",
    },
    {
      question: "How does fundit.fun ensure the security of my funds?",
      answer:
        "fundit.fun uses audited smart contracts to handle all transactions, with funds held in escrow until campaign completion. Our platform undergoes regular security audits, and we implement multi-signature wallets for critical operations to prevent unauthorized access.",
    },
    {
      question: "What happens if a campaign turns out to be fraudulent?",
      answer:
        "We have an active customer service and dispute resolution system that allows donors to flag suspicious campaigns. If fraud is confirmed, funds are returned to donors, and the campaign is blacklisted by the platform.",
    },
    {
      question: "How can I withdraw funds after my campaign succeeds?",
      answer:
        "Once your campaign successfully ends, you can withdraw funds to your connected wallet through our dashboard. Funds are typically available within 24-48 hours after campaign completion and withdrawal request, following a brief security review.",
    },
  ];

  const [openIndex, setOpenIndex] = useState(0);

  const handleToggle = (index) => {
    // If the clicked item is already open, close it; otherwise, open the clicked one.
    setOpenIndex((previousIndex) => (previousIndex === index ? null : index));
  };

  return (
    <div className="faq-section fps" id="faq">
      <span className="fps-header">General Questions & Getting Started</span>
      <div className="faq-items">
        {faqs1.map((faq, index) => (
          <FAQItem
            key={index}
            question={faq.question}
            answer={faq.answer}
            isOpen={openIndex === index}
            onToggle={() => handleToggle(index)}
          />
        ))}
      </div>

      <span className="fps-header">Creating Campaigns</span>
      <div className="faq-items">
        {faqs2.map((faq, index) => {
          // Calculate a global index
          const globalIndex = faqs1.length + index;
          return (
            <FAQItem
              key={globalIndex}
              question={faq.question}
              answer={faq.answer}
              isOpen={openIndex === globalIndex}
              onToggle={() => handleToggle(globalIndex)}
            />
          );
        })}
      </div>

      <span className="fps-header">Funding & Donations</span>
      <div className="faq-items">
        {faqs3.map((faq, index) => {
          // Calculate a global index
          const globalIndex = faqs1.length + faqs2.length + index;
          return (
            <FAQItem
              key={globalIndex}
              question={faq.question}
              answer={faq.answer}
              isOpen={openIndex === globalIndex}
              onToggle={() => handleToggle(globalIndex)}
            />
          );
        })}
      </div>
    </div>
  );
}

export default FAQSection1;

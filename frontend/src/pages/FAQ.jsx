import Header from "../components/Header";
import Footer from "../components/Footer";
import HeaderSpacer from "../components/HeaderSpace";
import FAQHeaderMain from "../components/FAQHeaderMain";
import FAQSection1 from "../components/FAQSection1";

function FAQ() {
  return (
    <div className="body">
      <Header />
      <HeaderSpacer />
      <FAQHeaderMain />
      <FAQSection1 />
      <Footer />
    </div>
  );
}

export default FAQ;

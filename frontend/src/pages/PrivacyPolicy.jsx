import Header from "../components/Header";
import HeaderSpacer from "../components/HeaderSpace";
import Footer from "../components/Footer";

function PrivacyPolicy() {
  return (
    <div className="body">
      <Header />
      <HeaderSpacer />
      <div className="policy-page">
        <div className="policy-container">
          <h1>Privacy Policy</h1>
          <p className="last-updated">
            Last updated: {new Date().toLocaleDateString()}
          </p>

          <section>
            <h2>1. Introduction</h2>
            <p>
              Welcome to Fundit. We respect your privacy and are committed to
              protecting your personal data. This privacy policy will inform you
              about how we handle your personal data when you visit our website
              and tell you about your privacy rights.
            </p>
          </section>

          <section>
            <h2>2. Data We Collect</h2>
            <p>We collect and process the following types of personal data:</p>
            <ul>
              <li>Wallet addresses</li>
              <li>Transaction history on our platform</li>
              <li>Campaign creation and interaction data</li>
              <li>Technical data (including IP address, browser type, etc.)</li>
              <li>Usage data (how you interact with our platform)</li>
            </ul>
          </section>

          <section>
            <h2>3. How We Use Your Data</h2>
            <p>We use your personal data for the following purposes:</p>
            <ul>
              <li>To provide and maintain our service</li>
              <li>To process your transactions</li>
              <li>To prevent fraud and ensure platform security</li>
              <li>To improve our platform and user experience</li>
              <li>To communicate with you about your campaigns or donations</li>
            </ul>
          </section>

          <section>
            <h2>4. Blockchain Data</h2>
            <p>
              Please note that blockchain transactions are public by nature.
              While we protect your personal data on our platform, any data you
              submit to the blockchain will be publicly accessible.
            </p>
          </section>

          <section>
            <h2>5. Your Rights</h2>
            <p>
              Under applicable data protection laws, you have the following
              rights:
            </p>
            <ul>
              <li>Right to access your personal data</li>
              <li>Right to correct inaccurate data</li>
              <li>Right to request deletion of your data</li>
              <li>Right to restrict processing</li>
              <li>Right to data portability</li>
            </ul>
          </section>

          <section>
            <h2>6. Security</h2>
            <p>
              We implement appropriate technical and organizational measures to
              protect your personal data. However, please note that no method of
              transmission over the internet is 100% secure.
            </p>
          </section>

          <section>
            <h2>7. Contact Us</h2>
            <p>
              For any questions about this privacy policy or our privacy
              practices, please contact us at mail@fundit.fun
            </p>
          </section>
        </div>
      </div>
      <Footer />
    </div>
  );
}

export default PrivacyPolicy;

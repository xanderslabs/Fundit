import Header from "../components/Header";
import HeaderSpacer from "../components/HeaderSpace";
import Footer from "../components/Footer";

function TermsOfService() {
  return (
    <div className="body">
      <Header />
      <HeaderSpacer />
      <div className="policy-page">
        <div className="policy-container">
          <h1>Terms of Service</h1>
          <p className="last-updated">
            Last updated: {new Date().toLocaleDateString()}
          </p>

          <section>
            <h2>1. Agreement to Terms</h2>
            <p>
              By accessing or using Fundit, you agree to be bound by these Terms
              of Service and all applicable laws and regulations. If you do not
              agree with any of these terms, you are prohibited from using or
              accessing this site.
            </p>
          </section>

          <section>
            <h2>2. Use of Service</h2>
            <h3>2.1 Eligibility</h3>
            <p>
              You must be at least 18 years old and capable of forming a binding
              contract to use our services. By using Fundit, you represent and
              warrant that you meet these requirements.
            </p>

            <h3>2.2 Account Registration</h3>
            <p>
              To use certain features of the platform, you need to connect a
              Web3 wallet. You are responsible for maintaining the security of
              your wallet and all activities that occur through it.
            </p>
          </section>

          <section>
            <h2>3. Fundraising Campaigns</h2>
            <h3>3.1 Campaign Creation</h3>
            <p>When creating a campaign, you agree to:</p>
            <ul>
              <li>Provide accurate and truthful information</li>
              <li>Use funds for the stated purpose</li>
              <li>Comply with all applicable laws and regulations</li>
              <li>Not engage in fraudulent or misleading practices</li>
            </ul>

            <h3>3.2 Campaign Donations</h3>
            <p>When making donations, you acknowledge that:</p>
            <ul>
              <li>Transactions on the blockchain are irreversible</li>
              <li>You are responsible for any transaction fees</li>
              <li>The value of cryptocurrencies can be volatile</li>
            </ul>
          </section>

          <section>
            <h2>4. Intellectual Property</h2>
            <p>
              The content, features, and functionality of Fundit are owned by us
              and are protected by international copyright, trademark, and other
              intellectual property laws.
            </p>
          </section>

          <section>
            <h2>5. Limitation of Liability</h2>
            <p>
              We shall not be liable for any indirect, incidental, special,
              consequential, or punitive damages resulting from your use of our
              services. This includes, but is not limited to:
            </p>
            <ul>
              <li>Loss of profits, data, or other intangibles</li>
              <li>Smart contract vulnerabilities or failures</li>
              <li>Blockchain network issues</li>
              <li>Wallet connection problems</li>
            </ul>
          </section>

          <section>
            <h2>6. Changes to Terms</h2>
            <p>
              We reserve the right to modify these terms at any time. We will
              notify users of any material changes via email or through our
              platform.
            </p>
          </section>

          <section>
            <h2>7. Governing Law</h2>
            <p>
              These terms shall be governed by and construed in accordance with
              the laws , without regard to its conflict of law provisions.
            </p>
          </section>

          <section>
            <h2>8. Contact Information</h2>
            <p>
              For any questions about these Terms of Service, please contact us
              at mail@fundit.fun
            </p>
          </section>
        </div>
      </div>
      <Footer />
    </div>
  );
}

export default TermsOfService;

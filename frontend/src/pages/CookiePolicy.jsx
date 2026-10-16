import Header from "../components/Header";
import HeaderSpacer from "../components/HeaderSpace";
import Footer from "../components/Footer";

function CookiePolicy() {
  return (
    <div className="body">
      <Header />
      <HeaderSpacer />
      <div className="policy-page">
        <div className="policy-container">
          <h1>Cookie Policy</h1>
          <p className="last-updated">
            Last updated: {new Date().toLocaleDateString()}
          </p>

          <section>
            <h2>1. What are cookies?</h2>
            <p>
              Cookies are small text files that are stored on your computer or
              mobile device when you visit our website. They help us make the
              site work better and improve our service.
            </p>
          </section>

          <section>
            <h2>2. How we use cookies</h2>
            <p>We use cookies for the following purposes:</p>
            <ul>
              <li>
                Essential cookies: Required for the website to function properly
              </li>
              <li>
                Analytics cookies: To understand how visitors interact with our
                website
              </li>
              <li>Functionality cookies: To remember your preferences</li>
              <li>
                Web3 cookies: To maintain your wallet connection and preferences
              </li>
            </ul>
          </section>

          <section>
            <h2>3. Types of cookies we use</h2>
            <h3>Essential Cookies</h3>
            <p>
              These cookies are necessary for the website to function and cannot
              be switched off. They include:
            </p>
            <ul>
              <li>Session management</li>
              <li>Security features</li>
              <li>Basic functionality</li>
            </ul>

            <h3>Web3 Specific Cookies</h3>
            <p>These cookies help manage your blockchain interactions:</p>
            <ul>
              <li>Wallet connection status</li>
              <li>Network preferences</li>
              <li>Transaction history</li>
            </ul>
          </section>

          <section>
            <h2>4. Managing cookies</h2>
            <p>
              You can control and/or delete cookies as you wish. You can delete
              all cookies that are already on your computer and you can set most
              browsers to prevent them from being placed.
            </p>
          </section>

          <section>
            <h2>5. Contact us</h2>
            <p>
              If you have any questions about our use of cookies, please contact
              us at mail@fundit.fun
            </p>
          </section>
        </div>
      </div>
      <Footer />
    </div>
  );
}

export default CookiePolicy;

import { Link } from 'react-router'

export function Privacy() {
  return (
    <article className="legal">
      <p className="legal-draft" role="note">
        <strong>Draft: review before launch.</strong> This text has not had a legal review yet.
      </p>
      <h1>Privacy Policy</h1>

      <h2>1. Introduction</h2>
      <p>
        This policy explains what data Fundit uses and where it goes. Fundit has no accounts, no sign-up form and no
        server of its own that stores your data. The website runs in your browser and reads public blockchains.
      </p>

      <h2>2. Data on the blockchain</h2>
      <p>
        When you start a fundraiser or donate, your transaction is recorded on the Arc blockchain, and on other chains
        if you use a cross-chain transfer. This record is public and permanent. It includes:
      </p>
      <ul>
        <li>Your wallet address.</li>
        <li>The amounts you send, receive or withdraw.</li>
        <li>Anything you write into a fundraiser, such as its title, description, image link and links.</li>
        <li>Any message you add to a donation.</li>
      </ul>
      <p>
        We cannot change or delete data on a blockchain, and neither can anyone else. Do not put personal information in
        a fundraiser or a message unless you are happy for it to be public forever.
      </p>

      <h2>3. Data stored in your browser</h2>
      <p>Fundit sets no cookies. It uses your browser's local storage only for:</p>
      <ul>
        <li>Reminders of transactions you started that have not finished yet, so the page can check on them.</li>
        <li>Your passkey wallet session, if you use a passkey wallet.</li>
        <li>
          Your wallet connection, which the wallet connection tools (wagmi, Reown and WalletConnect) save so you stay
          connected after a reload.
        </li>
      </ul>
      <p>This data stays on your device. You can remove it at any time by clearing your browser's site data.</p>

      <h2>4. Names and avatars</h2>
      <p>
        Fundit shows ENS names and Basenames instead of addresses where they exist. To do this, your browser asks a
        public Ethereum RPC provider for the name and avatar linked to each address on the page. Avatar images load
        from wherever their owner stored them.
      </p>

      <h2>5. Third parties</h2>
      <p>
        Your browser talks directly to these services. Each one can see your IP address and the requests your browser
        makes, under its own privacy policy:
      </p>
      <ul>
        <li>Public RPC providers for Arc, Ethereum and the other supported chains, to read and send transactions.</li>
        <li>Circle, for cross-chain transfers (CCTP), unified balances (Gateway) and passkey wallets.</li>
        <li>Reown and WalletConnect, to connect your wallet.</li>
        <li>The sites that host fundraiser images and avatars.</li>
      </ul>
      <p>Fundit does not use analytics or advertising trackers.</p>

      <h2>6. Your rights</h2>
      <p>
        Depending on where you live, you may have rights to access, correct or delete personal data, to restrict its
        use, and to move it. Fundit holds no personal data on its own servers, so most requests are best sent to the
        third parties above. Data on a blockchain cannot be corrected or deleted by anyone.
      </p>

      <h2>7. Security</h2>
      <p>
        No website or network is fully secure. Keep your wallet and devices safe, and check every transaction in your
        wallet before you approve it.
      </p>

      <h2>8. Changes to this policy</h2>
      <p>We may update this policy. We will post the new version on this page.</p>

      <h2>9. Contact</h2>
      <p>
        Questions about privacy: mail@fundit.fun. See also our <Link to="/terms">Terms of Service</Link>.
      </p>
    </article>
  )
}

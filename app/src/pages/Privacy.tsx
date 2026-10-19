import { Link } from 'react-router'
import './Legal.css'

export function Privacy() {
  return (
    <article className="legal">
      <p className="legal-draft" role="note">
        <strong>Draft: review before launch.</strong> This text has not had a legal review yet.
      </p>
      <h1>Privacy Policy</h1>
      <p>A Fundit is a fundraiser created on Fundit.</p>

      <h2>1. Introduction</h2>
      <p>
        This policy explains what data Fundit uses and where it goes. Fundit has no server of its own that stores your
        data. You sign in with a Fundit account: a smart account on the Arc blockchain, secured by a passkey on your
        device. The website runs in your browser and reads public blockchains.
      </p>

      <h2>2. Data on the blockchain</h2>
      <p>
        When you start a fundraiser or donate, your transaction is recorded on the Arc blockchain, and on other chains
        if you use a cross-chain transfer. This record is public and permanent. It includes:
      </p>
      <ul>
        <li>Your Fundit account address.</li>
        <li>The amounts you add, send, receive or withdraw.</li>
        <li>Anything you write into a fundraiser, such as its title, description, image link and links.</li>
        <li>Any message you add to a donation.</li>
        <li>
          The public keys of your passkeys and the address of your recovery key, which are listed as owners of your
          Fundit account.
        </li>
      </ul>
      <p>
        If you switch on "Hide my name", Fundit does not show your name next to the gift on its own pages. The gift is
        still public on the blockchain, with your account address, the amount and any message.
      </p>
      <p>
        We cannot change or delete data on a blockchain, and neither can anyone else. Do not put personal information in
        a fundraiser or a message unless you are happy for it to be public forever.
      </p>

      <h2>3. Data stored in your browser</h2>
      <p>Fundit sets no cookies. It uses your browser's local storage only for:</p>
      <ul>
        <li>
          Reminders of transfers, recovery key backups and account recoveries you started that have not finished yet,
          so the page can check on them. A recovery in progress also keeps the new passkey's credential ID and public
          key.
        </li>
        <li>
          Your Fundit account session: your account address and your passkey's credential ID. It never holds a private
          key or the words of your recovery key.
        </li>
        <li>A note that you saved a recovery key for your account, so Fundit does not ask you again.</li>
        <li>
          Your wallet connection, only if you connect a wallet to add money. The wallet connection tools (wagmi, Reown
          and WalletConnect) save it so you stay connected after a reload.
        </li>
      </ul>
      <p>This data stays on your device. You can remove it at any time by clearing your browser's site data.</p>
      <p>
        Your passkey is kept by your device or password manager, not by Fundit. Your recovery key stays in your
        browser while you save or use it. Fundit never stores it and never sends it anywhere.
      </p>

      <h2>4. Names and avatars</h2>
      <p>
        Fundit shows ENS names and Basenames instead of addresses where they exist. To do this, your browser asks a
        public Ethereum RPC provider and a public Base RPC provider for the name and avatar linked to each address on
        the page. An avatar is shown only when it is a plain https link, and the image loads from wherever its owner
        stored it.
      </p>

      <h2>5. Third parties</h2>
      <p>
        Your browser talks directly to these services. Each one can see your IP address and the requests your browser
        makes, under its own privacy policy:
      </p>
      <ul>
        <li>Public RPC providers for Arc, Ethereum and the other supported chains, to read and send transactions.</li>
        <li>
          Circle, for your Fundit account and passkeys (Modular Wallets and its bundler), and for cross-chain transfers
          (CCTP, Bridge Kit and the Forwarding Service).
        </li>
        <li>Reown and WalletConnect, only when you connect a wallet to add money.</li>
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
        No website or network is fully secure. Keep your devices, passkeys and recovery key safe, and check every
        transaction before you confirm it with your passkey. If you connect a wallet to add money, check each
        transaction in that wallet too.
      </p>

      <h2>8. Changes to this policy</h2>
      <p>We may update this policy. We will post the new version on this page.</p>

      <h2>9. Contact</h2>
      <p>
        Questions about privacy: hello@fundit.fun. See also our <Link to="/terms">Terms of Service</Link>.
      </p>
    </article>
  )
}

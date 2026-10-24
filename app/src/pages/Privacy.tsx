import { Link } from 'react-router'
import './Legal.css'

export function Privacy() {
  return (
    <article className="legal">
      <h1>Privacy Policy</h1>
      <p>A Fundit is a fundraiser created on Fundit.</p>

      <h2>1. Introduction</h2>
      <p>
        This policy explains what data Fundit uses and where it goes. Fundit has no database of its own. You sign in
        with a Fundit account, in one of two ways: with your email address or with your own wallet.
        The website runs in your browser and reads public blockchains. A small Fundit server also serves the site's
        pages. For email accounts it handles sign-in, keeps your session, and passes each transaction you approve to
        Circle for signing, as sections 3 and 5 describe.
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
      <p>
        Fundit sets cookies only if you sign in with email (described below). It also uses your browser's local
        storage, only for:
      </p>
      <ul>
        <li>
          Reminders of transfers you started that have not finished yet, so the page can check on them.
        </li>
        <li>
          Your Fundit account session. For an email account, it is your account address, your Circle wallet ID and
          your email address, which the account menu shows. For a wallet account, it is your wallet address and the
          type of wallet. It never holds a private key.
        </li>
        <li>
          Your wallet connection, if you sign in with a wallet. The wallet connection tools
          (wagmi and WalletConnect) save it so you stay connected after a reload.
        </li>
      </ul>
      <p>This data stays on your device. You can remove it at any time by clearing your browser's site data.</p>
      <p>
        If you sign in with email, Fundit's server sets two cookies on fundit.fun. They hold your Circle login tokens.
        They are HttpOnly, so page scripts cannot read them, and they last up to 14 days after your last visit. Your
        browser tab also keeps a Circle user token and encryption key in its session storage until you close the tab.
        Fundit's server never signs for you. Each transaction goes out only after you approve it in Circle's window.
        Signing out asks the server to clear the cookies and clears the session storage. If the server cannot be
        reached, the cookies expire on their own.
      </p>
      <p>
        Your wallet keeps the keys of a wallet account. Circle keeps part of the keys of an email account, and a transaction needs your
        approval too.
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
          Circle, for email accounts (user-controlled wallets) and for cross-chain transfers (CCTP, Bridge Kit and the Forwarding Service).
        </li>
        <li>WalletConnect, only when you sign in with a phone wallet.</li>
        <li>The sites that host fundraiser images and avatars.</li>
      </ul>
      <p>
        Email sign-in also uses these. Your browser sends your email address to Fundit's server, which is a
        Cloudflare Worker. The server passes it to Circle to send you a code, and does not store it. Circle keeps your email address as
        the login for your email account, so it can recognise you when you return. Circle sends the code through
        Resend, which handles your email address to deliver it. Cloudflare Turnstile checks your browser
        before a code is sent, and sees your IP address and browser details. Each one works under its own privacy
        policy.
      </p>
      <p>Fundit does not use analytics or advertising trackers.</p>

      <h2>6. Your rights</h2>
      <p>
        Depending on where you live, you may have rights to access, correct or delete personal data, to restrict its
        use, and to move it. Fundit stores no personal data on its own servers, so most requests are best sent to the
        third parties above. Data on a blockchain cannot be corrected or deleted by anyone.
      </p>

      <h2>7. Security</h2>
      <p>
        No website or network is fully secure. Keep your devices, email address and wallet safe, and check every
        transaction before you confirm it in Circle's window or in your wallet.
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

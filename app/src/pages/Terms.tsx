import { Link } from 'react-router'

export function Terms() {
  return (
    <article className="legal">
      <p className="legal-draft" role="note">
        <strong>Draft: review before launch.</strong> This text has not had a legal review yet.
      </p>
      <h1>Terms of Service</h1>
      <p>A Fundit is a fundraiser created on Fundit.</p>

      <h2>1. Agreement to these terms</h2>
      <p>
        By using Fundit you agree to these terms and to the laws that apply to you. If you do not agree, do not use
        Fundit.
      </p>

      <h2>2. What Fundit is</h2>
      <p>
        Fundit is a website for raising money in USDC or EURC on the Arc blockchain. Each fundraiser is its own smart
        contract, created by the Fundit factory contract. Donations go straight into that contract. Fundit is
        non-custodial: we never hold your money and we have no deposit wallets. Money in your Fundit account is held by
        that account on Arc, and only your passkeys or your recovery key can move it.
      </p>
      <ul>
        <li>Only the organiser of a fundraiser can withdraw its money.</li>
        <li>The Fundit team cannot move, freeze or take back money held by a fundraiser.</li>
        <li>Fundit accepts USDC and EURC only. Each fundraiser uses one of the two, chosen when it is created.</li>
        <li>Everything Fundit shows is read from public blockchains.</li>
      </ul>

      <h2>3. Using Fundit</h2>
      <h3>3.1 Eligibility</h3>
      <p>
        You must be at least 18 years old and able to enter a binding contract. By using Fundit you confirm that you
        meet these requirements.
      </p>
      <h3>3.2 Your Fundit account</h3>
      <p>
        To start a fundraiser or donate you sign in with a Fundit account. It is a Circle Modular Wallets smart account
        on Arc, secured by a passkey such as Face ID, Touch ID, Windows Hello or your phone. You cannot sign in with a
        wallet.
      </p>
      <p>
        You can save a 12-word recovery key. It is added to your account as a second owner. With the recovery key and
        a new passkey you can recover your account at <Link to="/recover">/recover</Link>. Fundit never sees your
        recovery key: it stays in your browser.
      </p>
      <p>
        You are responsible for keeping your devices, passkeys and recovery key safe. If you lose every passkey and
        your recovery key, nobody can recover your account, including Fundit and Circle. We cannot reverse a
        transaction.
      </p>
      <h3>3.3 Adding and sending money</h3>
      <p>
        You add money to your Fundit account by sending USDC or EURC on Arc to its address, from a wallet you connect,
        or from another chain through Circle's Cross-Chain Transfer Protocol (CCTP) where Fundit offers it. You connect
        a wallet only to add money. You can send money out on Arc, or send USDC to another supported chain through
        CCTP. EURC moves on Arc only.
      </p>

      <h2>4. Fundraisers</h2>
      <h3>4.1 Starting a fundraiser</h3>
      <p>When you start a fundraiser, you agree to:</p>
      <ul>
        <li>Give accurate and truthful information.</li>
        <li>Use the money for the purpose you describe.</li>
        <li>Follow the laws that apply to you and to your fundraiser.</li>
        <li>Not mislead or defraud donors.</li>
      </ul>
      <p>
        You can name a backup address. If you do, that address can ask to take over the fundraiser, and it can do so
        after 7 days unless you cancel the request. Choose a backup you trust.
      </p>
      <h3>4.2 Withdrawing</h3>
      <p>
        The organiser of a USDC fundraiser can withdraw on Arc, or have the money sent to a supported chain through
        Circle's Cross-Chain Transfer Protocol (CCTP). An EURC fundraiser pays out on Arc only, because cross-chain EURC
        payouts are not available today. Fundit does not hold anything back: you keep what you raise, minus the fees
        below.
      </p>

      <h2>5. Fees</h2>
      <p>
        A fundraiser can have a fee on each donation and a fee on each withdrawal. Each fee is at most 5%. The rates are
        fixed when the fundraiser is created and stay the same for its whole life, even if Fundit changes the rates for
        new fundraisers later. The fundraiser page shows its rates. Donors can also add an optional tip for Fundit.
        Network fees (gas) and any bridge fees are separate and are paid to the network or to Circle, not to Fundit.
        Your Fundit account pays network fees in USDC from its own balance, and nobody pays them for you. Fundit keeps
        at least 0.05 USDC in your account for these fees.
      </p>

      <h2>6. Donations</h2>
      <p>When you donate, you understand that:</p>
      <ul>
        <li>Blockchain transactions cannot be reversed.</li>
        <li>
          There are no refunds. The money goes to the fundraiser, and only its organiser decides how to use it. Fundit
          cannot return a donation.
        </li>
        <li>Your gift comes from your Fundit account balance.</li>
        <li>You pay the network fees for your own transactions.</li>
        <li>Your Fundit account address, the amount and any message you add are public on the blockchain.</li>
        <li>
          "Give anonymously" hides your name on Fundit only. The gift, your account address, the amount and any message
          stay public on the blockchain.
        </li>
      </ul>
      <p>
        Fundit does not check fundraisers or organisers. Before you give, decide for yourself whether you trust the
        organiser.
      </p>

      <h2>7. Third-party services</h2>
      <p>
        Fundit relies on services we do not run: the Arc blockchain, Circle (USDC, EURC, CCTP, Modular Wallets and
        passkeys, and the bundler that sends your account's transactions), Reown and WalletConnect for connecting a
        wallet to add money, and public RPC providers for reading blockchain data.
        Their own terms apply to your use of them, and we are not responsible for their availability or errors.
      </p>

      <h2>8. What we can change</h2>
      <p>
        The Fundit team can pause the creation of new fundraisers, choose which fundraiser is featured, set the fee
        rates for fundraisers created in the future, and change the treasury address that receives fees and tips. The
        team can never move the money held by a fundraiser or change the fee rates of a fundraiser that already
        exists.
      </p>

      <h2>9. Intellectual property</h2>
      <p>
        The Fundit name, logo and website design belong to us. Content in a fundraiser belongs to its organiser, who is
        responsible for it.
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        Fundit is provided as it is. We are not liable for indirect, incidental, special, consequential or punitive
        damages from your use of Fundit, including:
      </p>
      <ul>
        <li>Loss of profits, data or other intangible losses.</li>
        <li>Bugs or failures in smart contracts.</li>
        <li>Problems with the Arc network, other blockchains or bridges.</li>
        <li>Problems with your passkeys or devices, or with connecting a wallet to add money.</li>
        <li>Loss of your Fundit account if you lose every passkey and your recovery key.</li>
        <li>What an organiser does with the money raised.</li>
      </ul>

      <h2>11. Changes to these terms</h2>
      <p>We may update these terms. We will post the new version on this page.</p>

      <h2>12. Governing law</h2>
      <p>These terms are governed by the laws of [to be set before launch], without regard to its conflict of law rules.</p>

      <h2>13. Contact</h2>
      <p>
        Questions about these terms: hello@fundit.fun. See also our{' '}
        <Link to="/privacy">Privacy Policy</Link>.
      </p>
    </article>
  )
}

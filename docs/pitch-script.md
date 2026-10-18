# Fundit pitch script

A spoken talk track for Circle Developer Grants office hours. Target length: 4 minutes, with room to
run between 3 and 5. Lines in brackets are stage directions. Numbers marked `[placeholder]` must be
filled in with real data before the pitch, or dropped.

## 0:00 to 0:30. The problem

When you give to an online fundraiser today, the platform holds your money first. It can freeze it,
delay it or lose it, and you can't check where it is. The creator waits days for a bank transfer,
and if they live in another country, they pay more and wait longer.

Fundit fixes this with a simple rule: every fundraiser is its own escrow contract on Arc. Only the
creator can withdraw, and anyone can audit every dollar.

## 0:30 to 1:45. Demo

[Use a testnet build for any step that moves money. The banner reads "Test network".]

[Open the home page.]

Here's the home page. Every card is a campaign contract on Arc. The contracts are live on Arc mainnet.

[Select Sign in, then Continue with passkey, and create a Fundit account.]

I sign in with a passkey: my fingerprint. There's no wallet app and no seed phrase to start. Fundit
offers me a recovery key right away, 12 words I write down in case I lose this device.

[Open Add money.]

I add USDC to my Fundit account. I can send it to this address from any wallet or exchange, or connect
a wallet here and send from it.

[Click Start a Fundit.]

I'm creating a fundraiser. I pick USDC or EURC, set a goal and write the story. One confirmation, and
the factory deploys a new escrow contract just for this campaign. The fees are copied into it now,
and nobody can change them later.

[Open the campaign page and give 1 USDC with a tip and a message.]

Now I give as a supporter, straight from my Fundit account. Gas is paid in USDC, so I never need
another token. If I tick Give anonymously, Fundit shows "Anonymous" instead of my name. The gift is
still recorded on chain from my account address.

[Show the activity list and the explorer link.]

The donation is on chain, with the fee and the tip split out. Anyone can verify it on the Arc
explorer.

[Open Manage and withdraw to Base.]

As the creator, I withdraw. I can take the money on Arc, or send USDC to Base, Ethereum, Arbitrum
and other CCTP chains. For Base, the campaign burns through CCTP V2 with the Forwarding Service,
and Circle mints on Base. I don't need gas on Base.

## 1:45 to 2:30. The Circle stack

Fundit is built on Circle from the contract up:

- **Arc** is the home chain for every campaign.
- **USDC and EURC** are the only two campaign tokens.
- **Modular Wallets** give every person a Fundit account with a passkey. It's the only way to sign in.
- **CCTP V2 and the Forwarding Service** pay creators on other chains, and let people send money out of
  their Fundit account.
- **Bridge Kit** brings USDC in from another chain when you add money. It's behind a flag.

Every test that moves money runs on Arc testnet first. We'd rather under-claim than ship a path that
strands a donation.

## 2:30 to 3:15. The trust model

Here's what makes Fundit different from a platform:

- The owner can never move, freeze or redirect a creator's balance. That's enforced in code, and the
  contracts can't be upgraded.
- Fees launch at 1% on donations and 1% on withdrawals. The code caps each at 5%, and a campaign's
  fees are fixed when it's created.
- Fees are pulled by a separate call, so a broken treasury can never block a donation or a
  withdrawal. The owner can rotate the treasury, and the new one also collects unclaimed fees and
  tips.
- If a creator loses their key, an optional backup can take over after a 7-day wait, and the creator
  can cancel at any time during that wait.

The app is a static site, and no Fundit server ever holds a key that can move money.

## 3:15 to 3:45. Traction plan

We're pre-launch. The contracts are deployed on Arc mainnet and verified on Sourcify. They're tested
with unit, fuzz, invariant and fork tests. The app goes live on fundit.fun once the testnet runs pass.
Our first users come from:

- Diaspora fundraisers, where cross-border payouts hurt most.
- Crypto communities that already hold USDC on Base and Arbitrum, once adding money from other chains
  is on (M2).

Our target for the first 90 days is `[placeholder: number]` campaigns and `[placeholder: amount]`
USDC raised. We'll report every number from on-chain data.

## 3:45 to 4:15. The ask

We're applying for a Circle Developer Grant with milestone-based USDC payments:

1. The app live on fundit.fun, on the deployed mainnet factory.
2. Adding money from other chains switched on after testnet checks.
3. A third-party audit of the two contracts.
4. Card donations through Onramp Kit in V2.

Thank you. I'm happy to take questions.

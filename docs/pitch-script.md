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

[Only after the mainnet deploy. Before then, demo the fork build.]

[Open fundit.xyz on the home page.]

Here's the home page. Every card is a campaign contract on Arc mainnet.

[Click Start a fundraiser.]

I'm creating a fundraiser. I pick USDC or EURC, set a goal and write the story. One transaction, and
the factory deploys a new escrow contract just for this campaign. The fees are copied into it now,
and nobody can change them later.

[Open the campaign page and donate 1 USDC with a tip and a message.]

Now I donate as a supporter. I approve the campaign, then donate. The donate call goes through Arc Memo, so the
donation is tagged as a Fundit donation and still recorded under my own address. Gas is paid in
USDC, so I never need another token.

[Show the activity list and the explorer link.]

The donation is on chain, with the fee and the tip split out. Anyone can verify it on the Arc
explorer.

[Only after canary C4 passes.]

[Open Manage and withdraw to Base.]

As the creator, I withdraw. I can take the money on Arc, or send USDC to Base, Ethereum, Arbitrum
and three other chains. For Base, the campaign burns through CCTP V2 with the Forwarding Service,
and Circle mints on Base. I don't need gas on Base.

## 1:45 to 2:30. The Circle stack

Fundit is built on Circle from the contract up:

- **Arc** is the home chain for every campaign.
- **USDC and EURC** are the only two campaign tokens.
- **Arc Memo** tags each donation.
- **CCTP V2 and the Forwarding Service** pay creators on six other chains.

Behind flags, we've also built three more paths. They're unit-tested, with the settle path tested on
an Arc mainnet fork:

- **Bridge Kit**, so a donor on Base or Arbitrum can give straight into a campaign on Arc.
- **Gateway with the Unified Balance Kit**, so a donor can give from their unified USDC balance.
- **Modular Wallets**, so a new donor can sign up with a passkey and no browser extension.

We turn each one on only after a live mainnet canary proves it. We'd rather under-claim than ship a
path that strands a donation.

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

We're pre-launch. The contracts are tested with unit, fuzz, invariant and fork tests and are ready
for mainnet. Our first users come from:

- Diaspora fundraisers, where cross-border payouts hurt most.
- Crypto communities that already hold USDC on Base and Arbitrum, once cross-chain donations are on
  (M2).

Our target for the first 90 days is `[placeholder: number]` campaigns and `[placeholder: amount]`
USDC raised. We'll report every number from on-chain data.

## 3:45 to 4:15. The ask

We're applying for a Circle Developer Grant with milestone-based USDC payments:

1. Mainnet launch with a verified factory and a completed canary.
2. Cross-chain donations and passkeys switched on after live checks.
3. A third-party audit of the two contracts.
4. Card donations through Onramp Kit in V2.

We'd also value a technical review from the CCTP team on forwarded mints into contract recipients.
That's the one open question for cross-chain donations.

Thank you. I'm happy to take questions.

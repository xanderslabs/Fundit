# End-to-end tests

The suite drives the app in Chromium against Arc testnet with real Circle passkeys. A WebAuthn virtual
authenticator, added through the Chrome DevTools Protocol, stands in for the device's passkey. Nothing is
mocked: Circle registers the passkey, Circle's bundler sends the user operations, and the specs check the
results on Arc testnet with viem.

## Passkeys work only on fundit.fun

Local e2e runs no longer work with passkeys. A passkey belongs to one site, its relying party ID (rpId). The
testnet Circle client key now has `fundit.fun` as its passkey domain, so Circle accepts only passkeys made for
`fundit.fun`. A page on `localhost` cannot use them, and cannot make new ones that Circle accepts. Run the suite
against the live testnet site with `E2E_BASE_URL=https://fundit.fun`. The suite stops at the start with this
reason if the base URL does not match the stored passkey's rpId.

Circle allows one passkey domain per environment, so a second credential for `localhost` cannot work and the
suite does not offer one.

### Known gap: e2e runs only after deploy

Passkey e2e runs only after a deploy, against `https://fundit.fun`. It checks what is live, never a branch
before it merges. Before deploy, the money paths are covered by unit tests only. These include the wallet
deposit regression test (`src/components/WalletTabs.rerender.test.tsx`: a connected wallet survives My page
re-renders and can still send), the sender tests (`src/lib/sender.test.ts`: switch to Arc before sending, and
send nothing if the switch is refused) and the Add money panel tests. The suite's own wallet step only opens
the From a wallet tab. It does not connect a wallet, so it would not catch a wallet bug like that one. After
each deploy, run the suite once against `https://fundit.fun` as a smoke test.

## One shared account

Every run uses the same Fundit account, so Circle's count of active wallets stays low. Its passkey lives in
`app/.env.testnet.passkey`, which is gitignored (`.env.*`). The file holds the credential ID, the private key,
the rpId and the user handle of the passkey, plus the account address and username. Never print, commit or
share it: anyone with it controls the account and its money.

At the start of a run the suite adds that credential to a WebAuthn virtual authenticator with the Chrome
DevTools Protocol (`WebAuthn.addCredential`), then signs in with it like a passkey saved on the device. The
signature counter starts at the current Unix time in seconds, so it rises from run to run.

### Make the shared account once

```shell
E2E_BASE_URL=https://fundit.fun npm --prefix app run e2e:make-account
```

The script signs up a new account named `e2e-shared-<milliseconds>` on the live site, reads its address and
writes `app/.env.testnet.passkey` with mode `600`. If the file already exists, the script stops before it signs
up anything and never overwrites the file: the account behind it would be lost with its money. To start again
with a new account, move the old file away yourself first.

The script writes the file as soon as the virtual authenticator holds the new passkey, before it reads the
address, so a later failure cannot lose the private key. If it stops after that point,
`E2E_ACCOUNT_ADDRESS` stays `0x0000000000000000000000000000000000000000`. The suite's first step then fails
on the address. Sign in on fundit.fun with that passkey, read the address on **My page** and put it in the
file.

## What a run does

`journeys.spec.ts` runs these steps in order with the shared account. Each step needs the one before it. The
account keeps its balance, its Fundits and its recovery key from earlier runs, and each step works from the
state it finds.

1. Signs in with the stored passkey, opens **My page** and checks that **Your address** in **Add money** is
   the shared account.
2. Adds money: the funder tops the account up to what the run needs with an ERC-20 `transfer`, and sends
   nothing when the account already holds enough. The balance card must show the balance. The **Add money**
   button then closes and opens the panel, and its tabs switch.
3. Saves the recovery key if no earlier run did: **Save now** in the banner shows the 12 words, the suite
   types back the three the page asks for, and checks on Arc that the key's address is now an owner of the
   account. If a key is already saved, it checks that there is no banner and that the **Account** tab says
   **Recovery key saved**.
4. Creates a new Fundit with a goal of 10 USDC. The title ends with the run's start time, so **My page** finds
   this run's Fundit among the earlier ones. Fundits are contracts, not wallets, so a new one per run does not
   add to the wallet count.
5. Gives 0.2 USDC anonymously with a message. The activity must show "Anonymous" and the message, with no
   `[anon]` text. The `Donated` event must name the account and carry `[anon]` at the start of the message.
6. Withdraws everything on Arc from **Manage** to the account.
7. Checks **My page**: **Your Fundits** has a **Manage** link for the new Fundit, and **Your gifts** lists
   the gift with the message and the label "Given with name hidden", with no `[anon]` text.
8. Opens the **Send** panel on **My page**, checks that **Max** keeps back the estimated prefund for the send,
   then sends 0.1 USDC on Arc back to the funder. The funder must receive exactly 0.1 USDC. The rest stays in
   the account for the next run.

Each step prints the explorer link of its transaction, for example:

```text
[tx] Create a Fundit: https://explorer.testnet.arc.io/tx/0x...
```

The links are also kept as `tx` annotations on each test.

## Prerequisites

- Chromium for Playwright: `npx playwright install chromium`.
- `app/.env.local` with these values:

  | Variable | Value |
  | --- | --- |
  | `VITE_ARC_NETWORK` | `testnet`. The suite refuses to run with any other value. |
  | `VITE_CIRCLE_CLIENT_KEY` | Not needed: the live site uses its own client key. |
  | `VITE_FACTORY_ADDRESS` | The testnet factory. |
  | `VITE_FACTORY_DEPLOY_BLOCK` | The block the testnet factory was deployed in. |

  `VITE_REOWN_PROJECT_ID` is not needed. Without it AppKit logs `No project ID is configured` and gets `403`
  from Reown, and the app still works. The suite never opens the wallet modal.
- `app/.env.testnet.funder` with one line, `FUNDER_PRIVATE_KEY=0x...`. This is the key of a testnet-only
  account that holds testnet USDC. Get USDC for it from the [Circle faucet](https://faucet.circle.com) on Arc
  Testnet. The file is gitignored (`.env.*`). The key is read only in the Node process, never sent to the
  page and never printed. Never use a key that holds mainnet funds, and never use the factory deployer.
- `app/.env.testnet.passkey`, made once as described in [Make the shared account once](#make-the-shared-account-once).

## Run

Set `E2E_BASE_URL` to the live testnet site:

```shell
E2E_BASE_URL=https://fundit.fun npm --prefix app run e2e
```

Playwright starts no local server and opens that site. The config accepts only `https://fundit.fun` or a
`localhost` URL here, and stops with an error for anything else. The site uses its own client key, so the passkeys are
bound to its domain (`fundit.fun`), and `VITE_CIRCLE_CLIENT_KEY` in `app/.env.local` is not needed. The suite
still reads `VITE_ARC_NETWORK` and the factory values from `app/.env.local` in Node, so they must match the
site: `testnet` and the testnet factory. Run it only against a site built for Arc testnet. The funder pays
for the run in the same way as a local run.

Without `E2E_BASE_URL`, Playwright still starts the Vite dev server on `http://localhost:5174`, but the suite
stops in `beforeAll`: the stored passkey is bound to `fundit.fun` (see [Passkeys work only on
fundit.fun](#passkeys-work-only-on-fundit-fun)).

To check the suite compiles and lists its steps without spending anything:

```shell
E2E_BASE_URL=https://fundit.fun npx --prefix app playwright test --list
```

## Cost

The shared account keeps its money, so the funder sends only what a run is missing. The account should hold
2 USDC when a run starts, or 3.2 USDC before its recovery key is saved, because that first user operation
also deploys the account. A run then spends about 1.2 to 1.4 USDC: the gas below, the fees on the gift, and
the 0.1 USDC sent back to the funder. The next run tops up that difference.

The figures below are from the earlier suite, which made a new account per run. Green runs on 2026-10-18 cost
2.29, 2.47 and 2.20 USDC. The money went to:

- Gas for five user operations, about 2.1 USDC. Circle's bundler prices user operations far above Arc's own
  price: the app uses Circle's `low` tier, which charged 732 to 900 gwei per gas in the 2.20 USDC run,
  against a base fee of about 20 gwei. The first operation (the recovery key) also deploys the account and
  costs about 0.96 to 1.07 USDC. Creating the Fundit costs about 0.46, the gift about 0.28, the withdrawal
  about 0.20 and the send about 0.18.
- The 1% donation and withdrawal fees on the 0.2 USDC gift, and the funder's own transfer gas.

A run that fails part way leaves its money in the shared account, and the next run uses it. The suite prints
the funder's and the account's balances before the run, and the funder's balance after.

## Traces

A failed test keeps a Playwright trace in `app/test-results/`. The trace records the page's network calls,
including the `Authorization` header with the site's Circle client key. Do not attach traces to issues
or reports. The funder key never appears in a trace: it stays in the Node process.

## Limits

- The shared passkey's name is `e2e-shared-<milliseconds>`. Circle accepts 5 to 50 characters from `A-Z`,
  `a-z`, `0-9` and `_@.:+-` only.
- A user operation left pending by a run that stopped part way can clash with the next run's first send. The
  page then says another transaction is still going through. Wait a minute and run again.
- The suite does not cover Add money from a connected wallet (AppKit) or from another chain.

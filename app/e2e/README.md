# End-to-end tests

The suite drives the app in Chromium against Arc testnet with real Circle passkeys. A WebAuthn virtual
authenticator, added through the Chrome DevTools Protocol, stands in for the device's passkey. Nothing is
mocked: Circle registers the passkey, Circle's bundler sends the user operations, and the specs check the
results on Arc testnet with viem.

## What a run does

`journeys.spec.ts` runs these steps in order with one new Fundit account. Each step needs the one before it.

1. Signs up with a passkey. Sign-up lands on **My page** with the **Add money** panel open, and the suite
   reads the new account address from its **Your address** tab.
2. Adds money: the funder sends 3 USDC to that address with an ERC-20 `transfer`. The balance card must show
   it. The **Add money** button then closes and opens the panel, and its tabs switch.
3. Saves the recovery key: **Save now** in the banner shows the 12 words, the suite types back the three the
   page asks for, and checks on Arc that the key's address is now an owner of the account. The banner goes
   away and the **Account** tab says **Recovery key saved**.
4. Creates a Fundit with a goal of 10 USDC.
5. Gives 0.2 USDC anonymously with a message. The activity must show "Anonymous" and the message, with no
   `[anon]` text. The `Donated` event must name the account and carry `[anon]` at the start of the message.
6. Withdraws everything on Arc from **Manage** to the account.
7. Checks **My page**: **Your Fundits** has a **Manage** link for the new Fundit, and **Your gifts** lists
   the gift with the message and the label "Given with name hidden", with no `[anon]` text.
8. Opens the **Send** panel on **My page** and sends the money out on Arc back to the funder with **Max**.
   Max keeps back the estimated prefund for the send, and the funder must receive exactly the Max amount.

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
  | `VITE_CIRCLE_CLIENT_KEY` | A Circle client key whose allowed domain is `localhost`. Not needed with `E2E_BASE_URL`. |
  | `VITE_FACTORY_ADDRESS` | The testnet factory. |
  | `VITE_FACTORY_DEPLOY_BLOCK` | The block the testnet factory was deployed in. |

  `VITE_REOWN_PROJECT_ID` is not needed. Without it AppKit logs `No project ID is configured` and gets `403`
  from Reown, and the app still works. The suite never opens the wallet modal.
- `app/.env.testnet.funder` with one line, `FUNDER_PRIVATE_KEY=0x...`. This is the key of a testnet-only
  account that holds testnet USDC. Get USDC for it from the [Circle faucet](https://faucet.circle.com) on Arc
  Testnet. The file is gitignored (`.env.*`). The key is read only in the Node process, never sent to the
  page and never printed. Never use a key that holds mainnet funds, and never use the factory deployer.
- Free port `5174` on `localhost`, for a local run only.

## Run

The suite has two targets. `E2E_BASE_URL` picks one.

### Against the local dev server

Leave `E2E_BASE_URL` unset:

```shell
npm --prefix app run e2e
```

Playwright starts the Vite dev server on `http://localhost:5174`, which reads `app/.env.local`. Use
`localhost`, never `127.0.0.1`: Circle checks the page hostname and accepts only `localhost` for this key.
This works only while a Circle client key lists `localhost` as its passkey domain and allowed domain.

### Against a live site

Set `E2E_BASE_URL` to the site's origin:

```shell
E2E_BASE_URL=https://fundit.fun npm --prefix app run e2e
```

Playwright starts no local server and opens that site. The site uses its own client key, so the passkeys are
bound to its domain (`fundit.fun`), and `VITE_CIRCLE_CLIENT_KEY` in `app/.env.local` is not needed. The suite
still reads `VITE_ARC_NETWORK` and the factory values from `app/.env.local` in Node, so they must match the
site: `testnet` and the testnet factory. Run it only against a site built for Arc testnet. The funder pays
for the run in the same way as a local run.

## Cost

A full run costs the funder about 2.2 to 2.5 testnet USDC. Green runs on 2026-10-18 cost 2.29, 2.47 and
2.20 USDC. The money goes to:

- Gas for five user operations, about 2.1 USDC. Circle's bundler prices user operations far above Arc's own
  price: the app uses Circle's `low` tier, which charged 732 to 900 gwei per gas in the 2.20 USDC run,
  against a base fee of about 20 gwei. The first operation (the recovery key) also deploys the account and
  costs about 0.96 to 1.07 USDC. Creating the Fundit costs about 0.46, the gift about 0.28, the withdrawal
  about 0.20 and the send about 0.18.
- What stays in the throwaway account: about 0.06 USDC, plus about 0.05 USDC of prefund left in its
  EntryPoint deposit. Nobody can spend it after the run, because the passkey goes away with the browser
  context.
- The 1% donation and withdrawal fees on the 0.2 USDC gift, and the funder's own transfer gas.

A run that fails part way leaves the rest of the 3 USDC in that account, and nobody can recover it. The funder
needs more than 3.1 USDC before a run starts. The suite checks this and prints the funder's balance before
and after.

## Traces

A failed test keeps a Playwright trace in `app/test-results/`. The trace records the page's network calls,
including the `Authorization` header with the localhost Circle client key. Do not attach traces to issues
or reports. The funder key never appears in a trace: it stays in the Node process.

## Limits

- The passkey name is `e2e-<milliseconds>`. Circle accepts 5 to 50 characters from `A-Z`, `a-z`, `0-9` and
  `_@.:+-` only.
- The suite does not cover Add money from a connected wallet (AppKit) or from another chain.

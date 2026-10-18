# End-to-end tests

The suite drives the app in Chromium against Arc testnet with real Circle passkeys. A WebAuthn virtual
authenticator, added through the Chrome DevTools Protocol, stands in for the device's passkey. Nothing is
mocked: Circle registers the passkey, Circle's bundler sends the user operations, and the specs check the
results on Arc testnet with viem.

## What a run does

`journeys.spec.ts` runs these steps in order with one new Fundit account. Each step needs the one before it.

1. Signs up with a passkey and reads the new account address from **Add money**.
2. Adds money: the funder sends 3 USDC to that address with an ERC-20 `transfer`.
3. Saves the recovery key: shows the 12 words, types back the three the page asks for, and checks on Arc that
   the key's address is now an owner of the account.
4. Creates a Fundit with a goal of 10 USDC.
5. Gives 0.2 USDC anonymously with a message. The activity must show "Anonymous" and the message, with no
   `[anon]` text. The `Donated` event must name the account and carry `[anon]` at the start of the message.
6. Withdraws everything on Arc from **Manage** to the account.
7. Sends the money out on Arc from **My page** back to the funder, keeping 0.35 USDC in the account.

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
  | `VITE_CIRCLE_CLIENT_KEY` | A Circle client key whose allowed domain is `localhost`. |
  | `VITE_FACTORY_ADDRESS` | The testnet factory. |
  | `VITE_FACTORY_DEPLOY_BLOCK` | The block the testnet factory was deployed in. |

  `VITE_REOWN_PROJECT_ID` is not needed. Without it AppKit logs `No project ID is configured` and gets `403`
  from Reown, and the app still works. The suite never opens the wallet modal.
- `app/.env.testnet.funder` with one line, `FUNDER_PRIVATE_KEY=0x...`. This is the key of a testnet-only
  account that holds testnet USDC. Get USDC for it from the [Circle faucet](https://faucet.circle.com) on Arc
  Testnet. The file is gitignored (`.env.*`). The key is read only in the Node process, never sent to the
  page and never printed. Never use a key that holds mainnet funds, and never use the factory deployer.
- Free port `5174` on `localhost`.

## Run

```shell
npm --prefix app run e2e
```

Playwright starts the Vite dev server on `http://localhost:5174`, which reads `app/.env.local`. Use
`localhost`, never `127.0.0.1`: Circle checks the page hostname and accepts only `localhost` for this key.

## Cost

A full run costs the funder about 2.3 to 2.5 USDC of testnet USDC. Two runs on 2026-10-18 cost 2.29 and
2.47 USDC. The money goes to:

- Gas for five user operations, about 2.2 USDC. The first one also deploys the account, so it costs about
  1.07 USDC. Circle's bundler prices user operations at its `medium` gas price, about 700 to 870 gwei on
  Arc testnet, against a base fee of about 20 gwei.
- What stays in the throwaway account: about 0.2 USDC, plus any prefund left in its EntryPoint deposit.
  Nobody can spend it after the run, because the passkey goes away with the browser context.
- The 1% donation and withdrawal fees on the 0.2 USDC gift, and the funder's own transfer gas.

A run that fails part way leaves the rest of the 3 USDC in that account, and nobody can recover it. The funder
needs more than 3.1 USDC before a run starts. The suite checks this and prints the funder's balance before
and after.

## Limits

- **Send money out** uses a typed amount, not **Max**. Max keeps only the 0.05 USDC gas reserve, and the
  EntryPoint takes the user operation's prefund (about 0.22 USDC) before the transfer runs, so a Max send
  reverts with `ERC20: transfer amount exceeds balance`.
- The passkey name is `e2e-<milliseconds>`. Circle accepts 5 to 50 characters from `A-Z`, `a-z`, `0-9` and
  `_@.:+-` only.
- The suite does not cover Add money from a connected wallet (AppKit) or from another chain.

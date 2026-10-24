# End-to-end tests

The suite drives the app in Chromium against Arc testnet. A test wallet that the page finds through EIP-6963
stands in for a browser wallet. Nothing is mocked: the app sends real transactions on Arc testnet, and the spec
checks the results on chain with viem.

## What a run does

`wallet.spec.ts` runs these steps in order. Each step needs the one before it.

1. Tops the test wallet up to 0.1 USDC from the funder, then signs in: **Sign in**, **Connect a wallet**,
   **Fundit Test Wallet**. The account pill shows the short address, and the wallet was asked to switch to Arc.
2. Starts a new Fundit with a goal of 10 USDC.
3. Gives 0.01 USDC anonymously with a message. The wallet sends one transaction, to `Multicall3From`
   (`0x522fAf9A91c41c443c66765030741e4AaCe147D0`) from the test address: approve and donate in one call. The
   activity must show "Anonymous" and the message with no `[anon]` text. The `Donated` event must name the
   wallet and start the message with `[anon]`.
4. Withdraws everything on Arc from **Manage** to the wallet. The `Withdrawn` event must name the wallet.
5. Checks **My page**: **Your Fundits** has a **Manage** link for the new Fundit, and **Your gifts** lists the
   gift with the message and the label "Given with name hidden". **Add money** shows the address and
   "Card and bank coming soon.", with no tabs.
6. Sends 0.01 USDC out to the funder from **My page**, checks the ERC-20 `Transfer`, then signs out.

After the run, whatever is left in the wallet goes back to the funder, even when a step fails. A run costs the
funder about 0.02 to 0.03 USDC in gas and leaves about 0.002 USDC in the wallet.

Each step prints the explorer link of its transaction, for example:

```text
[tx] Create a Fundit: https://explorer.testnet.arc.io/tx/0x...
```

The links are also kept as `tx` annotations on each test. The run also prints every host the page talked to and
any request or WebSocket to a WalletConnect or Reown host, with the step it happened in.

## Prerequisites

- Chromium for Playwright: `npx playwright install chromium`.
- `app/.env.local` with these values:

  | Variable | Value |
  | --- | --- |
  | `VITE_ARC_NETWORK` | `testnet`. The suite refuses to run with any other value. |
  | `VITE_FACTORY_ADDRESS` | The testnet factory. |
  | `VITE_FACTORY_DEPLOY_BLOCK` | The block the testnet factory was deployed in. |

  `VITE_REOWN_PROJECT_ID` is not needed. Without it AppKit logs `No project ID is configured` and gets `403`
  from Reown, and the app still works. The suite never opens the wallet modal.
- `app/.env.testnet.funder` with one line, `FUNDER_PRIVATE_KEY=0x...`. This is the key of a testnet-only
  account that holds testnet USDC. Get USDC for it from the [Circle faucet](https://faucet.circle.com) on Arc
  Testnet. The file is gitignored (`.env.*`). The key is read only in the Node process, never sent to the
  page and never printed. Never use a key that holds mainnet funds, and never use the factory deployer.
- `app/.env.testnet.wallet`, made once as described in [Make the wallet key once](#make-the-wallet-key-once).

### Make the wallet key once

The wallet's address is in `testCreators` for testnet in `src/config.ts`, so the Fundit each run makes stays off
Home and Explore, also on fundit.fun. Make the file once, with mode 600:

```shell
node --input-type=module -e "import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';import {writeFileSync} from 'node:fs';const k=generatePrivateKey();writeFileSync('.env.testnet.wallet','E2E_WALLET_PRIVATE_KEY='+k+'\n',{mode:0o600,flag:'wx'});console.log(privateKeyToAccount(k).address.toLowerCase())"
```

Run it in `app/`. It prints only the address. Add that lower-case address to `testCreators` for testnet. The
spec stops before it spends anything when the file is missing or the address is not in `testCreators`, so a new
unhidden key is never made silently. Never print, commit or share the file.

## Run on localhost

Playwright starts the Vite dev server on `http://localhost:5174` when `E2E_BASE_URL` is not set:

```shell
npm --prefix app run e2e
```

This checks a branch before it merges.

## Run against fundit.fun

Set `E2E_BASE_URL` to the live site:

```shell
E2E_BASE_URL=https://fundit.fun npm --prefix app run e2e
```

Playwright starts no local server and opens that site. The config accepts only `https://fundit.fun` or a
`localhost` URL, and stops with an error for anything else. The suite still reads `VITE_ARC_NETWORK` and the
factory values from `app/.env.local` in Node, so they must match the site: `testnet` and the testnet factory.
Run it only against a site built for Arc testnet. Run it once after each deploy as a smoke test.

To check that the suite compiles and lists its steps without spending anything:

```shell
npx --prefix app playwright test --list
```

## How the test wallet works

`e2e/wallet.ts` adds an EIP-1193 provider to the page and announces it through EIP-6963 as "Fundit Test
Wallet". The page side only forwards each request to the Node test process (`page.exposeFunction`). The key is
the one persistent key from `app/.env.testnet.wallet`, read only in that process and never printed. It signs
`eth_sendTransaction` there and broadcasts through the Arc testnet RPC. The wallet starts on chain 1, so the
app's switch to Arc and the add-network request are part of every run.

## Traces

A failed test keeps a Playwright trace in `app/test-results/`. The funder and wallet keys never appear in a
trace: they stay in the Node process. Still, do not attach traces to issues or reports.

## Limits

- The suite does not cover Add money from another chain.

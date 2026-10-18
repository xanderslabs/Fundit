# End-to-end tests

The specs drive the built app in Chromium against a local fork of Arc mainnet. Each run starts the fork,
deploys `CampaignFactory` with `contracts/script/Deploy.s.sol`, builds the app in `e2e` mode and serves it
with `vite preview`.

The current specs are skipped. They sign in with a mock wallet, and sign-in is now passkey only. Plan 5
Task 4 replaces them with specs on Arc testnet that use a virtual passkey.

## Prerequisites

- Arc Foundry `v0.8.0-2`. Install it as described in `contracts/README.md` under **Install Arc Foundry**.
  Upstream anvil does not work here: on Arc the USDC balance is the native balance, and only Arc Foundry
  executes that precompile.
- Chromium for Playwright: `npx playwright install chromium`.
- Network access to `https://rpc.mainnet.arc.io`. The fork reads mainnet state from it. Nothing is sent to it.
- Ports `8545` and `4173` on `127.0.0.1` must be free. The run stops if something already answers on `8545`.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `ARC_ANVIL_BIN` | `arc-anvil` on `PATH` | Path to Arc Foundry's `anvil`. |
| `ARC_FORGE_BIN` | `arc-forge` or `forge` next to `ARC_ANVIL_BIN`, else `arc-forge` on `PATH` | Path to Arc Foundry's `forge`, used for the deploy. |
| `ARC_FORK_URL` | `https://rpc.mainnet.arc.io` | RPC the fork reads from. |

## Run

```shell
ARC_ANVIL_BIN=~/.local/bin/arc-anvil npm --prefix app run e2e
```

## What a run does

1. Reads the current Arc block number once and starts `anvil --fork-block-number <block>` on
   `127.0.0.1:8545`, so every spec in the run sees the same mainnet state.
2. Clears the code on the anvil default accounts it uses (on mainnet they carry EIP-7702 delegations set by
   others) and gives each 1,000 USDC with `anvil_setBalance`. On Arc, 1 USDC is `1e18` native wei.
3. Deploys the factory from anvil account 0 with its public default key, broadcasting to `127.0.0.1:8545`
   only. Broadcast files go to a temp directory, not `contracts/broadcast/`.
4. Writes `app/.env.e2e` (factory address, deploy block, `VITE_ARC_RPC_URL=http://127.0.0.1:8545` and a
   dummy Reown project id) and runs `vite build --mode e2e` into `app/dist-e2e/`.

In `e2e` mode, `vite.config.ts` swaps `src/wagmi.ts` for `src/wagmi.e2e.ts` (the wagmi `mock` connector, no
AppKit) and `@reown/appkit/react` for `src/appkit.e2e.ts`. Each page picks its wallet account from the
`fundit.e2e.account` localStorage key. Production builds never include either file.

## Network guard

Every browser request goes through a Playwright route. Requests to `127.0.0.1` pass. ENS and Basename RPCs
get empty answers, and Iris and Gateway get `404` unless a spec routes them itself. A request to any other
host is aborted and fails the test.

## Gas margin regression

`create-donate-withdraw.spec.ts` sends a withdrawal while the campaign's last activity is in the latest
block, and the main flow closes the campaign straight after the withdrawal. `Campaign._activity()` skips its
storage writes when the block number has not changed, so an estimate made against the latest block is
about 3,200 gas short. Anvil estimates that way for an `eth_sendTransaction` without `gas`, and some wallets
and nodes do too. The app estimates each call on its Arc client and sends `gas` with 25% on top
(`withGasMargin` in `src/lib/sender.ts`, also used for the passkey call gas). Without the app-supplied gas
these writes revert out of gas.

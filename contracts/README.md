# Fundit contracts

Per-campaign USDC and EURC escrow on Arc mainnet (chain ID `5042`, CCTP domain `26`).

## Development

### Install Arc Foundry

The offline suite runs on upstream Foundry. The fork suite and the deploy simulation need
Arc Foundry, because Arc USDC moves balances through a native-coin precompile that upstream
Foundry does not execute. Under upstream `forge`, the fork tests that move USDC revert.

The fork suite was verified with Arc Foundry `v0.8.0-2` from
[circlefin/arc-foundry](https://github.com/circlefin/arc-foundry/releases). On Apple Silicon:

```shell
gh release download v0.8.0-2 -R circlefin/arc-foundry \
  -p 'arc-foundry-v0.8.0-2-aarch64-apple-darwin.tar.gz*'
shasum -a 256 -c arc-foundry-v0.8.0-2-aarch64-apple-darwin.tar.gz.sha256
mkdir arc-foundry && tar -xzf arc-foundry-v0.8.0-2-aarch64-apple-darwin.tar.gz -C arc-foundry
mkdir -p ~/.local/bin
mv arc-foundry/forge ~/.local/bin/arc-forge
mv arc-foundry/cast ~/.local/bin/arc-cast
mv arc-foundry/anvil ~/.local/bin/arc-anvil
arc-forge --version
```

Linux archives use the `x86_64-unknown-linux-gnu` or `aarch64-unknown-linux-gnu` target
instead. Arc Foundry is not available through `foundryup`. In CI, install it the same way
and do not use `foundry-rs/foundry-toolchain`.

### Run the tests

Offline suite (unit, fuzz and invariant). The fork suite is skipped:

```shell
forge test
```

Fork suite against Arc mainnet. It only reads chain state:

```shell
ARC_FORK=1 arc-forge test --match-path test/fork/ArcFork.t.sol --fork-url arc -vv
```

Strict fork gate. Run it right before a mainnet deploy. It fails if Memo stops preserving
the sender, if EIP-3009 or EIP-2612 entry points are missing on USDC or EURC, or if EURC
CCTP burns start working for domains 0, 1, 6 or 14. In that last case, update
`EURC_PAYOUT_DOMAINS` before you deploy:

```shell
ARC_FORK=1 ARC_FORK_STRICT=1 arc-forge test --match-path test/fork/ArcFork.t.sol --fork-url arc -vv
```

### Simulate the deploy

Copy `.env.example` to `.env` and fill it in. For a simulation, use a throwaway key such as
the Anvil default key, never a real one. Without `--broadcast`, no transaction is sent:

```shell
set -a && source .env && set +a
arc-forge script script/Deploy.s.sol --fork-url arc
```

The script logs `factory`, `implementation` and the EURC payout domains, followed by the gas
estimate. Dry-run output under `broadcast/*/5042/dry-run/` is ignored by git.

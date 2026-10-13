# ADR-0007: Multisig-gated bridge for HOUR between Base and hOUR Chain

Status: Proposed (2026-10-13)
Amends: none (additive to ADR-0001 and ADR-0005)

## Context

`hOUR` (the ERC-20 token, `HourToken`) is deployed, verified, and live on
Base mainnet (`0xFC1c0FFF99845676A588CE21c28C4859F3035866`), but pre-launch:
trading is disabled and only owner/exempt wallets can move it. hOUR Chain
(ADR-0005) is a separate Cosmos SDK L1 with EVM compatibility; its native
gas denom `ahbc` is unrelated to the Base token.

ADR-0001 decided Base is the settlement network and that cross-chain
bridges are not a core dependency. That decision stands for payments.
Separately, there is now a concrete need for HOUR to have utility on hOUR
Chain itself (e.g. staking, governance, fee payment on the protocol chain).
Base is EVM and hOUR Chain is Cosmos-EVM; there is no native IBC or CCIP
path between them (CCIP does not support Cosmos/IBC chains — see README).
Any connection requires a trusted bridge, not a trust-minimized one.

## Decision

Build a minimal lock/mint bridge:

- **Base side — `HourBridgeVault`** (in `witching-hour-token/contracts`):
  locks HOUR deposits bound for hOUR Chain, and releases HOUR back once a
  burn on hOUR Chain is independently confirmed by a quorum of signers.
- **hOUR Chain side — `WrappedHour`** (same repo, deployed to hOUR Chain's
  EVM JSON-RPC, chain id 9000): a standard ERC-20 (`whOUR`) minted only on
  quorum-confirmed proof of a Base lock, and burned to request a release
  back on Base.
- **Trust model: multisig-gated relayer.** Each signer independently
  verifies the source-chain event and calls `confirmRelease` /
  `confirmMint` with the same parameters; the action executes once a
  configured threshold (e.g. 2-of-3) agrees. No single hot key can mint or
  release alone. This is explicitly **not** a trust-minimized bridge (no
  light client, no fraud proof) — it is a trusted multisig, chosen because
  it is free to run (no third-party bridge integration, no new infra) and
  strictly better than a single relayer key.

Both contracts live in the `witching-hour-token` Hardhat project rather
than duplicating a Solidity toolchain in this repo; `WrappedHour` targets
hOUR Chain's EVM RPC as a deployment network, not a different codebase.

## Consequences

- The existing `HourToken` contract is **not modified or redeployed**. Its
  existing `isFeeExempt` mechanism is sufficient: the vault is marked fee-
  exempt so locks/releases move 1:1 without the 2/3/2% fee split.
- The owner retains unilateral control over each contract's signer set and
  threshold (same trust level as `HourToken`'s existing `Ownable`
  governance). This is a known centralization point, acceptable at the
  current single-founder stage. Must be revisited (e.g. moved to a real
  multisig/Safe) before meaningful external value is at risk.
- No relayer automation is implemented yet — signers currently confirm
  manually by watching `Locked` / `BurnedForRelease` events. An automated
  watcher (matching the pattern of existing off-machine watchdogs) is a
  follow-up, not required for the contracts to be correct.
- Neither contract is deployed yet. Deployment to Base mainnet costs real
  gas and must not happen without explicit, per-instance approval.

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

### Security audit and hardening follow-up (2026-10-20)

- The Base mainnet vault owner was re-read at block 52,834,228. It is
  `0x4e59b44847b379578588920cA78FbF26c0B4956C`, the deterministic CREATE2
  deployment proxy, not a Safe. The old constructor used `Ownable(msg.sender)`
  while deploying through that proxy, so owner-only functions are effectively
  inaccessible. The signer set cannot be rotated and the threshold cannot be
  adjusted on this immutable deployment. The vault still reports threshold 2,
  three configured signers, and HOUR balance zero; its fee-exempt flag is set.
- The hOUR devnet `WrappedHour` at
  `0x3D641a2791533B4A0000345eA8d509d01E1ec301` was also checked over the
  private RPC: owner `0xc6fe5d33615a1c52c08018c47e8bc53646a0e101` is an EOA,
  threshold is 2, signer count is 3, and testnet supply is 5 whOUR. Its owner
  retains single-key signer and threshold authority.
- Fresh `HourBridgeVault` and `WrappedHour` deployments now accept an explicit
  owner address, enforce at least three signers and a minimum 2-of-3 threshold,
  and require add-before-remove signer rotation. Base deployment scripts
  refuse an owner without contract code. These source changes do not alter
  either existing deployment.
- Do not deposit real HOUR into the old Base vault. Before a production
  bridge, deploy replacements with a Safe owner and independently custodied
  signers on both chains; then set the replacement Base vault fee-exempt and
  verify the exact addresses and policy from receipts. The old Base vault has
  no HOUR to migrate; the devnet whOUR is faucet/testnet supply only.

- The existing `HourToken` contract is **not modified or redeployed**. Its
  existing `isFeeExempt` mechanism is sufficient: the vault is marked fee-
  exempt so locks/releases move 1:1 without the 2/3/2% fee split.
- The deployed hOUR `WrappedHour` owner is a single EOA and can change the
  signer set and threshold. The deployed Base vault's owner is the CREATE2
  factory and is effectively unusable, so that signer set is frozen. Neither
  deployed contract currently has a properly configured Safe owner.
- Relayer automation (`npm run bridge:relay` in `witching-hour-token`) is
  implemented, but deliberately auto-confirms with only one signer. The
  second confirmation needed to reach threshold is a manual command
  (`bridge:confirm`) run with a different signer. Signers 1 and 2 still share
  a CDP API key, so this operator workflow does not guarantee independent
  custody if that shared key or relayer host is compromised.
- **Signer-3's custody is now independent of CDP**, as of 2026-10-14.
  `scripts/relayer/export-signer-key.mjs` exported it (RSA-4096/OAEP-
  SHA256, same scheme as the CDP SDK's own export flow, run by Fletcher
  directly since key export is blocked for an agent); the key was
  verified (via `scripts/relayer/verify-local-key.mjs`) to correctly
  derive `0x1e3099CdACFC8ecF0Dda292436bf4e64A71Fa273` before the local
  copy was deleted, and the key now lives in Bitwarden. Importing it
  into a mobile wallet app (Trust Wallet, MetaMask) did not work after
  several attempts and was deliberately not pursued further — a wallet
  app isn't required: `manual-confirm.mjs --local-key-file=<path>`
  signs directly from a key file pulled out of Bitwarden when needed.
  Signers 1 and 2 remain under the original shared CDP API key. Since the
  threshold is 2-of-3, those two can satisfy quorum without signer 3; the
  production signer set therefore does not yet provide independent 2-of-3
  custody.
- The full lock → relay → mint cycle was proved end-to-end for free on
  2026-10-13, using Base Sepolia (not mainnet) and the real hOUR Chain
  devnet. `WrappedHour` is deployed to the devnet at
  `0x3D641a2791533B4A0000345eA8d509d01E1ec301`.
- **`HourBridgeVault` is live on Base mainnet**, deployed 2026-10-13 at
  `0x2AcB172E1D3335B059a438Ea9060565aFcE76140` (tx
  [0x03b94c00...](https://basescan.org/tx/0x03b94c009c5b69179e919dd5fadbae2c48381f7ace99defc79aeef19d6897b46)),
  signed by `treasury` (CDP-managed) after Fletcher explicitly approved
  the funding source and amount. Verified on-chain: `threshold=2`,
  `hourToken` points at the real HOUR token, signers correctly
  registered. Cost ~0.0000092 ETH. `HourToken`'s code is untouched.
- **`setFeeExempt(vault, true)` called 2026-10-14**
  (tx [0x7c22c63a...](https://basescan.org/tx/0x7c22c63a48528088b43b48977cd439973002571b25c3d9f95b4ebd23d2fd9a7a)),
  using the `PRIVATE_KEY` already present in `witching-hour-token/.env`
  (confirmed to derive the token owner address, `0x52864a2E...`, before
  use). Verified on-chain: `isFeeExempt(vault) == true`. The vault can
  now lock/release real HOUR 1:1, without the normal 7% transfer fee.
- **Root-caused the gas bug, 2026-10-13: it's `eth_fillTransaction`, not
  `eth_estimateGas` itself.** Plain `eth_estimateGas` (with `from` set)
  returns a correct value (~121k for `confirmMint`). But any real signed
  write — via viem, or anything else building on a local account — calls
  `eth_fillTransaction` to fill gas/nonce/fee defaults, and that handler
  (`SetTxDefaults` in `cosmos/evm` v0.7.0's `rpc/backend/call_tx.go`,
  ~line 282) hardcodes `blockNr = 0` for its internal gas estimate —
  simulating against **genesis**, not current state. Since `WrappedHour`
  didn't exist at genesis, the simulated call hits an address with no
  code and "succeeds" almost for free (~24k gas), instead of running
  `confirmMint`'s actual logic. This is a genuine upstream `cosmos/evm`
  bug. Filed as [cosmos/evm#1322](https://github.com/cosmos/evm/issues/1322)
  (2026-10-13) — not fixed here, this repo's mitigation (explicit gas +
  receipt checks) stands regardless of upstream's response.
  The result: a silent out-of-gas revert that still returns a tx hash
  and looks successful until you check the receipt. Any EVM write
  against this chain should pass an explicit `gas` limit rather than
  trust auto-estimation, and should always check `receipt.status`, not just
  that a hash came back. This is a devnet-wide issue, not specific to
  the bridge contracts.
- **CDP's `sign transaction` endpoint can't sign a contract-CREATE
  transaction** (empty `to`); it only signs calls to an existing
  address. A CDP-signed deployment must go through a regular `to`-
  targeted call, e.g. the standard CREATE2 deployer proxy singleton
  (`0x4e59b44847b379578588920cA78FbF26c0B4956C`, deployed on Base,
  Base Sepolia, and most EVM chains).
- The devnet node (`whm-lnd-cloud`) went RPC-unresponsive after ~6h of
  continuous empty-block production — host memory crept up to hourd's
  cgroup cap (`MemoryHigh=640M`/`MemoryMax=768M`) and swap kept climbing.
  Restarting `hourd.service` recovered it with no state loss; LND/
  bitcoind on the same host were unaffected. Worth monitoring if this
  recurs — a single-validator devnet producing a block every ~2s with
  zero transactions has no reason to grow this fast, so the service may
  need a periodic restart or a tuned block time until investigated
  further.

# hOUR Chain genesis decision gate

Status: proposed recommendations; owner decisions required before a public
testnet with economic value or a mainnet launch.

This document turns the open decisions in ADR-0005 into explicit gates. It
does not freeze tokenomics, validator economics, or production cryptography.

## 1. Token model

The current chain documentation uses `ahbc` as an 18-decimal native denom,
while the separate HOUR ERC-20 and the proposed `whOUR` bridge have a different
role. The chain CLI still inherits several upstream example defaults, so
`ahbc` must not be treated as a final deployed token model yet.

Options to decide:

- Keep a native HBC gas/staking asset and keep HOUR as a separate bridged
  ecosystem token.
- Make HOUR the single economic asset on both networks, and specify how the
  Cosmos bank denom, EVM representation, fees, and bridge supply relate.
- Keep all testnet balances faucet-only with no market value, and defer the
  production asset model until the creator pilot and security review.

**Recommendation:** use a faucet-only testnet denom; do not assign market
value or launch economics to it. Before mainnet, prefer one canonical
economic asset unless a documented product requirement justifies two. Record
the relationship between the Base HOUR supply, the hOUR Chain representation,
IBC vouchers, and any native fee/staking denom before deploying contracts.

## 2. Validator model

Options include a permissioned validator set, open proof-of-stake, or a staged
model that begins permissioned and later opens after operations and economics
are proven.

**Recommendation:** use independent, permissioned operators for a public
testnet and no real rewards. Do not market that testnet as decentralized. A
mainnet PoS decision requires the token decision plus explicit validator
admission, minimum stake, rewards, slashing, unbonding, governance, key
rotation, and incident-recovery rules.

## 3. Post-quantum requirement

The accepted protocol requirement says post-quantum authorization is required
from genesis, but the selected Cosmos/CometBFT stack currently uses Ed25519
validator keys and secp256k1 EVM accounts. The ML-DSA event-signature profile
does not replace either consensus or EVM transaction authorization.

**Recommendation:** keep the disclosure strict and do not claim end-to-end
post-quantum security. Treat the current stack as an experimental devnet. A
public testnet may proceed only if its scope explicitly permits conventional
consensus/account keys and ADR-0002 is revised to make that a staged,
non-production exception. Otherwise, PQ consensus/account authorization is a
hard blocker, not a documentation checkbox.

## 4. Testnet gate

Before calling a network a public testnet, require:

- A multi-operator validator set with documented key custody and recovery.
- Reproducible genesis, binaries, upgrades, snapshots, and restart procedures.
- A successful two-chain ICS-20 transfer, including acknowledgement,
  timeout, and refund tests.
- Public RPC behind rate limits and abuse controls; validator P2P separated
  from administrative and signing interfaces.
- Resource and recovery evidence over a sustained run, not a single healthy
  process check.
- Clear faucet-only asset and PQ-risk disclosures.

## Owner decisions (recorded 2026-10-20)

1. **Token model: faucet-only now, HOUR-as-single-asset is the target.**
   No market value or launch economics on the current testnet. The
   long-term direction is HOUR (not a separate HBC denom) as the one
   canonical economic asset across Base and hOUR Chain. See
   [Target token relationship](#target-token-relationship-hour-as-the-single-asset)
   below for what that requires before it can be deployed; `ahbc` stays an
   unpriced placeholder denom until that design is finished.
2. **Validator model: staged.** Start with permissioned, independently
   operated validators and no real rewards (not marketed as
   decentralized). Build the open-PoS admission criteria (stake minimum,
   rewards, slashing, unbonding) now so the network can open up later
   without a second redesign. See
   [Staged validator path](#staged-validator-path) below.
3. **Post-quantum requirement: kept as a hard blocker.** No public
   testnet — regardless of token or validator readiness — until hOUR
   Chain has actual PQ-capable authorization on validator consensus keys
   and EVM account keys, not just the existing ML-DSA event-signature
   layer. ADR-0002 is not revised. See
   [PQ unblock plan](#pq-unblock-plan) below for what closes this gate.

## Target token relationship (HOUR as the single asset)

Not yet specified — this is new design work, not an existing decision.
Before HOUR (rather than a separate `ahbc`/HBC denom) can be the chain's
native gas/staking asset, this document needs an owner-reviewed answer
for each of:

- How Base `HourToken` supply (mainnet `0xFC1c0FFF99845676A588CE21c28C4859F3035866`)
  maps to hOUR Chain's native bank denom — 1:1 via the existing
  `HourBridgeVault`/`WrappedHour` bridge (ADR-0007), or a separate
  issuance.
- Whether the bridged `whOUR` ERC-20 (devnet:
  `0x3D641a2791533B4A0000345eA8d509d01E1ec301`) and the native bank denom
  are the same asset (via `x/evm` precompile / ERC-20 module pairing) or
  two representations that need their own peg logic.
- Whether gas and staking are paid in the same denom as the bridged
  asset, or whether a thin native gas denom survives alongside HOUR for
  fee-market stability (the ADR-0007 bridge is explicitly **not**
  trust-minimized — no light client, no fraud proof — so staking the
  chain's security on a multisig-bridged supply needs its own risk
  review before it's treated as load-bearing).
- IBC voucher treatment: whether `ibc/...` vouchers of bridged HOUR get
  unwrapped to the native denom automatically or require a separate
  claim step.

This is tokenomics/design work, not a code task — flag for review once
drafted rather than deploying contracts against it.

## Staged validator path

Phase 1 (now): permissioned, independently operated validators, no
rewards, explicit "not decentralized" disclosure on any public-facing
testnet description.

Phase 2 (prep now, activate later) needs, before it can open:

- Minimum stake amount and bond denom (depends on the token decision
  above — can't be priced in `ahbc` if `ahbc` isn't the final asset).
- Admission criteria for new validators (self-bond minimum, commission
  bounds, uptime/slashing conditions).
- Slashing conditions (double-sign, downtime) and unbonding period.
- Validator-set governance: how new validators get admitted to a
  previously-permissioned set without a hard fork.
- Key rotation / incident recovery procedure for validator operators
  (ties into HBC-010, still an open tracking issue).

## PQ unblock plan

What currently exists: an ML-DSA event-signature profile for protocol
events (ADR-0002 follow-up item, prototyped), and, as of 2026-10-20, an
additive ML-DSA consensus-checkpoint co-signing layer (see below). What's
still missing and gates any public testnet:

1. Validator consensus authorization still signs blocks with Ed25519
   (CometBFT default) — the checkpoint layer below attests blocks
   independently, but does not replace Ed25519 as the actual consensus
   signature.
2. EVM accounts (bridge signers, user transactions) still authorize with
   secp256k1 — no PQ or composite conventional+PQC EVM account scheme
   is live yet, but the account-side extension point is built: see
   `account-abstraction/contracts/pqc/PqcAccount.sol` (branch
   `pqc-account`, pushed to the project's own fork, not upstream
   eth-infinitism) — overrides `BaseAccount._validateSignature` to
   call a pluggable `IMlDsa65Verifier` instead of `ECDSA.recover`, with
   no raw-EOA owner shortcut (execute/upgrade/withdraw only reachable
   through a validated UserOperation). Unit-tested (6/6) against a
   mock verifier for routing/access-control correctness — not a test
   of real ML-DSA-65 verification.

   The real verifier is `ZKNoxHQ/ETHDILITHIUM`'s `ZKNOX_dilithium65.sol`
   on its `mldsa-65` branch specifically (its default `main` branch is
   ML-DSA-44, k=4/l=4, a different and lower NIST security category —
   do not confuse the two). That contract has its own Foundry project,
   its own KAT/ACVP test vectors (22/22 pass when run locally, including
   the real NIST ML-DSA-65 known-answer and ACVP vectors), and is
   explicitly marked "experimental, not audited: DO NOT USE IN
   PRODUCTION, LOSS OF FUNDS WILL OCCUR" by its own authors as of the
   2026-09-16 commit.

   **Deployed to the devnet, 2026-10-20** (Fletcher ran the broadcasts
   himself, after this session's sandbox correctly blocked both
   installing Foundry and broadcasting transactions on its own — see
   `deploy/devnet/pqc-verifier-deployments.json` for full addresses/tx
   hashes):
   - `F1600Helper` (the Keccak-f[1600] helper `ZKNOX_dilithium65` binds
     to by code hash): `0x07Aa076883658B7ED99D25b1E6685808372C8fE2`.
   - `ZKNOX_dilithium65`: `0xe2F81B30E1D47DFFdBb6aB41Ec5f0572705b026d`
     (block 89967). Deployed via plain `CREATE`, not the script's
     default `CREATE2` — the devnet has no deterministic-deployer-proxy
     singleton at `0x4e59b448...` the way Base/Ethereum do.
   - The on-chain self-check confirmed `NIST KAT verification: true` in
     local simulation before broadcast. The follow-up broadcast of that
     same check (writing a demo key via `setKey`) failed on this devnet
     with an "exceeds block gas limit" RPC error — not because the real
     cost is too high (`cast estimate` of `setKey` with a correctly-sized
     ~40,320-byte expanded-key blob: 8,446,329 gas, under the devnet's
     10,000,000 limit) but consistent with the `cosmos/evm`
     auto-gas-estimation bug ADR-0007 already documents (estimates
     simulate against genesis state, where a just-deployed contract
     doesn't exist). Real `setKey`/`verify` calls need an explicit
     `--gas-limit`, not auto-estimation, same as any EVM write against
     this chain.
   - **Interface correction**: `setKey`'s `pubkey` parameter is the
     *pre-expanded* (`A_hat || t1 || tr`) blob, ~40,320 bytes — not the
     raw ~1952-byte FIPS 204 public key. `IMlDsa65Verifier.sol` on the
     `account-abstraction` fork's `pqc-account` branch now documents
     this correctly (fixed 2026-10-20).

   **Real account created and validated end-to-end, 2026-10-21.**
   `EntryPoint` and `PqcAccountFactory` deployed (plain `CREATE`, same
   no-deterministic-deployer-proxy reason as above):
   `EntryPoint` `0x20c3620358921b0631B2c3e2F72A905A6246cF91`,
   `PqcAccountFactory` `0x846A221D5d86A5c4fFbb1B64d3a5015714D19AE4`.
   A real `PqcAccount` (`0x716F45e9De84C0b40291a14fba9421d50c33a975`)
   was created via a real signed `UserOperation` — real ML-DSA-65
   keypair, real `handleOps` broadcast
   (`0x6882c00e3c3a010cd09c8af0feb9a8a686c8e41966d9c1ae8204edd57e7341a3`,
   status 1, 141-byte deployed proxy code) — against the live devnet's
   real deployed verifier, not a mock. Full details, including the two
   root causes that had to be fixed first (the devnet's genesis-pinned
   EVM gas ceiling, and UserOp prefund under-funding), in
   `deploy/devnet/pqc-verifier-deployments.json`'s `pqcAccountCreation`
   entry. Run directly on `whm-lnd-cloud` itself (scripts/artifacts
   synced over SSH, executed against the box's own local Tailscale RPC)
   — no desktop SSH tunnel involved, since this session's sandbox can
   reach that droplet directly.

   For Base-mainnet bridge signers specifically, a custom ML-DSA
   precompile on hOUR Chain's own `cosmos/evm` backport remains the
   better long-term answer regardless (cheaper gas, ours to
   write/review) — still not built.
3. ADR-0002's own follow-up list (benchmark PQC costs, independent
   cryptographic review) is still open.

Decision recorded 2026-10-20: validator-consensus PQ is staged — start
with (1a) below now, (1b) is the end target.

### 1a. Built now: additive ML-DSA checkpoint co-signing

`packages/pqc-checkpoint/` (new): each validator operator independently
ML-DSA-65-signs a canonical `{chainId, height, blockHash, appHash, time}`
envelope for a given block (reusing `packages/pqc-profile`'s existing
sign/verify primitives and domain-separated canonicalization). A
separate verifier checks a quorum of these signatures against the live
CometBFT validator set's voting power, using the standard BFT `>2/3`
threshold. This does **not** touch consensus signing — Ed25519 still
produces the actual block signatures — it adds an independently
PQ-verifiable attestation on top. Proven end-to-end against the live
devnet node (`whm-lnd-cloud`, height 83317, chain `hour_9000-1`,
single-validator quorum of 1): see `packages/pqc-checkpoint/test/` for
the unit-tested quorum math (including the exactly-2/3-is-not-quorum
edge case) and `bin/sign-checkpoint.mjs` / `bin/verify-checkpoint.mjs`
for the live CLI path. Not yet deployed as a running service — the
signer's ML-DSA private key is a new validator-operator credential and
should get the same custody/rotation treatment as the existing
`priv_validator_key.json` (ties into HBC-010) before it runs
unattended on shared infra.

### 1b. End target: fork cometbft + cosmos-sdk crypto codecs

`cometbft@v0.39.3`'s `crypto/encoding/codec.go` (`PubKeyToProto` /
`PubKeyFromProto` / `PubKeyFromTypeAndBytes`) and cosmos-sdk's parallel
`crypto/codec` are closed Go type switches over
`ed25519.PubKey | secp256k1.PubKey | bls12381.PubKey` — not a pluggable
registry. Making ML-DSA an actual consensus signature (not just an
additive checkpoint) means patching both: add a `PublicKey_Mldsa` proto
case, regenerate, and wire a new `crypto/mldsa` package (trivial — ML-DSA
signing/verification is a plain Go interface; `cloudflare/circl@v1.5.0`'s
`sign/mldsa/mldsa65` already matches the `ML-DSA-65` identifier in
`SIGNATURE-CANONICALIZATION.md` and needs no toolchain bump). The real
cost is maintaining this as a permanent fork: light clients, explorers,
and any tooling built against stock CometBFT won't understand the new
pubkey type without the same patch.

**CometBFT side started, 2026-10-21** — fork at
`github.com/witchinghourartcollective/cometbft`, branch
`mldsa65-consensus` (PR not yet opened,
https://github.com/witchinghourartcollective/cometbft/pull/new/mldsa65-consensus).
Landed:
- `crypto/mldsa65` (new): implements `crypto.PubKey`/`crypto.PrivKey` for
  FIPS 204 ML-DSA-65 via `cloudflare/circl` (pinned direct to v1.5.0;
  Go's MVS bumped the actual resolved version to v1.6.1 during build —
  still `go 1.22.0`-compatible, no toolchain-bump issue).
- `proto/tendermint/crypto/keys.proto` / `keys.pb.go`: added
  `PublicKey.mldsa65` as oneof field 4, alongside the existing
  `ed25519`/`secp256k1`/`bls12381`. `keys.pb.go` was **hand-patched**,
  not regenerated — no `buf`/`protoc-gen-gogofaster` toolchain available
  in the environment this was built in. The gzipped `FileDescriptor`
  bytes are stale as a result; this only affects reflection/descriptor-
  based introspection (e.g. grpc-reflection), not the actual
  `Marshal`/`Unmarshal`/`Compare`/`Equal` methods consensus uses — but
  run a real `make proto-gen` before trusting anything that depends on
  the descriptor.
- `crypto/encoding/codec.go`: added the `mldsa65` case to all three
  previously-closed switches.
- `types/signable.go`: `MaxSignatureSize` now accounts for ML-DSA-65's
  3309-byte signature (vs Ed25519's 64 bytes — a real ~52x bandwidth
  cost per vote/commit/proposal for any validator using this key type;
  not yet evaluated at any real validator-set size).

Verified for real on `whm-lnd-cloud` (go1.25.3, the toolchain this
module's `go.mod` actually requires — this session's own sandbox only
had go1.22.2 with no network to fetch 1.25, so verification had to
happen on that droplet, not locally): `go build ./...` across the
*entire* forked module succeeds, and `crypto/mldsa65`'s test suite
passes end-to-end — sign/verify, `PubKeyToProto`/`FromProto` round-trip,
`PubKeyFromTypeAndBytes`, and a real proto **wire** marshal/unmarshal
round-trip (not just an in-memory one, which would have missed a
hand-patching mistake in the generated code).

**cosmos-sdk side also landed, 2026-10-21** — fork at
`github.com/witchinghourartcollective/cosmos-sdk`, branch
`mldsa65-consensus` (PR not yet opened,
https://github.com/witchinghourartcollective/cosmos-sdk/pull/new/mldsa65-consensus),
with a matching `replace` of the cometbft dependency onto this project's
own fork above (real GitHub-resolved pseudo-version, kept bumped to the
latest commit there). Landed:
- `proto/cosmos/crypto/mldsa65/keys.proto` +
  `crypto/keys/mldsa65/keys.pb.go`: new standalone `PubKey`/`PrivKey`
  proto messages, mirroring `crypto/keys/bls12_381`'s shape. Same
  hand-patched-not-regenerated caveat as the cometbft side.
- `crypto/keys/mldsa65/mldsa65.go`: `cryptotypes.PubKey`/`PrivKey` +
  `codec.AminoMarshaler` implementation, mirroring `crypto/keys/ed25519`'s
  always-on pattern (ML-DSA-65 is pure Go — no cgo build-tag gate needed,
  unlike `bls12_381`).
- `crypto/codec/cmt.go`: added the `mldsa65` case to the previously-closed
  `FromCmtProtoPublicKey`/`ToCmtProtoPublicKey` switches.
- `crypto/codec/proto.go`: registered `mldsa65.PubKey`/`PrivKey` as
  `Any`-packable implementations of `cryptotypes.PubKey`/`PrivKey` — this
  is the actual mechanism `x/staking`'s `MsgCreateValidator` uses for its
  validator pubkey field (confirmed with a real
  `registry.UnpackAny` round-trip test, not just an in-memory assertion).

Both forks' full modules build clean together on `whm-lnd-cloud`
(go1.25.3), and this package's tests pass end-to-end too: sign/verify,
`ToCmtProtoPublicKey`/`FromCmtProtoPublicKey` round-trip, a full
`ToCmtPubKeyInterface`/`FromCmtPubKeyInterface` round-trip through both
forks together, a real proto wire marshal/unmarshal round-trip, and the
`registry.UnpackAny` test above.

**Two more real gaps found by actually tracing the validator-creation
path (not just reading docs), both now closed:**
- `privval.FilePV`'s key generation turned out to **not** need a patch —
  `NewFilePV(privKey crypto.PrivKey, ...)` was already fully generic;
  only the convenience wrapper `GenFilePV()` hardcodes
  `ed25519.GenPrivKey()`. Proven with a real JSON save/load round-trip
  test (`privval/mldsa65_filepv_test.go`): `hourd init` can just call
  `privval.NewFilePV(mldsa65.GenPrivKey(), ...)` directly, no cometbft
  core patch needed for this piece.
- `x/staking`'s `MsgCreateValidator` handler (traced directly in
  `x/staking/keeper/msg_server.go`) checks the declared pubkey's
  `Type()` against the **live consensus params**'
  `Validator.PubKeyTypes` list — and CometBFT's own
  `ConsensusParams.ValidateBasic` separately rejects any
  `PubKeyTypes` entry not present in the closed
  `types.ABCIPubKeyTypesToNames` map with "is an unknown pubkey type".
  This *was* a real, necessary patch (`types/params.go`, cometbft fork)
  — without it, a fresh genesis listing `"mldsa65"` in
  `consensus.params.validator.pub_key_types` would fail validation
  before the chain could even start. Patched and verified with a real
  `ConsensusParams.ValidateBasic` call against an `mldsa65`-only
  `PubKeyTypes` list.

**Fresh devnet genesis: done and proven live, 2026-10-22.** A real,
isolated single-validator chain (`hour-pqc-test-1`, built and run on
`whm-lnd-cloud` at distinct ports, never touching the live devnet's
process, ports, or data) came up and produced real blocks whose
**consensus commit signatures are genuinely 3309 bytes** — the real
ML-DSA-65 signature size, not Ed25519's 64. Confirmed via the live
node's own RPC (`/status` showing `catching_up: false` and the
validator's address matching the generated `mldsa65` key; `/commit`
showing the 3309-byte signature) and its log (real `received
proposal`/`finalizing commit of block`/`committed state` lines at
increasing heights, proposed by that same validator address). This is
the full 1b end target working, not just unit-tested in isolation.

Two more real bugs were found and fixed getting here, beyond the
crypto-type plumbing above:
- `cosmos-sdk/crypto/keys/mldsa65`'s `fileDescriptor` was a placeholder
  (`[]byte{}`), which I'd assumed only mattered for reflection-based
  tooling. It actually broke real genesis bootstrapping: this app's
  `app.go` enables `SIGN_MODE_TEXTUAL`, which needs real protobuf
  descriptor info to resolve `Any`-packed messages, and the placeholder
  caused a genesis gentx carrying an `mldsa65` validator pubkey to fail
  with an opaque `"EOF: tx parse error"` deep inside baseapp's
  `DeliverTx`. Found by bisecting against an otherwise-identical
  Ed25519 control genesis that bootstrapped fine with the same
  placeholder-descriptor pattern unused. Fixed by generating a real
  descriptor with plain `protoc --descriptor_set_out --include_imports`
  (no `buf`/`protoc-gen-gogofaster` needed for just this part) and
  splicing the extracted, gzipped `FileDescriptorProto` in — matching
  the hand-written Marshal/Unmarshal code that was already correct.
- `cosmos/evm` uses `AttoPowerReduction` (1e18, matching 18-decimal EVM
  tokens) as the real consensus-power divisor — not the
  `sdk.DefaultPowerReduction` (1,000,000) printed in a misleadingly
  generic cosmos-sdk error message ("validator set is empty... please
  ensure at least one validator is initialized with a delegation
  greater than or equal to the DefaultPowerReduction"). Self-delegating
  amounts well below 1e18 silently rounded down to zero consensus
  power via integer division, so the validator never entered the
  active set — nothing to do with ML-DSA at all once found, but cost
  real time to diagnose precisely because the error text points at the
  wrong constant. Confirmed directly by a temporary debug patch in
  `ApplyAndReturnValidatorSetUpdates` showing `powerReduction =
  1000000000000000000` and the validator's computed `consPower = 0` at
  5e16 tokens; fixed by self-delegating 5e18.

Both repos' branches: pushed and up to date as of this entry —
`witchinghourartcollective/cometbft@mldsa65-consensus` and
`witchinghourartcollective/cosmos-sdk@mldsa65-consensus`.

**What's left before this could matter for anything beyond a
proof-of-concept devnet:**
- A real `make proto-gen`/`buf generate` pass to replace every
  hand-patched generated file with properly toolchain-generated ones
  (the hand patches are verified correct by tests, but hand-patching
  generated code is not a sustainable practice for a real fork).
- The ~52x signature-size bandwidth cost (3309 vs 64 bytes per vote/
  commit/proposal) has only been exercised at single-validator scale;
  not evaluated for a real multi-validator set.
- No independent cryptographic review of this integration (separate
  from ADR-0002's existing ask for a review of the ML-DSA-65 *scheme*
  itself, via `cloudflare/circl`).
**Live devnet migrated, 2026-10-22.** `chain/go.mod`'s `cometbft`/
`cosmos-sdk` replace directives now permanently point at the
`mldsa65-consensus` fork branches (same commits proven on the isolated
`hour-pqc-test-1` chain above). The real `hour_9000-1` devnet on
`whm-lnd-cloud` was migrated in place via `deploy/devnet/migrate-to-mldsa65.sh`:
`hourd export --for-zero-height` to dump the full application state
(every contract, every balance, the bridge vault, the PQC verifier —
everything), spliced a fresh `mldsa65` validator into that exported
state (new key, same operator address, same token/commission/status
fields), reset `consensus.params.validator.pub_key_types` to
`["mldsa65"]`, and restarted the service on the new binary + genesis.
**Nothing was lost** — confirmed post-migration via `eth_getCode` on
the `ZKNOX_dilithium65` verifier address (bytecode intact) and
`eth_getBalance` on the deployer account (balance intact). The old
binary and full pre-migration data directory were backed up to
`/root/hourd-mldsa65-migration/` on the droplet before anything was
touched. Live confirmation: `validator_info.address` and the block
`proposer` both show the new key's address
(`529A0567B7B32E68E58A08D63405BE9ABDFF103B`), and `/commit` shows a
real 3309-byte signature — Ed25519 is no longer used for consensus on
this chain at all.

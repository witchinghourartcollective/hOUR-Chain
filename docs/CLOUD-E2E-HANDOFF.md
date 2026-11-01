# Cloud end-to-end test handoff

Prepared 2026-11-01. This is an execution plan, not a deployment attestation.
Keep services on DigitalOcean; a workstation is an authenticated control and test
client. Re-read current main and repository AGENTS.md before continuing.

## Repositories and starting points

- witchinghourartcollective/hOUR-Chain: ADR-0008, LIVE-READINESS.md,
  PQC-EVIDENCE-ROLLOUT.md, scripts/check-runtime.mjs.
- witchinghourartcollective/hour-chain-filecoin: docs/STORAGE-RUNTIME.md,
  scripts/calibration-canary.mjs and the retrieval-only recovery command when merged.
- witchinghourartcollective/hour-chain-solana: docs/LAUNCH-GATES.md and active
  .github/workflows/github-actions-ci.yml. The old README CI activation warning is
  stale; inspect actual workflow runs.
- witchinghourartcollective/whm-infra: scripts/collect-hour-runtime.sh and
  apps/hour-chain-signer/deployment.yaml. Discover actual Flux paths before edits.

Use existing clean clones or isolated worktrees; never reset local work. Record
commit hashes before testing and image digests after deploying.

## 1. Read-only discovery before changing hosts

Use existing authorized SSH/kubeconfig/DO identities. Do not assume an old private
IP is the intended droplet. Never print secrets, kubeconfig, pod environments or
unfiltered application logs. Run the reviewed infra collector on the authorized
host/cloud runner:

```sh
bash scripts/collect-hour-runtime.sh
```

The script is in whm-infra. Store the report privately with a UTC timestamp.
Identify existing chain homes/genesis, PVCs, Flux revision, actual pod imageIDs,
signer health and runtime source. The signer manifest currently names
docker.io/library/hour-chain-signer:6e361ac with imagePullPolicy Never; prove that
image is present on every eligible node. Manifest presence is not deployment proof.
If authorized access fails, report the exact failure without credentials and keep
working on code/tests. Do not reinitialize a chain to work around missing access.

## 2. Candidate verification

Run in each indicated repository:

```sh
# hOUR-Chain: Node >=24.7 and Python 3
npm ci
npm run check

# hOUR-Chain/chain: use the version in go.mod (currently Go 1.26.0)
go build -o build/hourd ./cmd/evmd
go test ./cmd/evmd/...

# hour-chain-filecoin: dependency-free package
npm test

# hour-chain-solana: Rust + Agave SBF tools
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo build-sbf --manifest-path programs/hour-consent/Cargo.toml
test -s target/deploy/hour_consent.so
cargo test --workspace

# hour-chain-solana/sdk/ts
npm ci
npm test
```

Run groups from their own directory, not as one pasted shell block. LiteSVM can
skip without a built .so; verify the artifact and actual execution. Inspect current
CI results and distinguish local test results from CI results.

## 3. Persistent test runtime

Prepare a reproducible isolated hourd image/workload with private RPC access,
persistent state, non-default test keys and an explicit test genesis. Discover any
existing HBC deployment first. Never expose devnet.sh's known test mnemonics/test
keyring or use its overwrite option on an existing home. Keep the PQ signer
internal; test sign/verify with synthetic data and record the running source/image.
Do not substitute classical signatures for unavailable PQ operations.

Connect the evidence consumer to a synchronous authorized historical-key resolver
with subject/epoch/revocation rules. Load authorization data before verification;
the resolver must not return a Promise. Persist pinned heads independently of
archived bytes. A signed timestamp is not externally verified trusted time.

## 4. Filecoin Calibration canary and recovery

In the consuming private service, pin a reviewed compatible Synapse SDK v2 and
lockfile; initialize it through a managed Filecoin transaction signer. The existing
ML-DSA event signer is not automatically a Filecoin transaction signer. Verify chain
314159, testnet assets, payment/deposit/allowance requirements and a capped policy.
Do not auto-fund, approve unbounded allowances or use mainnet funds.

After payment setup is explicitly resolved, execute once:

```sh
node scripts/calibration-canary.mjs /secure/managed-synapse-factory.mjs /secure/new-canary-receipt.json
```

Keep the receipt on persistent private storage independently of the archive. Confirm
two distinct provider copies and record provider/data-set/piece identifiers and
independent commitment/PDP evidence. Restart only the isolated test worker, then run
the retrieval-only command, when available:

```sh
node scripts/calibration-retrieve.mjs /secure/managed-synapse-factory.mjs /secure/new-canary-receipt.json
```

Never rerun upload to check retrieval. Reconcile failed/partial uploads using their
saved receipt/uploadResult before another attempt. A successful SDK result and
immediate retrieval do not establish long-term retention or PDP. Test public bytes
first; encrypt private creator evidence and keep recovery keys separate.

## 5. Solana devnet and Cosmos acceptance

Provision a managed devnet deployment signer and actual program address; replace
the placeholder consistently. Record cluster genesis hash, program ID, artifact
digest, deployment transaction and upgrade authority. Do not commit keypairs or
export production signer keys.

First prove the raw-digest software-key prototype on devnet with synthetic consent.
Browser contributor consent requires full WebAuthn signed-message verification,
type/challenge/origin/RP hash, UP/UV, replay/counter policy, enrollment, rotation and
revocation. Do not label the raw-digest prototype browser passkey approval.

Implement an idempotent DO adapter and deployed Cosmos acceptance state. Verify
finalized Solana account ownership, program version/layout, release/split version,
contributor identity, evidence hash, nonce/expiry and revocation. Bind accepted
records to independently verified PQ evidence and Filecoin receipts. A transaction
hash alone is insufficient.

## 6. One synthetic release: acceptance criteria

- Preserve exact signed evidence bytes and independently pin the evidence/archive heads.
- Upload a canary and verify retrieval against the independent receipt.
- Record a devnet consent referencing the same release/split/evidence.
- Accept the verified consent/evidence reference in deployed Cosmos state.
- Restart the isolated adapter, retrieve again and resubmit the same observation.
- Show no duplicate acceptance; reject changed bytes, unauthorized/revoked keys,
  wrong program/cluster, expired or replayed consent and mismatched release/splits.
- Save UTC timestamps, commits/images, program addresses, transaction hashes,
  storage receipts and read-back results. Mark each gate PASS/BLOCKED/NOT RUN.

This completes only the technical evidence/consent/acceptance loop. Complete browser
approval and settlement separately before calling a creator-rights pilot complete.
For settlement, simulate then use approved test assets and link the execution receipt
to the accepted consent. A Base ERC-20 address does not prove royalty settlement.

## 7. IBC as a separate route

Start with one compatible Cosmos test counterparty. Verify relayer compatibility
with ibc-go v11 and eth_secp256k1, managed funded test keys and active clients.
Record both chain/client/connection/port/channel IDs and send/receive/acknowledgement,
return and timeout evidence. No droplet or RPC watcher creates a Solana/Filecoin IBC
light client. Do not label adapter ingestion as IBC.

Copy scripts/runtime-config.example.json into a private non-secret config and fill
observed endpoints/IDs; never put credentials in it:

```sh
node scripts/check-runtime.mjs /secure/non-secret-runtime-config.json
```

This checker includes IBC and Base-mainnet probes; an unfinished route will fail.
Report individual results. Do not relax checks or invent channel IDs to make the
aggregate pass. Endpoint success is not packet delivery or creator workflow proof.

## Completion report

Return changed repositories/PRs, test results, observed live test receipts, the
smallest remaining blocker and exactly which owner action it needs. Continue all
independent preparation when one gate is blocked. No live trading changes, bridge
funding, token migration or public mainnet launch is part of this handoff.

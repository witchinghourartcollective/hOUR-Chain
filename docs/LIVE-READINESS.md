# hOUR Chain launch readiness — 2026-11-01

This is a source audit, not a live-host attestation. Solana is restored as an active
consent/attestation workstream by ADR-0008. A public pilot/testnet comes before a
mainnet launch. Scope estimates below are sequencing aids, not launch promises.

## Findings and missing evidence

| Component | Found in source | Missing before a live pilot |
| --- | --- | --- |
| Cosmos EVM | chain/app.go wires IBC v1/v2 transfer, ERC20 middleware and Tendermint client; chain/go.mod pins cosmos/evm 0.7.0, SDK 0.54.3, ibc-go 11, Go 1.26.0 | Successful Go build/tests; reproducible node image; persistent DO deployment; agreed genesis, validator set and custody; actual RPC/REST endpoints; backups/restore; token/fee policy; deployed rights/consent state |
| Solana | Rust RecordConsent program, TypeScript SDK, replay/expiry and raw P-256 checks | Real WebAuthn signed-data/challenge/origin/rpId/UP/UV verification; identity enrollment/rotation/revocation; real program ID and funded managed deployment signer; candidate Rust/SBF/LiteSVM CI (latest main run passed); devnet transaction and Cosmos ingestion; upgrade authority and review |
| Filecoin | Manifest and SHA-512 checkpoint utilities; injected Synapse v2 upload/download adapter with round-trip digest check | SDK version pinned in consuming service; managed signer integration; explicit Calibration/mainnet selection; approved storage budget and funding; payment/deposit/allowance setup; actual upload/replicas/confirmation and retrieval receipt; encryption/key recovery; retention/renewal and canary |
| Base | witching-hour-token README names Base 8453 token 0xFC1c0FFF99845676A588CE21c28C4859F3035866; app exports same address | Current on-chain state verification; deployed royalty/bridge contract addresses and source verification; signer/owner custody; funded simulation and settled receipt linked to consent. Token presence alone does not complete settlement |
| IBC | Transfer routing in the Cosmos application | Named counterparties; compatible client(s); relayer binary compatibility with ibc-go v11 and eth_secp256k1; funded managed relayer keys; client/connection/channel state; proof of packet receive/ack/return and timeout; expiry monitoring |
| DO/k3s | whm-infra Flux follows main; internal signer uses locally preloaded image and imagePullPolicy Never | Authenticated runtime access, actual node/pod/Flux state; HBC node, Filecoin worker and relayer workloads; persistent storage sizing, network policy, restart/restore and alerts. Local-only images must exist on every eligible node or use a verified registry image |

The Base token repository additionally contains HourBridgeVault and WrappedHour
contracts and a RoyaltySettlement draft. HourBridgeVault explicitly uses a trusted
multisig model; that is not an IBC light-client connection. Do not assume a script or
contract source has been deployed. The current token README describes trading as
disabled and liquidity not yet added; re-query the chain before reporting live state.

## What the owner needs to provide or decide

1. Attach a cloud execution environment with authorized DO/SSH or Kubernetes access
   and permission to the target droplets. Keep keys in the environment secret manager;
   never paste wallet seeds, SSH private keys or SOPS private keys into chat. This
   session has GitHub connector access, but no DO connector, kubectl, SSH identity,
   Rust compiler or Docker runtime. A Go 1.26 toolchain was subsequently installed
   in this cloud workspace to diagnose and fix the Cosmos build. An existing whm-ops GitOps route
   exists, but its report endpoint returned HTTP 403 / Cloudflare code 1010 to this
   session. Restore authorized cloud access to that route or attach a cloud executor.
2. Connect the intended hOUR blockchain GitHub organization, or provide its exact
   URL if it differs from the accessible owners. The connected repository search
   currently exposes witchinghourartcollective and Witching-Hour-Music repositories.
   Do not transfer repositories speculatively.
3. Identify the managed deployment/relayer signer accounts and their allowed network,
   budget and custody policy. Start with Solana devnet and Filecoin Calibration using
   test assets; mainnet recurring storage costs and token movement need separate
   explicit amounts. The existing event-envelope ML-DSA signer is not automatically
   a Solana or Filecoin transaction signer.
4. Select the first creator release and collaborating approvers. Agree the initial
   validator/token/fee model before calling the sovereign L1 a public production chain.

## This week

- Today: establish host access; run whm-infra's read-only collection script; identify
  existing HBC processes and avoid reinitializing any chain. Confirm exact live contract
  and program addresses. Read ADR-0008 and this checklist.
- Next: compile and test hourd on a Go 1.26 runner; prepare a persistent isolated test
  deployment with new test-only keys. Never expose chain/devnet.sh with known test
  mnemonics or the test keyring to the Internet; never run its overwrite option on an
  existing chain home. Add build/restore checks before enabling Flux workloads.
- Filecoin: initialize a pinned Synapse SDK with the managed signer, complete testnet
  payment setup, upload encrypted/public canary bytes with the storage adapter, persist
  its receipt independently, then re-fetch after a service restart. No retry loop that
  blindly repeats paid uploads after partial success.
- Solana: implement and test actual WebAuthn before using browser approvals for rights
  decisions. Build/test the existing raw-digest prototype on devnet in parallel; keep
  that test explicitly separate from production collaborator consent.
- IBC: choose a compatible Cosmos test counterparty, prove relayer/key compatibility,
  establish the actual route, and archive send/receive/acknowledgement/return/timeout
  evidence. Adapter routes to Solana/Filecoin/Base remain separate gates.
- End of week: report observed results with timestamps, deployed commit/image digests,
  program/contracts and receipts. A failed gate stays blocked; do not promise that all
  unimplemented mainnet/security work can be finished in one week.

## Short reading list

1. ADR-0008 (chain responsibilities and IBC boundary).
2. https://docs.filecoin.cloud/getting-started/ and the payment prerequisites it links.
3. https://hermes.informal.systems/documentation/commands/path-setup/index.html
4. hour-chain-solana/docs/spec.md section 2 (raw digest vs actual WebAuthn).

The proposed deployment check can be run with:

```sh
node scripts/check-runtime.mjs /secure/non-secret-runtime-config.json
```

It performs read-only RPC/REST checks and never sends transactions. Passing it is
endpoint evidence only; it does not prove a complete creator workflow or packet delivery.

# ADR-0004: Solana for consent and attestations, Base for payments

Status: Accepted (2026-10-02)
Amends: [ADR-0001](ADR-0001-phase-1-settlement.md) (the role of Solana only)

## Context

ADR-0001 made Base the canonical Phase 1 settlement network and listed Bitcoin
Lightning and Solana as "adapters." No Solana adapter code was ever written, and
the README described Solana as "implemented," which was inaccurate.

Meanwhile, the first real hOUR Chain workflow is **contributor consent**: each
collaborator approves their credit and split version, often without a crypto
wallet. Solana now offers three things that fit that workflow directly:

- native on-chain verification of P-256 (passkey / WebAuthn / FIDO2) signatures
  through the `Secp256r1SigVerify1111111111111111111111111` precompile (SIMD-0075);
- the Solana Attestation Service (SAS) as a neutral credential/attestation layer;
- fees and finality that make it practical to record every per-contributor,
  per-split-version approval, not just final payouts.

## Decision

1. **Solana is the primary chain for approvals/consent and attestations.**
   Passkey-verified consent records and creator-rights attestations (contributor
   credit, split version, consent receipt, settlement receipt) live on Solana.
   They're implemented in the public, dual-licensed (`MIT OR Apache-2.0`) repo
   [`hour-chain-solana`](https://github.com/witchinghourartcollective/hour-chain-solana)
   (the hOUR Solana Consent Kit).
2. **Base remains the payments/settlement chain.** Settlement instructions derived
   from a consented split version are simulated, explicitly approved, and paid on
   Base (USDC). The Base receipt is then attested back on Solana
   (`hour.settlement-receipt`) so consent and payment are linked.
3. **Filecoin remains the durable evidence/archive layer**, via
   [`hour-chain-filecoin`](https://github.com/witchinghourartcollective/hour-chain-filecoin).
4. **Lightning remains an adapter** (planned), unchanged by this ADR.
5. Cross-chain bridges remain out of scope as protocol dependencies. Solana and
   Base records are linked by hashes and attestations, not by bridged assets.

## Status of implementation (2026-10-02)

- `hour-chain-solana`: pre-alpha Milestone 1 scaffold. Native Rust program that
  records consent verified by the secp256r1 precompile, LiteSVM end-to-end tests,
  TS SDK, and spec. Not audited and not deployed. WebAuthn assertion format, the
  contributor registry, and on-chain SAS schemas are planned.
- Base payment integration and the settlement-receipt loop: planned.
- No Solana or Base contracts are deployed for hOUR Chain.

## Consequences

- README, SPEC, and ADR-0002 wording change from "Solana adapter" to
  "Solana = consent/attestations (in progress), Base = payments."
- `settlementNetwork: "solana"` in the event envelope schema stays valid for
  receipts that reference Solana records; payments default to `base`.
- Post-quantum boundary (ADR-0002) is unchanged: secp256r1, Solana Ed25519
  transactions, and Base are not quantum-safe. hOUR events may carry ML-DSA
  signatures off-chain, and verifiers MUST report those layers separately.

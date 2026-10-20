# ADR-0006: Clique TEE Network for TLS oracles, off-chain CLOB settlement, loyalty, and royalty distribution

Status: Proposed (2026-10-07)
Amends: none (additive to ADR-0001/ADR-0004/ADR-0005 settlement roles)

## Context

hOUR Chain's existing primitives cover identity, rights splits, provenance,
and settlement *instructions*, but have no way to:

1. Prove arbitrary off-chain data (stream stats, third-party platform
   activity, price/fill data) to a smart contract without trusting a single
   centralized relayer.
2. Settle trades against an off-chain central limit order book (CLOB) rather
   than an on-chain AMM.
3. Compute and distribute loyalty/incentive rewards based on off-chain
   engagement signals.
4. Route royalty settlement through the same verified-data path instead of a
   separate, bespoke mechanism.

[Clique Network](https://docs.clique.tech/) provides exactly this layer: a
TEE (Intel SGX) compute/coprocessor network with ZKP/MPC-backed **TLS
Oracles** (prove arbitrary TLS session data on-chain, with end-to-end
encrypted private-credential handling) and **Clique Wallet**, a TEE-custodied
embedded wallet with native support for **Solana, EVM (including Base), and
Hyperliquid**, exposed via a REST API suited to automated trading/treasury
operations. Hyperliquid is itself an off-chain CLOB perps/spot exchange with
on-chain settlement — it is the CLOB this ADR targets, accessed through
Clique Wallet rather than by hOUR Chain operating its own matching engine.

Clique has processed >$3.5B in on-chain transactions via this model
([source](https://pulse2.com/clique-blockchain-data-computing-company-secures-8-million/)).
Node SDK: [`@cliqueofficial/clique-client-sdk-node`](https://www.npmjs.com/package/@cliqueofficial/clique-client-sdk-node).

## Decision

1. **Clique TEE Network is the trust-minimized data/compute layer for hOUR
   Chain**, used for two things:
   - **TLS Oracles** — proving off-chain data (stream/engagement stats,
     third-party platform activity, CLOB fill/price data not otherwise
     available on-chain) into hOUR Chain events with a verifiable,
     TEE-notarized session, rather than a trusted relayer signature.
   - **Clique Wallet** — the TEE-custodied wallet used to hold funds and
     place/cancel orders on **Hyperliquid** (the off-chain CLOB) across
     **Solana, EVM/Base, and Hyperliquid** natively, via its REST API/SDK.
2. **Off-chain CLOB settlement (via Hyperliquid, through Clique Wallet) is a
   first-class settlement path**, alongside the existing Base/Solana/
   Lightning paths from ADR-0001/ADR-0004. A CLOB fill is captured as a
   TLS-oracle-attested event, then settled using the existing "deterministic
   settlement instructions and receipts" primitive (primitive #5) — the CLOB
   fill is just a new *trigger* for that primitive, not a new settlement
   primitive.
3. **Loyalty/incentive is a new protocol primitive**: TLS-oracle-attested
   engagement/activity signals (streaming stats, platform activity, CLOB
   trading volume) feed a points/reward computation that is itself a signed,
   append-only provenance event, settled the same way as royalties (below).
4. **Royalty distribution is explicitly in scope and routes through the same
   path**: a royalty-triggering event (a sale, a CLOB fill, a loyalty-reward
   vesting) produces a settlement instruction against the existing
   contributor/rights-split graph (primitive #3), using Clique TLS Oracle
   attestation wherever the triggering fact lives off-chain (e.g. a
   Hyperliquid fill, a stream-platform royalty report). Royalties are NOT
   excluded from this work — they are a primary consumer of it.
5. **Chain scope for this integration is Solana, EVM/Base, and Hyperliquid**,
   matching Clique Wallet's native support and hOUR Chain's existing chain
   roles (ADR-0004): Solana stays consent/attestations, Base stays payments,
   Hyperliquid is the new CLOB venue, all funded/custodied through one Clique
   Wallet per hOUR Chain-managed account.
6. Cross-chain bridging remains out of scope (unchanged from ADR-0001/0004):
   Clique Wallet's multi-chain support replaces the need for a bridge for
   this use case, since it holds native balances per chain rather than
   wrapping assets.

## Consequences

- New protocol primitives: **CLOB settlement trigger**, **loyalty/incentive
  event**. Royalty distribution is not a new primitive — it's a new trigger
  path into the existing settlement-instruction primitive.
- New dependency: `@cliqueofficial/clique-client-sdk-node` (Node/TS; Rust and
  Web variants also exist upstream if a non-Node adapter is needed later).
- hOUR Chain takes on a new external trust dependency (Clique's TEE
  attestation), parallel to, not replacing, its post-quantum signature
  profile (ADR-0002) — Clique attestations cover *off-chain data provenance*,
  not *on-chain authorization*, which stays ML-DSA/SLH-DSA signed per ADR-0002.
- `packages/clique-adapter` now has a **read-only TLS Oracle prototype** using
  the official Node SDK. It requires explicit trusted enclave and signer
  measurement allowlists and an exact HTTPS host allowlist. Clique Wallet
  balance and order methods remain unavailable in this adapter.
- No live Clique endpoint was configured or queried during the prototype
  work. The adapter's mocked tests prove query construction and fail-closed
  configuration only; they do not prove Clique service access, production
  attestation, or on-chain integration. Before a live query, configure a
  verified endpoint and independently confirm the trusted measurement values.
- Wire event envelopes to the platform only after a real SDK-verified TLS
  response has been captured and its freshness, replay, and schema rules are
  specified. The returned event helpers are payload builders, not settlement
  authorization.

## Open questions

- Loyalty reward computation formula (points-per-signal, vesting schedule) —
  not specified here; needs its own design pass once real engagement-signal
  sources are chosen.
- Whether loyalty rewards settle in HOUR token, USDC, or both.
- Audit path for the royalty-via-CLOB-fill trigger before it touches real
  funds — this ADR does not authorize live royalty settlement without that
  review.

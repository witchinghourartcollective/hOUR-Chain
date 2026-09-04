# hOUR Chain Protocol Specification

Status: Draft 0.2

## Purpose

hOUR Chain records who created a work, what evidence supports that claim, how rights and splits change over time, which actions were authorized, and how settlement can be verified.

## Actors

- Creator
- Contributor
- Rights administrator
- Verifier
- Protocol client
- Agent
- Settlement adapter
- Indexer
- Dispute reviewer

## Core records

### Identity

A stable creator identifier with one or more wallets, rotation history, recovery method, attestations, and privacy-preserving references to offchain evidence. Account identity MUST NOT be permanently coupled to a single public key.

### Work

A composition, recording, release, visual work, performance, stem, license, or other creative object. Records use globally recognized identifiers where available.

### Rights and split

Versioned contributor roles, ownership or participation percentages, effective dates, signatures, evidence references, and dispute state.

### Provenance event

An append-only signed event that changes or attests to protocol state. Events never overwrite history.

### Settlement instruction

A deterministic, signed calculation describing recipients, assets, amounts, network, source event, and approval requirements.

### Settlement receipt

A network receipt linked to the instruction, evidence version, finality status, and any reversal or dispute event.

## Canonical event envelope

See `specs/event-envelope.schema.json`.

Required semantics:

- globally unique event ID;
- protocol and schema versions;
- event type;
- actor and subject identifiers;
- issuance time;
- payload hash;
- evidence references;
- previous-event references where applicable;
- requested settlement network;
- signature algorithm identifier, signature-suite version, and verification material.

## Post-quantum security requirements

hOUR Chain SHALL provide native post-quantum authorization from genesis and SHALL remain cryptographically agile.

- User transactions, validators, governance, treasury, recovery, bridge administration, software releases, and upgrades MUST have PQC-capable authorization paths.
- ML-DSA is the leading transaction-signature candidate, subject to implementation review and benchmarking. Hash-based signatures such as SLH-DSA MAY protect infrequent root or recovery operations.
- High-impact operations SHOULD support composite conventional-plus-PQC authorization during transition and compatibility periods.
- Signature suites and address formats MUST be versioned, replaceable, and downgrade-resistant.
- Protocol-level key rotation and recovery MUST preserve stable identity without preserving a permanently exposed signing key.
- No component may claim end-to-end post-quantum security if a security-critical proof system, trusted setup, bridge, adapter, consensus path, or administrative control depends exclusively on quantum-vulnerable public-key cryptography.
- Implementations MUST use reviewed standards and libraries; custom cryptographic algorithms are prohibited.
- Transaction size, verification cost, state growth, denial-of-service limits, mobile usability, and hardware-signer support MUST be measured before selecting final parameter sets.

See `docs/ADR-0002-post-quantum-native-cryptography.md`.

## Phase 1 settlement

Base is canonical for EVM records and receipts. Lightning and Solana are adapter networks. Cross-chain bridges are not protocol dependencies in Phase 1. Because these settlement rails are not themselves fully post-quantum, Phase 1 MUST distinguish hOUR-signed PQC records from the quantum security of an external settlement receipt.

## State model

Clients submit signed events. The protocol validates schema, signature suite and version, authorization, causality, domain invariants, and downgrade protection. Accepted events update the verified read model. Settlement remains separately authorized and produces a receipt event.

## Non-goals

- New consensus or validator design in Phase 1.
- Custodial exchange.
- Guaranteed liquidity or token appreciation.
- Replacement of copyright registration, contracts, PROs, the MLC, or legal advice.
- Claims that PQC resolves existing wallet discovery, custody, reconciliation, or indexing defects.

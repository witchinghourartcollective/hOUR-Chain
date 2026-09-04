# hOUR Chain Protocol Specification

Status: Draft 0.1

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

A stable creator identifier with one or more wallets, rotation history, recovery method, attestations, and privacy-preserving references to offchain evidence.

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
- signature and verification material.

## Phase 1 settlement

Base is canonical for EVM records and receipts. Lightning and Solana are adapter networks. Cross-chain bridges are not protocol dependencies in Phase 1.

## State model

Clients submit signed events. The protocol validates schema, signature, authorization, causality, and domain invariants. Accepted events update the verified read model. Settlement remains separately authorized and produces a receipt event.

## Non-goals

- New consensus or validator design.
- Custodial exchange.
- Guaranteed liquidity or token appreciation.
- Replacement of copyright registration, contracts, PROs, the MLC, or legal advice.

# ADR-0002: Post-Quantum-Native Cryptography

- **Status:** Accepted
- **Date:** 2026-09-04
- **Scope:** hOUR Chain protocol, clients, adapters, administration, and future dedicated-chain components

## Decision

hOUR Chain will be post-quantum-native from genesis, not merely post-quantum-ready.

The protocol SHALL provide post-quantum-capable authorization for user transactions, validators, governance, treasury, recovery, bridge administration, software releases, and protocol upgrades. It SHALL support cryptographic agility, versioned signature suites, protocol-level key rotation, downgrade resistance, and migration between approved algorithms.

A component or deployment MUST NOT claim end-to-end post-quantum security while a security-critical proof, trusted setup, bridge, consensus path, administrator path, or settlement dependency relies exclusively on quantum-vulnerable public-key cryptography.

## Rationale

Elliptic-curve signatures and related ECDLP-based protocols are vulnerable to sufficiently capable fault-tolerant quantum computers using Shor's algorithm. Migration after deployment is especially difficult for persistent accounts, exposed or reused public keys, dormant assets, validators, governance, bridges, and privileged contract keys.

Designing algorithm identifiers, rotation, recovery, and migration into the protocol now is safer and less expensive than retrofitting them after identities, permissions, assets, and histories become dependent on fixed keys.

## Initial cryptographic direction

- Evaluate NIST-standardized ML-DSA as the leading general-purpose signature scheme.
- Evaluate hash-based SLH-DSA for infrequent root, recovery, or governance authorization.
- Use composite conventional-plus-PQC authorization where compatibility and defense in depth justify the added cost.
- Use only reviewed standards and implementations; do not invent cryptographic primitives.
- Keep signature algorithms and parameter sets replaceable through explicit, delayed, auditable governance.
- Separate user, validator, treasury, governance, recovery, bridge, deployment, and software-release keys.
- Require threshold control for high-impact authority.
- Preserve stable creator identity while allowing authorization keys to rotate.
- Treat external Base, Lightning, Solana, wallet, TLS, RPC, bridge, hardware-signer, and proof-system dependencies according to their actual security properties.

These choices are architectural requirements, not final parameter selections. Benchmarks and independent review are required before implementation profiles are frozen.

## Threat classes

- **On-spend:** a public key becomes visible while a transaction awaits settlement.
- **At-rest:** a public key remains exposed or reused long enough to be attacked.
- **On-setup:** a fixed public cryptographic parameter can be attacked once to create a reusable exploit.
- **Systemic authority:** validator, governance, treasury, bridge, or upgrade keys are compromised.
- **Migration failure:** users or dormant assets cannot rotate before a vulnerable suite is retired.
- **Implementation failure:** a PQC library, integration, side channel, or resource limit creates a classical vulnerability.

## Phase 1 consequence

Phase 1 continues to use Base as the canonical EVM settlement rail, with Lightning and Solana as adapters. hOUR Chain can issue PQC-signed protocol events before those external rails are fully post-quantum, but documentation and verification MUST distinguish:

1. the validity of an hOUR Chain PQC signature;
2. authorization and settlement performed by an external network; and
3. the residual quantum risk of that external network.

Cross-chain bridges remain outside the Phase 1 trust base.

## Performance and operational requirements

Before selecting mandatory parameter sets, benchmark:

- public-key, signature, transaction, and address sizes;
- signing and verification latency;
- batch and threshold verification;
- block, state, index, network, and archival growth;
- denial-of-service and fee implications;
- mobile, browser, server, HSM, and hardware-wallet support;
- recovery, rotation, revocation, and emergency algorithm migration.

## Evidence

Primary discussion source:

- Ryan Babbush et al., “Securing Elliptic Curve Cryptocurrencies against Quantum Vulnerabilities: Resource Estimates and Mitigations,” arXiv:2603.28846v2, 2026: https://arxiv.org/html/2603.28846v2

The paper reports improved resource estimates for future attacks on secp256k1, distinguishes on-spend, at-rest, and on-setup attacks, surveys system-level blockchain risks, and recommends prompt PQC migration. It also explicitly states that cryptographically relevant quantum computers do not exist today.

## Out of scope

This decision does not attribute current missing wallet funds to quantum attacks. Missing balances, wallet discovery, custody, approvals, automation, bridge activity, derivation paths, and indexing/reconciliation remain a separate investigation associated with Phigit and wallet operations.

## Follow-up

- Define HBC signature-suite registry and algorithm lifecycle.
- Prototype ML-DSA event signing and verification.
- Evaluate SLH-DSA for root and recovery roles.
- Define stable identities with rotatable authorization keys.
- Add downgrade, replay, and algorithm-retirement tests.
- Inventory quantum-vulnerable dependencies across every adapter and administrative path.
- Benchmark PQC costs against the cloud and mobile budget.
- Obtain independent cryptographic review before production.

# Threat Model

Status: Initial checklist — PQC requirement added

## Protected assets

- Creator identities and recovery paths.
- Rights, split, and provenance records.
- Evidence hashes and private source material.
- Signing authorities and agent capabilities.
- Settlement instructions and receipts.
- Validator, governance, treasury, bridge, and upgrade authorities.
- Indexer integrity and availability.

## Primary threats

- Private-key or signer compromise.
- Unauthorized agent action or approval bypass.
- False or conflicting rights claims.
- Replay, reordering, signature-suite downgrade, or version-downgrade attacks.
- Poisoned external metadata and oracle data.
- Indexer divergence from canonical receipts.
- Bridge, adapter, or RPC compromise.
- Privacy leakage from public identity graphs.
- Administrative-key abuse.
- Cloud account compromise and runaway spend.
- Future cryptographically relevant quantum computers deriving private keys from exposed elliptic-curve public keys.
- On-spend attacks against transactions exposed before settlement.
- At-rest attacks against reused or persistently exposed keys.
- On-setup attacks against quantum-vulnerable trusted parameters.
- False claims of end-to-end PQC where proofs, bridges, consensus, admin paths, or settlement rails remain vulnerable.
- PQC implementation bugs, side channels, resource-exhaustion attacks, or later cryptanalytic breaks.

## Required controls

- Domain-separated signatures and nonces.
- Schema, signature-suite, and version allowlists with downgrade protection.
- Native post-quantum authorization and cryptographic agility.
- Protocol-level key rotation and recovery without changing stable creator identity.
- Least-privilege signer roles, separate security domains, and spend limits.
- Composite conventional-plus-PQC authorization for high-impact transitional operations.
- Simulation plus typed human confirmation.
- Threshold authorization and delayed upgrades for production.
- Multiple read providers for consequential observations.
- Reconciliation, invariants, and fail-closed conflicts.
- Encrypted private evidence and public hashes only.
- Avoid public-key and address reuse where an external rail permits it.
- Inventory quantum-vulnerable dependencies in proofs, trusted setups, bridges, adapters, RPC/TLS, software signing, hardware wallets, and external settlement networks.
- Benchmark signature size, verification cost, state growth, denial-of-service limits, and mobile/hardware support.
- Use standardized, reviewed cryptography and libraries; never design a custom primitive.
- Cost budgets, alerts, and environment isolation.
- Incident response, algorithm migration, and key-rotation exercises.

## Scope boundary

PQC is a forward-looking protocol requirement. It does not explain or remediate current missing balances, incomplete wallet discovery, derivation-path errors, compromised approvals, agent defects, bridge history, or indexing/reconciliation failures. Those remain a separate Phigit and wallet-control workstream.

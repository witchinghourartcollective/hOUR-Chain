# Threat Model

Status: Initial checklist

## Protected assets

- Creator identities and recovery paths.
- Rights, split, and provenance records.
- Evidence hashes and private source material.
- Signing authorities and agent capabilities.
- Settlement instructions and receipts.
- Indexer integrity and availability.

## Primary threats

- Private-key or signer compromise.
- Unauthorized agent action or approval bypass.
- False or conflicting rights claims.
- Replay, reordering, or version-downgrade attacks.
- Poisoned external metadata and oracle data.
- Indexer divergence from canonical receipts.
- Bridge, adapter, or RPC compromise.
- Privacy leakage from public identity graphs.
- Administrative-key abuse.
- Cloud account compromise and runaway spend.

## Required controls

- Domain-separated signatures and nonces.
- Schema/version allowlists.
- Least-privilege signer roles and spend limits.
- Simulation plus typed human confirmation.
- Multisig and delayed upgrades for production.
- Multiple read providers for consequential observations.
- Reconciliation, invariants, and fail-closed conflicts.
- Encrypted private evidence and public hashes only.
- Cost budgets, alerts, and environment isolation.
- Incident response and key-rotation exercises.

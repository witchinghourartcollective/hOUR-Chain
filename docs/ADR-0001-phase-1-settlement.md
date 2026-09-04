# ADR-0001: Use Base for Phase 1 settlement

Status: Accepted

## Decision

Use Base as the canonical Phase 1 EVM settlement network. Implement Bitcoin Lightning and Solana through adapters. Do not make cross-chain bridges a core dependency.

## Rationale

The existing Witching Hour stack is EVM-capable and already includes Base-oriented tooling. Building protocol utility on an established settlement network is faster and safer than launching independent consensus before product-market evidence exists.

## Consequences

- Contracts, receipts, deployments, and explorer links default to Base.
- Protocol identifiers remain network-neutral.
- Settlement adapters must expose common simulation, approval, submission, and receipt interfaces.
- A dedicated rollup/appchain requires a later ADR and explicit decision gate.

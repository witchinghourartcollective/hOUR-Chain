# hOUR Chain (HBC)

hOUR Chain is the creator rights, provenance, access, and settlement protocol for the Witching Hour ecosystem.

## Status

Pre-alpha protocol definition. Chain roles (see [ADR-0004](docs/ADR-0004-solana-consent-base-payments.md)):

- **Solana:** primary chain for approvals/consent and attestations. **In progress** (pre-alpha) in [`hour-chain-solana`](https://github.com/witchinghourartcollective/hour-chain-solana).
- **Base:** payments/settlement and canonical EVM records. **Planned**; no contracts deployed yet.
- **Filecoin:** durable evidence/archive layer in [`hour-chain-filecoin`](https://github.com/witchinghourartcollective/hour-chain-filecoin).
- **Bitcoin Lightning:** payment adapter. **Planned.**

hOUR Chain is not yet an independent L1, validator network, or mainnet.

**Security direction:** hOUR Chain is post-quantum-native by design. Post-quantum authorization, algorithm agility, and protocol-level key rotation are genesis requirements, including for users, validators, governance, treasury, recovery, bridges, proofs, and upgrades. See [ADR-0002](docs/ADR-0002-post-quantum-native-cryptography.md).

## Existing ecosystem

- **Phigit OS:** local-first evidence, identity, verification, chain reads, and auditable reporting.
- **Witching Hour App:** primary web product and creator-facing protocol client.
- **Witching-hOUR-Live-App:** live production and performance-event client.
- **WHM onchain agent:** automated wallet, trading, payment, and x402 execution workflows.
- **hOUR Chain:** shared protocol, schemas, contracts, indexer, SDK, and verified read model.

## Initial protocol primitives

1. Wallet-rotatable creator identity and attestations.
2. Work, recording, release, and performance registry.
3. Versioned contributor and rights-split graph.
4. Signed append-only provenance events.
5. Deterministic settlement instructions and receipts.
6. Access credentials and memberships.
7. Scoped agent permissions, budgets, simulations, and approvals.
8. Live-session and performance events.

## Repository map

What exists today:

- `SPEC.md`, `TRUST-MODEL.md`, `THREAT-MODEL.md` — protocol specification and security model.
- `specs/` — canonical event-envelope schema, signature-suite registry, conformance check, and the first-release fixture template.
- `packages/pqc-profile/` — reference implementation of the PQC signing profile: canonical signing bytes, ML-DSA-65 and SLH-DSA-SHA2-128s sign/verify, and fail-closed suite/version checks.
- `docs/` — architecture decisions, signature canonicalization, first-release pilot, funding, and cloud-cost baseline.
- `site/` — the mirrorizm.com landing page and its Shopify section.

Related repositories: Solana consent and attestations in [`hour-chain-solana`](https://github.com/witchinghourartcollective/hour-chain-solana); Filecoin evidence in [`hour-chain-filecoin`](https://github.com/witchinghourartcollective/hour-chain-filecoin).

Planned, not yet started: Base contracts, TypeScript SDK and Phigit Python adapter, indexer and verified read model, protocol explorer, and Phigit / Witching Hour App / Live App / agent / Lightning adapters.

## Quick start

Requires Node.js 24.7 or later (native ML-DSA and SLH-DSA in `node:crypto`) and Python 3.

```sh
npm ci
npm test                 # PQC signing-profile tests
npm run check:conformance  # SPEC.md and the envelope schema agree
```

## Decisions

- [ADR-0001](docs/ADR-0001-phase-1-settlement.md) — Base as the Phase 1 settlement network.
- [ADR-0002](docs/ADR-0002-post-quantum-native-cryptography.md) — post-quantum-native cryptography.
- [ADR-0004](docs/ADR-0004-solana-consent-base-payments.md) — Solana for consent and
  attestations, Base for payments (amends ADR-0001).
- [ADR-0003](docs/ADR-0003-event-envelope-boundary.md) — boundary between this
  envelope and the `witching-hour-platform` envelope, and where Lightning
  telemetry versus Lightning settlement each belong.

## Phase 0

- Define actors, trust boundaries, identifiers, and the canonical event envelope.
- Model one real release with contributors, rights, splits, and evidence.
- Establish post-quantum signature profiles, key rotation, agent permissions, approvals, and settlement receipts.
- Benchmark PQC transaction size, verification cost, mobile-wallet behavior, and infrastructure impact.
- Create a cloud-cost baseline and funding application package. See `docs/CLOUD-COST-BASELINE.md`.

## Safety and compliance

- Never commit secrets, private keys, wallet material, or production credentials.
- Default fund-moving automation to simulation and explicit approval.
- Keep user funds non-custodial where practical.
- Treat administrator, exchanger, money-transmission, securities, sanctions, and music-rights questions as implementation-dependent legal work.
- No token sale or public mainnet claim is authorized by this repository.

## Planning

- [Notion strategy and 12-month plan](https://app.notion.com/p/3d146bde34d981ae9b91ca850b6efcb9)
- [Proposed architecture in FigJam](https://www.figma.com/board/VMjj9CL9QY5rIaiFyKNggg?architecture=true)

## License

Proprietary until an explicit licensing decision is recorded.

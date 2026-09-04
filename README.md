# hOUR Chain (HBC)

hOUR Chain is the creator rights, provenance, access, and settlement protocol for the Witching Hour ecosystem.

## Status

Pre-alpha protocol definition. Phase 1 uses **Base** as the canonical EVM settlement network, with Bitcoin Lightning and Solana implemented as adapters. hOUR Chain is not yet an independent L1, validator network, or mainnet.

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

- `specs/` — protocol, state transitions, identifiers, and schemas.
- `contracts/` — future Base contracts and tests.
- `sdk/` — TypeScript SDK and Phigit Python adapter.
- `indexer/` — event ingestion and verified read model.
- `apps/explorer/` — future protocol explorer.
- `adapters/` — Phigit, Witching Hour App, Live App, agent, Lightning, and Solana.
- `docs/` — trust, threats, architecture decisions, funding, compliance, and operations.

## Phase 0

- Define actors, trust boundaries, identifiers, and the canonical event envelope.
- Model one real release with contributors, rights, splits, and evidence.
- Establish key rotation, agent permissions, approvals, and settlement receipts.
- Create a cloud-cost baseline and funding application package.

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

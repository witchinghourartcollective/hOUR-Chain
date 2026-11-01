# ADR-0008: Restore Solana consent alongside the Cosmos EVM L1

Status: Accepted product direction (2026-11-01); implementation and deployment pending.
Amends: ADR-0005. ADR-0006/0007 identifiers are reserved by existing token-repository references.

## Decision

Solana consent and attestations are a major, active workstream in hOUR Chain.
Restore this role without replacing the sovereign Cosmos EVM L1, Filecoin evidence
archive, or existing Base token. The previous blanket pause is lifted for development;
this decision does not deploy a program or remove production security gates.

| Network | Responsibility | Current implementation boundary |
| --- | --- | --- |
| Cosmos EVM hOUR Chain | Canonical creator-rights state, accepted consent references, settlement state, native IBC | Single-node scaffold, IBC transfer modules present |
| Solana | Contributor consent and attestations bound to a release and split version | Raw-digest P-256 prototype; real WebAuthn and deployment pending |
| Filecoin | Durable evidence bytes, storage receipts, verified retrieval | Integrity utilities plus a Synapse-compatible storage adapter; network validation pending |
| Base | Existing hOUR token and external settlement/bridge integrations | Token configuration exists; royalty settlement and bridge completion must be verified separately |
| DigitalOcean | Self-hosted nodes, adapters, relayers, persistent state and monitoring | Existing k3s/Flux configuration is in whm-infra; runtime access/evidence required |

## Integration rules

- Preserve the real creative-hours model in TIME-CONTRIBUTIONS.md. Contribution time,
  consent, monetary obligation, token balance and payment receipt remain distinct.
- Each Solana approval binds the release ID, split-version hash, contributor identity,
  nonce, expiry and evidence hash. Cosmos ingestion must verify the actual program,
  record layout, finality, identity binding and revocation policy. A copied transaction
  hash or an RPC response alone is not authorization.
- Store exact evidence bytes (encrypt private content before upload); record network,
  PieceCID, digest, byte count, provider/data-set/piece identifiers, and confirmation
  evidence. Re-fetch and verify against an independently retained receipt. Verify PQ
  signatures with authorized historical keys separately from storage integrity.
- Native IBC is available only where compatible light clients, counterparty state,
  packet applications and relayers have actually been deployed and exercised. A DO
  droplet supplies hosting, not an IBC light client. Solana, Filecoin and Base are not
  automatically IBC-connected because the Cosmos app imports ibc-go.
- Start by proving hOUR Chain to a compatible Cosmos test chain. Record both client
  IDs, connection IDs, port/channel IDs (for IBC Classic), relayer version and a real
  send/acknowledgement/return or timeout result. For each other network, select and
  validate a concrete IBC client/contract/program and relayer path, or explicitly
  label a separately secured adapter/bridge. Never label a trusted bridge as IBC.
- Do not migrate or mint token supply, change live trading, or fund a bridge as a
  side effect of restoring consent. Native ahbc and the Base hOUR ERC-20 are distinct
  until an approved token/bridge policy defines their relationship.

## Launch gates

See [LIVE-READINESS.md](LIVE-READINESS.md). No production-live, public-testnet,
end-to-end PQ-safe, trustless-bridge or complete-IBC claim follows from this ADR.

## Official references

- https://docs.filecoin.cloud/getting-started/
- https://docs.filecoin.cloud/developer-guides/storage/upload-pipeline/
- https://ibcprotocol.dev/how-ibc-classic-works
- https://hermes.informal.systems/documentation/commands/path-setup/index.html

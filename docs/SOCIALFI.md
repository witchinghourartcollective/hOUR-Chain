# SocialFi is a hOUR Chain product surface

The SocialFi app connects creator profiles, community updates, creative works,
collaboration and real creative-time records to the creator-rights protocol.
This applies across the protocol and adapter repositories, rather than turning
social engagement into an automatic ownership or reward system.

`packages/socialfi/src/index.mjs` defines the canonical v1 draft boundary:
profile.updated, work.created, post.published, follow.created,
contribution.recorded, contribution.reviewed and support.requested. Full names
are `socialfi.<action>.v1`. Every draft has a payload hash, actor, subject, stable
event ID, nonce and canonical UTC timestamp. Unknown reward fields, fake signatures,
non-integer time and malformed token amounts fail validation. A draft is unsigned,
off-chain application intent. It must not be presented as verified consent,
on-chain state, a reward, a settlement receipt or immutable history.

A contribution measures minutes; one review does not establish rights approval.
Social engagement, minutes, agreed rights, payment obligations and token balances
remain distinct. No hOUR/real-hour exchange rate is defined by this change.

## Responsibilities

- `witching-hour-socialfi`: UI, persistent app records, server-derived actors and
  unsigned event outbox. Local demo identities are explicitly unverified.
- `hOUR-Chain`: canonical event boundary, authorized PQ signatures and future
  accepted creator-rights state on the Cosmos EVM L1.
- `hour-chain-solana`: consent request fields tied to a registered work and an
  independently reviewed split document. Its real WebAuthn/deployment gates remain.
- `hour-chain-filecoin`: validated draft-to-evidence manifests, followed by encrypted
  storage and verified retrieval through the storage adapter when configured.
- `witching-hour-token`: the existing Base hOUR asset. Support intents do not call
  transfer, enable trading, mint rewards or prove a royalty payment.
- `whm-infra`: authenticated cloud deployment, persistence, backups and observability.

The app and Filecoin repo carry byte-identical contract mirrors with an explicit
SHA-256 source manifest. Change upstream and mirrors together. This avoids private
repository credentials inside npm installs; no production signer key is vendored.

## Live handoff still required

Before a draft is dispatched, resolve actor/key authorization and idempotency,
validate its payload hash, obtain the correct consent for the exact rights/split
version, call the managed signer, persist verification material and encrypted
Filecoin evidence/receipts, and submit accepted state through a deployed Cosmos
adapter. Verify receipts independently. A social post or an archive digest does
not supply missing identity, consent, finality, retention or IBC verification.

The current Cosmos app is a scaffold; no SocialFi chain module or public identity
registry is activated here. IBC clients, counterparties and relayer packet proofs
remain separate launch gates under ADR-0008 and LIVE-READINESS.md.

## Optional cross-repository local test

The SocialFi app includes `script/verify-hbc.mjs`. With the repositories checked
out side by side and protocol dependencies installed, it checks contract parity,
PQ signing and archive tamper detection with ephemeral test keys. It performs no
network writes, storage payment or token transfer. The app itself only needs
Node 24.7+ to run its local demo.

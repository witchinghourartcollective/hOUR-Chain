# PQC evidence rollout

## Implemented reference boundary

`packages/pqc-profile/src/evidence.mjs` seals authorization evidence and renewal
records with the existing HBC event-signature profile. Complete records are
linked using SHA-512; payload hashes remain SHA-256 to conform to the canonical
event schema. Verification requires an externally pinned head (preventing
truncation) and an application-supplied authorized key resolver. The resolver
must enforce signer/subject bindings, authorization epochs and historical
revocation policy; merely importing an embedded key is insufficient.

The signature layer now rejects keys whose type does not match their declared
suite, including classical keys mislabeled as ML-DSA. This closes an algorithm
confusion gap before downstream adoption.

```js
import { generateTestKeyPair } from '../packages/pqc-profile/src/index.mjs';
import { sealEvidence, evidenceRecordHash, verifyEvidenceChain }
  from '../packages/pqc-profile/src/evidence.mjs';

// Fixture only. Production keys remain inside a reviewed managed signer.
const { privateKey, publicKey } = generateTestKeyPair();
const original = sealEvidence({
  principal: 'creator:demo', agent: 'flywheel:demo',
  scope: ['royalty.settle'], policyVersion: '1',
  executionResult: 'confirmed', transactionRef: 'example:transaction',
}, privateKey, { signer: 'key:demo', subject: 'work:demo' });
const head = evidenceRecordHash(original);
// Persist and independently pin head before handing the record to untrusted storage.
const result = verifyEvidenceChain([original], {
  expectedHead: head,
  resolveKey: ({ signer }, envelope) =>
    signer === 'key:demo' && envelope.subject === 'work:demo' ? publicKey : undefined,
});
```

The evidence body is an application-defined object, not an authorization policy
engine. Signed `issuedAt` values remain claims: successful verification returns
`timeAnchored: false`. External timestamp receipts need an independent trusted
verifier and renewal policy. A renewal preserves earlier evidence; it cannot
repair a signature that was already forgeable when first anchored. No private
keys, recovery seeds, credentials or sensitive creator agreements belong in
public evidence.

## Repository boundaries and release gates

| Repository/component | Integration | Release gate |
| --- | --- | --- |
| hOUR-Chain | Versioned signed evidence and trusted-key verification | `npm run check`; independent review before security-critical use |
| hour-chain-filecoin | Preserve exact signed bytes and renewal receipts; linked archive checkpoints | Archive tests; trusted signature/time verification; actual storage/retrieval adapter |
| whm-flywheel | Produce evidence after confirmed execution, referencing policy and delegation | Existing `scripts/verify.sh`, PR/CI and `scripts/deploy.sh` gates; no key export |
| whm-infra / Phigit sync | Preserve original raw observations as UNKNOWN; archive signed promoted records separately | Sync tests, server dry-run/canary, persisted checkpoint and deployed image verification |
| Phigit OS | Resolve historical authorized signer keys and epochs; reject missing pinned heads | Verified identity/revocation policy and integration tests |
| Witching Hour App / Live App | Link performance/time records to approved rights evidence | Creator approval and exact canonical-event integration tests |
| hour-chain-solana | Paused by ADR-0005; no new PQ production deployment | Reconsider only if an explicit architecture decision resumes this adapter |
| Cosmos EVM / CometBFT | Consensus, governance, admin and account migration remain separate | Reviewed chain upgrade, validator coordination, recovery rehearsal, load/DoS tests |

No running service consumes these new reference APIs automatically. A repository
merge is not proof of production deployment. Runtime consumers must pin the
reviewed source commit, pass their gates and show the deployed commit/image.

Quantum Cadence and other research consensus schemes remain evaluation work.
They are not drop-in CometBFT upgrades. The current L1 is a devnet scaffold and
its Ed25519 validators/secp256k1 accounts remain quantum-vulnerable (ADR-0005).
No end-to-end PQ, public testnet or mainnet claim follows from these APIs.

## Verification

`npm run check` exercises signature-suite rejection, key-type enforcement,
tampering, authorized-key rotation, broken/reordered chains, pinned-head
truncation detection and rejection of asynchronous key resolvers. Run Filecoin's
`npm test` separately for exact-byte archival integrity.

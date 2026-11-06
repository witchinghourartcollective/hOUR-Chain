# Trust Model

## Principles

1. Evidence is append-only and content-addressed.
2. Identity is stable while wallets remain rotatable.
3. Claims identify who signed, who verified, and what remains unverified.
4. Onchain inclusion proves publication and ordering, not the truth of a rights claim.
5. Fund-moving actions are simulated, scoped, budgeted, and explicitly approved.
6. Conflicts fail closed and remain visible.

## Actors and responsibilities

| Actor | Responsibility | Trust boundary |
| --- | --- | --- |
| Creator or contributor | Assert work, credit, rights, time, or split information; approve their own contribution and consent records. | A signature attributes an assertion to a key; it does not prove the assertion is true. |
| Rights administrator | Coordinate rights and split changes and collect required approvals. | Authority is limited to the documented mandate and approvals; this role is not automatically a protocol administrator. |
| Client or agent | Prepare and submit events or settlement instructions under user-granted capabilities. | Agents are untrusted to exceed their scope; simulation, budgets, and explicit approval are required before fund movement. |
| Witching Hour protocol operator | Operate protocol services and control early releases, schemas, and upgrade keys. | Centralized administrative authority; actions and changes require auditable records and disclosed governance. |
| Validator or network operator | Order and finalize transactions on a network. | Network consensus and finality are trusted only to the extent of that network's validator and security model. The HBC validator model remains open. |
| Verifier or indexer operator | Validate events and build a queryable read model. | A read model is derived data, not canonical proof; consequential results must be checked against network receipts and independent providers. |
| Dispute reviewer | Review contested claims and record a resolution or dispute state. | Review is an adjudication input, not a cryptographic proof of ownership or a substitute for legal process. |
| External network or storage provider | Provide settlement, attestations, evidence storage, or infrastructure. | Each provider has its own availability, integrity, finality, key-management, and governance assumptions. |

## Trust boundaries

```text
 Creator / contributor devices and keys
             |
       signed claims, consent
             v
 Client or agent -- scoped capability / explicit approval boundary
             |
             v
 Witching Hour-operated services, schemas, and upgrade controls
             |
             v
 hOUR Chain (Cosmos EVM) -- validator consensus and transaction finality
       |             |              |               |
    Solana        Filecoin         Base          IBC peers
  consent and    evidence bytes   token and     only on a
 attestations    and receipts     integrations  verified route
```

The arrows represent data or transaction flows, not a shared trust domain. Network inclusion establishes publication or ordering, not the truth of a claim. IBC, adapters, and cross-network references add independent verification and relayer assumptions; hosting a component does not itself establish a network connection.

## Signer roles

- **Creator/contributor signers** authorize their own claims, approvals, and consent. They retain control of their keys in the non-custodial path; wallet rotation must not change the stable participant identity.
- **Agent signers** may act only through a narrowly scoped, revocable capability. An agent's signature does not replace a required human approval.
- **Settlement approvers** approve a specific simulated instruction within its recipient, asset, network, and budget scope. Submission and receipt verification are distinct from approval.
- **Protocol and deployment signers** control service releases, chain/program deployment, or upgrades. These are privileged administrative keys, separate from participant keys, and require controlled storage, rotation, and auditable approval.
- **Validator and relayer signers** authorize network consensus or message relaying, respectively. Their authority is network-specific and does not establish participant consent or rights.

These are role boundaries, not claims that all corresponding signers or production workflows are deployed. Do not treat an event-signing key as a chain, program, storage, or settlement signer.

## Phase 1 custody boundaries

The repository describes a pre-alpha system: the HBC chain is a single-node devnet scaffold, and the readiness audit reports no deployed hOUR Chain Solana or Base contracts/programs. Pilot fixture validation moves no live funds. Therefore, no production custody arrangement is implied by the protocol specification.

For a pilot payout, the contributor may:

1. provide a wallet they control (non-custodial onchain payout);
2. defer onchain payout in a non-custodial claim record, with no contributor key or funds held by the protocol;
3. choose an ordinary fiat payout where supported, subject to the payment provider's own custody and settlement terms; or
4. explicitly opt into an assisted or managed-wallet flow. This is a custodial or delegated-control boundary unless the actual key-control and recovery design proves otherwise; it must not be described as self-custody, and consent, key control, recovery, and applicable terms must be disclosed.

Witching Hour and agents must not collect a contributor's seed phrase or private key. Managed signers used for protocol operations, if introduced, are separate from contributor wallets and require an explicitly documented operator, scope, budget, recovery, and approval policy. Token, validator, treasury, and production signer custody decisions remain open where the repository says they are open.

## Trust classes

- **Creator-signed:** asserted by the creator.
- **Counterparty-acknowledged:** signed by all required contributors.
- **Platform-attested:** observed or validated by a Witching Hour service.
- **Third-party verified:** reconciled against an external authority or dataset.
- **Network-settled:** confirmed by the relevant settlement network.
- **Disputed:** contested and excluded from automatic settlement unless policy permits.

## Key management

Raw private keys must not be shared with clients or agents. Use managed or hardware-backed signers, narrowly scoped capabilities, rotation, revocation, and complete approval receipts.

## Administrative assumptions

Witching Hour controls early protocol releases, schemas, services, and upgrade keys. The HBC validator and token models are open decisions, and the current chain is a single-node scaffold. These are centralized controls, not decentralized governance; no production deployment or independent validator set is established by this repository. Governance may expand only with explicit technical and legal milestones.

## External networks and assumptions

| Network or service | Intended role | Current trust assumption / status |
| --- | --- | --- |
| hOUR Chain (Cosmos EVM) | Canonical rights state, accepted consent references, and settlement state. | Single-node devnet scaffold; validator and token models remain open. Cosmos/CometBFT and EVM account keys are not post-quantum. |
| Solana | Contributor consent and attestations. | Active development workstream; deployed program and production WebAuthn path are not established. Verify program, layout, finality, identity binding, and revocation before ingestion. |
| Filecoin | Durable evidence archive. | Storage integrity must be checked against retained receipts and re-fetches; network validation and operational key/recovery controls remain launch gates. |
| Base | Existing HBC token and external settlement/bridge integrations. | Token presence does not prove royalty settlement or bridge completion; verify deployed contracts, state, signer custody, and receipts independently. |
| IBC counterparties | Interoperability with compatible Cosmos networks. | Treat as unavailable until compatible clients, counterparty state, relayer, and packet acknowledgement/timeout behavior are demonstrated. |
| Bitcoin Lightning | Planned payment adapter. | Not an established Phase 1 production path. |
| DigitalOcean / hosted infrastructure | Nodes, adapters, relayers, persistent state, and monitoring. | Hosting is an operator-controlled availability and administration boundary, not proof of network connectivity or independent consensus. |

All external networks and storage systems have separate operators, upgrade paths, availability, and cryptographic assumptions. In particular, a PQC signature on an hOUR event does not make consensus, account authorization, a bridge, an adapter, or an external settlement receipt post-quantum secure.

See the [threat model](THREAT-MODEL.md) for protected assets, threats, and required controls.

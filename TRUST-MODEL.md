# Trust Model

## Principles

1. Evidence is append-only and content-addressed.
2. Identity is stable while wallets remain rotatable.
3. Claims identify who signed, who verified, and what remains unverified.
4. Onchain inclusion proves publication and ordering, not the truth of a rights claim.
5. Fund-moving actions are simulated, scoped, budgeted, and explicitly approved.
6. Conflicts fail closed and remain visible.

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

Witching Hour controls early protocol releases, schemas, services, and upgrade keys. This is disclosed rather than disguised as decentralization. Governance may expand only with explicit technical and legal milestones.

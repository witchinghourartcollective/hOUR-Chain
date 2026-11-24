# Settlement payload fixtures

These are example payloads for [`../../payloads/`](../../payloads/), checked by `test/settlement-schemas.test.mjs`.

`gcul-receipt.json` mirrors the contract v2 settlement verified on GCUL integration-testing on 2026-11-23: the transaction hash, contract, payee, amount and round are real. Two fields differ from that run:

- `settlementId` is derived with the ADR-0009 rule. The on-ledger test used the hand-written ID `hst1_test_0001`.
- `reconciliationRunId` is illustrative, because the reconciliation job does not exist yet.

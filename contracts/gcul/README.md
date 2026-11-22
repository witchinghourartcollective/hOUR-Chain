# GCUL contracts

## `settlement_receipts.py`

Test contract for the GCUL settlement adapter. It is an owner-only, append-only registry that links each settlement ID to an approved contribution ID, an agreement ID, the payee, the amount in minor units, and an external payment reference.

The contract moves no funds, and it does not approve time or rights. A settlement ID can be recorded only once, which guards against duplicate payment. This follows the adapter requirements in [TIME-CONTRIBUTIONS.md](../../docs/TIME-CONTRIBUTIONS.md).

Storage limit: all contract fields share about 5 MiB. That is fine for testing, but production needs pruning, sharding, or account fields.

### Build and test

```
cd contracts/gcul
gculpyc --source_file settlement_receipts.py --output_file settlement_receipts.bin
cd ../.. && python3 contracts/gcul/test_settlement_receipts.py -v
```

The tests use a stub `gcul` module because Google has not released its local simulator yet.

### Deploy and invoke (integration-testing)

Each of these commands submits a transaction, so get explicit approval before running it.

```
cd contracts/gcul
ul-cli --timeout 90s contracts create settlement_receipts.bin \
  --alias hour_settlement_receipts --sender hour_chain_owner \
  --arg 'label="hour-settlement-test"' \
  --comment "hOUR settlement receipt registry (test)"

ul-cli --timeout 90s contracts invoke --alias hour_settlement_receipts \
  --method-name record_settlement --sender hour_chain_owner \
  --arg 'settlement_id="hour-test-0001"' \
  --arg 'contribution_id="contrib-test-0001"' \
  --arg 'agreement_id="agree-test-0001"' \
  --arg 'payee=Account(hour_chain_user2)' \
  --arg 'amount_minor=100' \
  --arg 'payment_ref="70fed00be53a122569620e8df808f2834296fd22a6a5b3b6f97dc13a5b6c3497"'

ul-cli --timeout 90s accounts describe --alias hour_settlement_receipts --sender hour_chain_owner
```

Run the same invoke a second time to check idempotency: it must fail with `Duplicate settlement_id`.

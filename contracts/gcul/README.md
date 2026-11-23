# GCUL contracts

## `settlement_receipts.py`

Test contract for the GCUL settlement adapter. It is an owner-only, append-only registry that links each settlement ID to an approved contribution ID, an agreement ID, the payee, the amount in minor units, and an external payment reference.

The contract moves no funds, and it does not approve time or rights. A settlement ID can be recorded only once, which deduplicates receipts but does not prevent duplicate external payments. Payment-level idempotency is the settlement adapter's responsibility. This follows the adapter requirements in [TIME-CONTRIBUTIONS.md](../../docs/TIME-CONTRIBUTIONS.md).

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

Run the same invoke a second time to check receipt deduplication: it must fail with `Duplicate settlement_id`.

## `settlement_receipts_v2.py`

This is the atomic settlement contract from [ADR-0009](../../docs/ADR-0009-gcul-settlement-adapter.md). `settle()` is `@gcul.payable`: the operator attaches the payment, and the contract forwards it to the payee with `native_transfer` and records the receipt in the same transaction.

If any check fails, the whole transaction fails and no funds move. That covers a duplicate `settlement_id`, a non-owner sender, a payment that doesn't equal `amount_minor`, and a missing reference. This is payment-level idempotency on the ledger, which v1 does not provide.

Each receipt records `instruction_id`, `contribution_ref` (`id@version`), `agreement_ref` (`id@version`), the payee, `amount_minor` and the currency code. The GCUL transaction hash is the payment reference; the adapter captures it off-ledger.

### Build and test

```
cd contracts/gcul
gculpyc --source_file settlement_receipts_v2.py --output_file settlement_receipts_v2.bin
cd ../.. && python3 contracts/gcul/test_settlement_receipts_v2.py -v
```

The stub `gcul` module in the tests models the ledger's all-or-nothing execution, so each test can check that no transfer happens when a call fails.

### Deploy and test on integration-testing

Each of these commands submits a transaction, so get explicit approval before running it.

```
cd contracts/gcul
ul-cli --timeout 90s contracts create settlement_receipts_v2.bin \
  --alias hour_settlement_v2 --sender hour_chain_owner \
  --arg 'label="hour-settlement-v2-test"' --comment "hOUR atomic settlement (test)"

# 1. Settle: expect payee +100, operator -100, receipt_count 1
ul-cli --timeout 90s contracts invoke --alias hour_settlement_v2 \
  --method-name settle --sender hour_chain_owner --payment 100 \
  --arg 'settlement_id="hst1_test_0001"' --arg 'instruction_id="evt-test-instruction-0001"' \
  --arg 'contribution_ref="contrib-test-0001@1"' --arg 'agreement_ref="agree-test-0001@1"' \
  --arg 'payee=Account(hour_chain_user2)' --arg 'amount_minor=100'

# 2. Replay the same command: expect "Duplicate settlement_id" and no balance change
# 3. Mismatch (--payment 100 with amount_minor=150, new settlement_id): expect failure and no balance change
```

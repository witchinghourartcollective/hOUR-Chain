# GCUL integration-testing status

Google Cloud Universal Ledger (GCUL) is planned as a **settlement adapter** for hOUR Chain. This document records what has been verified so far. It does not change the requirements in [TIME-CONTRIBUTIONS.md](TIME-CONTRIBUTIONS.md), and it makes no claim of live or real-value settlement.

## Status (2026-11-23)

- **Network:** `integration-testing` endpoint, project `hour-blockchain`, region `us-east4`. This network carries **no real value**.
- **Verified:** CLI setup, account registration, account queries, and one test token transfer between two user accounts.
- **Deployed:** settlement-receipt test contract `1:CTR:005mhiWQhcWooM7uV2zjaqPcVDswoqTA7KTehA9LNgid6` (alias `hour_settlement_receipts`, source [`contracts/gcul/settlement_receipts.py`](../contracts/gcul/settlement_receipts.py), bytecode sha256 `50792af6…d000f`), deployed 2026-11-23 by `hour_chain_owner`. The empty initial state was read back from the ledger.
- **Verified on-ledger (2026-11-23):** receipt `hour-test-0001` was recorded, linking `contrib-test-0001` / `agree-test-0001` to payee `hour_chain_user2`, 100 minor units, and payment ref `70fed00b…3497` (the test transfer). A repeat of the same settlement ID was rejected with `FAILED_PRECONDITION: Duplicate settlement_id`, and `receipt_count` stayed at 1.
- **Atomic settlement verified on-ledger (2026-11-23):** contract v2 `1:CTR:005788bGkaVpczkhPsWCfVfToTxywz15AiZG5fVD1f769` (alias `hour_settlement_v2`, source [`contracts/gcul/settlement_receipts_v2.py`](../contracts/gcul/settlement_receipts_v2.py), bytecode sha256 `3c0d1469…1f19`).
  - `settle` `hst1_test_0001` with a 100 payment (tx `7f00df8f864f7d30c2cd16a345c352d0aebe9eb9b83ba66d8d2f7809bf778730`, round 5050653): `hour_chain_user2` went from 101 to 201 and `hour_chain_owner` from 2147483546 to 2147483446. The receipt was recorded in the same transaction, so `@gcul.payable` and `native_transfer` work with the DEM test currency.
  - Replaying the same settlement ID failed with `FAILED_PRECONDITION: Duplicate settlement_id`, and both balances were unchanged.
  - A payment of 100 claimed as `amount_minor=150` failed with `Payment does not match amount_minor`, and both balances were unchanged.
  - Failed transactions still consume the sender's sequence number (8 to 9 to 10) without moving funds. The adapter must not treat a sequence advance as proof of payment.
- **Adapter pilot on integration-testing (2026-11-24, simulated records):** one signed ML-DSA-65 settlement instruction (`evt-pilot-20261124-instruction-0001`) with two legs to `hour_chain_user2` ran end to end through [`packages/gcul-adapter`](../packages/gcul-adapter/README.md) and contract v2. The contribution, agreement, obligation and approval records are simulated pilot fixtures. Evidence: [`docs/evidence/gcul-pilot-20261124/`](evidence/gcul-pilot-20261124/).
  - Leg 0 `hst1_7807e632…` paid 40 (tx `67716405137691b3a5000d3310d9d5efe6a9af92d49f10d7442acfc0abacd968`, round 5058327). Leg 1 `hst1_736e9bf1…` paid 60 (tx `469c6e6763b055657b948b455521ac40efe55e95c858430e0e66c8fa8725e868`, round 5058335). `hour_chain_user2` went from 201 to 301 and the operator from 2147483446 to 2147483346.
  - Reconciliation marked both legs `RECONCILED`, emitted two schema-valid receipt payloads, and passed the balance check. It reported one finding, `orphan-receipt` for `hst1_test_0001`: the receipt from the hand-run contract v2 test on 2026-11-23, made outside the adapter. That is correct detection of a pre-adapter test receipt.
  - Replaying with the same leg table: approve was a no-op and both submits were refused locally, with no transaction sent.
  - Replaying with a lost (empty) leg table: the adapter resubmitted both legs. Contract v2 rejected each with `Duplicate settlement_id`, and the adapter matched the existing receipts and confirmed them. Balances stayed at 301 / 2147483346, so no double payment occurred even with the adapter's database gone.
- **Not verified:** mapping from real contribution and agreement records (the time-contribution workflow does not exist yet), scheduled reconciliation, real-value settlement.
- **Not available yet:** `user-testing` and mainnet need Google approval. Real-value tokens need a Currency Operator.

## Accounts

All of these accounts are on the integration-testing network. Signing keys are held in Cloud KMS (key ring `hour-chain-gcul`), and no private key material is stored in this repository.

| Alias | Account ID | Type | KMS key | Notes |
| --- | --- | --- | --- | --- |
| `hour_chain_owner` | `1:USR:DEM:0256bBuqu4nuCNRud1CMwF5FFtm4LdRyD8X8UCYNgyGa9` | User | `hour-chain-owner` | Roles: payer, receiver, contract creator, contract participant |
| `hour_chain_act` | `1:ACT:DEM:025eeYJgWAZKZavZFrePPJ3oDfHRwYe3BR5Vk52yCvRdc` | Account manager | `hour-chain-owner` | Manages `hour_chain_user2`; holds no balance |
| `hour_chain_user2` | `1:USR:DEM:022nXHgAmjMB8mXkdDcqA3HaR9D8EyXD6vAj6urJ7qJ68` | User | `hour-chain-user2` | Roles: payer, receiver |

Transfers must go to user (`USR`) accounts. Account-manager (`ACT`) accounts cannot receive tokens.

## Test transfer evidence

```
ul-cli --timeout 90s wallet transfer hour_chain_owner hour_chain_user2 100
Transfer completed: 70fed00be53a122569620e8df808f2834296fd22a6a5b3b6f97dc13a5b6c3497
```

The account queries below confirm the transfer:

| Account | Before | After |
| --- | --- | --- |
| `hour_chain_owner` balance (sequence) | 2147483646 (1) | 2147483546 (2) |
| `hour_chain_user2` balance | not readable by the owner | 101 |

A user account's balance can be read only when the query is signed by that account. Querying `hour_chain_user2` as the owner returns `PERMISSION_DENIED`. Use `--sender hour_chain_user2` to read it.

## Setup

[`scripts/gcul/setup-cloudshell.sh`](../scripts/gcul/setup-cloudshell.sh) is idempotent. It pulls the images, installs the [`ul-cli` wrapper](../scripts/gcul/ul-cli.wrapper) into `~/bin`, configures the endpoint, and registers the aliases above. The wrapper mounts the system CA certificates, which fixes the container's x509 error. It also retries when the endpoint's pre-flight check reports `Unavailable`; that check happens before anything is submitted.

`accounts describe` takes the account as `--alias <name>`, not as a positional argument.

## Next steps

1. Adapter design: proposed in [ADR-0009](ADR-0009-gcul-settlement-adapter.md) (mapping, payment-level idempotency, reconciliation).
2. Apply for `user-testing` access (gcul-help@google.com) with ADR-0009 and the evidence above.
3. Envelope `network` now accepts `"gcul"`, and settlement instruction and receipt payload schemas are defined in [`specs/payloads/`](../specs/payloads/). The adapter service and reconciliation job are in [`packages/gcul-adapter`](../packages/gcul-adapter/README.md), tested offline. The live pilot run is done (above). Next: real contribution and agreement records, and user-testing or mainnet access from Google.

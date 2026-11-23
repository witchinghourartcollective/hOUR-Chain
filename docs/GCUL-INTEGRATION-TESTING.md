# GCUL integration-testing status

Google Cloud Universal Ledger (GCUL) is planned as a **settlement adapter** for hOUR Chain. This document records what has been verified so far. It does not change the requirements in [TIME-CONTRIBUTIONS.md](TIME-CONTRIBUTIONS.md), and it makes no claim of live or real-value settlement.

## Status (2026-11-23)

- **Network:** `integration-testing` endpoint, project `hour-blockchain`, region `us-east4`. This network carries **no real value**.
- **Verified:** CLI setup, account registration, account queries, and one test token transfer between two user accounts.
- **Deployed:** settlement-receipt test contract `1:CTR:005mhiWQhcWooM7uV2zjaqPcVDswoqTA7KTehA9LNgid6` (alias `hour_settlement_receipts`, source [`contracts/gcul/settlement_receipts.py`](../contracts/gcul/settlement_receipts.py), bytecode sha256 `50792af6…d000f`), deployed 2026-11-23 by `hour_chain_owner`. The empty initial state was read back from the ledger.
- **Verified on-ledger (2026-11-23):** receipt `hour-test-0001` was recorded, linking `contrib-test-0001` / `agree-test-0001` to payee `hour_chain_user2`, 100 minor units, and payment ref `70fed00b…3497` (the test transfer). A repeat of the same settlement ID was rejected with `FAILED_PRECONDITION: Duplicate settlement_id`, and `receipt_count` stayed at 1.
- **Not verified:** the settlement adapter itself, automated reconciliation, mapping from real contribution and agreement records.
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
3. Verify contract v2 (atomic payable `settle()`) on integration-testing, per ADR-0009's implementation plan.

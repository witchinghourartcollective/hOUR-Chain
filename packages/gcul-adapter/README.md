# gcul-adapter

This package is the settlement adapter for Google Cloud Universal Ledger, as designed in [ADR-0009](../../docs/ADR-0009-gcul-settlement-adapter.md). It pays approved hOUR settlement instructions through contract v2 ([`contracts/gcul/settlement_receipts_v2.py`](../../contracts/gcul/settlement_receipts_v2.py)), at most once per leg, and reconciles the results.

It follows the real-hours model in [TIME-CONTRIBUTIONS.md](../../docs/TIME-CONTRIBUTIONS.md). The adapter acts only on signed instructions whose contribution, agreement, obligation and approvals are already approved. It never creates or edits those records, and settlement state stays separate from time and rights approval.

**Status:** tested offline against `FakeLedger`, and piloted live on integration-testing on 2026-11-24 with simulated records ([evidence](../../docs/evidence/gcul-pilot-20261124/)). No real-value settlement exists.

## Modules

| File | Role |
| --- | --- |
| `src/settlement-id.mjs` | Deterministic, opaque settlement ID per leg (`hst1_` + 40 hex chars) |
| `src/store.mjs` | Durable leg table on `node:sqlite`, with one row per settlement ID. Enforces the ADR-0009 state machine with conditional updates, keeps an audit history, and provides worker leases. |
| `src/ledger.mjs` | `FakeLedger` (contract v2 semantics plus fault injection) and `UlCliLedger` (the real client through `ul-cli`). Ledger errors are classified as duplicate, rejected, or outcome unknown. |
| `src/adapter.mjs` | `simulate`, `approve`, `submit`, `resolveUnknown`, `retry`, and `reconcile` |

## Guarantees (and the tests that hold them)

- **No double payment.** Contract v2 rejects a repeated settlement ID atomically. On top of that, the adapter writes `SUBMITTING` before every call, checks the ledger before **every** submission (so a lost or rebuilt leg table sends no failing transactions), and allows only one submitter per leg through a lease. Tests cover a timeout before commit, a timeout after commit, a crash after submit (recovered by a new process from the durable store), a late commit after a leg was marked `FAILED`, a forced resubmission, and concurrent workers.
- **Only operators instruct, and only what is owed is paid.** `instructionSigners` lists the identities allowed to sign settlement instructions; a collaborator's valid key is not enough. `expectedLegs(payload)` derives, independently of the instruction, exactly which accounts and amounts must be paid (for real records: `expectedLegs` from `time-contributions`, using the obligation's payee and amount and an operator-controlled account mapping). An instruction that redirects or inflates any leg is refused before anything is planned.
- **Instructions are verified.** The schema, the `gcul` network, the currency, the payload hash, the ML-DSA signature (through `pqc-profile`) and every referenced approval are checked. A failing instruction plans nothing.
- **Reconciliation is three-way.** It compares instructions, the leg table and on-ledger receipts. Matching legs become `RECONCILED` with a schema-valid receipt payload. A field mismatch becomes `DISPUTED`. Orphan receipts (excluding declared `knownPreAdapter` IDs, which are reported as known), receipts that are ahead of their leg's state, legs that were never planned, and operator balance gaps are reported as findings.

Run the tests from the repository root with `npm test`.

## Settling real instructions

`scripts/settle.mjs` pays a settlement instruction made with `hour-time instruction`. It verifies the instruction against the operator's registry (`--operator-home`), maps payee identities to GCUL accounts (`--payees`), and is a dry run unless you pass `--live`. Each leg is paid at most once across runs, and every run writes evidence. For a step-by-step pilot, see [docs/REAL-HOURS-PILOT.md](../../docs/REAL-HOURS-PILOT.md).

## Known limits

- When a receipt is found only in contract state, after an unknown outcome or a duplicate, GCUL provides no way to recover its transaction hash. `networkTxRef` is then `state:<contractId>/<settlementId>` (ADR-0009 open question 2).
- `UlCliLedger` maps each payee account ID to a local `ul-cli` alias, so every payee must be registered locally first.
- Failed transactions still advance the sender's sequence number. The adapter never treats a sequence advance as proof of payment.
- A live run against integration-testing needs explicit approval, like every transaction before it.

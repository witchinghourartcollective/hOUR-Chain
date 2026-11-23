# ADR-0009: GCUL settlement adapter: mapping, idempotency and reconciliation

Status: Proposed (2026-11-23). Design only: nothing in this document is implemented except the v1 receipt contract described in [GCUL-INTEGRATION-TESTING.md](GCUL-INTEGRATION-TESTING.md). It does not change the token model, the chain architecture (ADR-0005), or Base as the canonical Phase 1 settlement network (ADR-0001).

## Context

[TIME-CONTRIBUTIONS.md](TIME-CONTRIBUTIONS.md) requires a future GCUL adapter to reference approved contribution and agreement identifiers, keep settlement state separate from time and rights approval, and provide idempotency and reconciliation. Its pilot must show a reconciled settlement receipt and prevent duplicate payment.

Verified so far on the no-value `integration-testing` network:

- Accounts, KMS-backed signing, and a 100-unit transfer between user accounts.
- The v1 `SettlementReceipts` contract ([`contracts/gcul/settlement_receipts.py`](../contracts/gcul/settlement_receipts.py)). It recorded a receipt and rejected a repeated settlement ID.

The v1 contract only deduplicates receipts. Paying and recording are separate transactions, so a payment can still be sent twice. Payment-level idempotency belongs to the adapter, and this ADR designs it.

Existing protocol constraints:

- ADR-0001: adapters expose common **simulate, approve, submit, receipt** interfaces.
- ADR-0003 and SPEC.md: anything with settlement meaning is a signed, content-addressed hOUR Chain event. A **settlement instruction** is a deterministic signed calculation of recipients, amounts, network and source event. A **settlement receipt** links to the instruction, evidence version, finality status, and any reversal or dispute.

## Decision

GCUL is an **external settlement network behind an adapter**. hOUR Chain events remain the system of record. GCUL holds only opaque references and the movement of funds.

### 1. Record chain

```
time contribution (claimed -> approved, versioned)
        \
         +--> agreement (approved, versioned) --> obligation (calculated)
                                                      |
                                    settlement instruction event (signed, network=gcul)
                                                      |
                                    one settlement leg per recipient
                                                      |
                     GCUL: settle() call = payment + on-ledger receipt, atomically
                                                      |
                                    settlement receipt event (signed, finality, GCUL tx ref)
```

The adapter never creates, edits or approves contributions, agreements or obligations. It only acts on a signed settlement instruction whose referenced contribution and agreement versions are approved.

### 2. Identifiers and mapping

**Settlement leg.** An instruction pays one or more recipients, and each recipient is one leg.

`settlement_id = "hst1_" + hex(sha256(instructionEventId || ":" || legIndex))[0:40]`

The settlement ID is deterministic: the same instruction and leg always produce the same ID. Retries, restarts and a second adapter instance therefore converge on one ID instead of minting a new one. It is also opaque: it reveals nothing about the work, the people or the rates.

| hOUR record field | GCUL v2 contract field | Notes |
| --- | --- | --- |
| derived as above | `settlement_id` | Primary key and duplicate guard |
| instruction `eventId` | `instruction_id` | Links the receipt back to the signed calculation |
| contribution ID + approved version | `contribution_ref` (`"<id>@<version>"`) | Opaque ID; no titles or names on-ledger |
| agreement ID + approved version | `agreement_ref` (`"<id>@<version>"`) | Binds payment to the exact agreed terms |
| leg recipient's GCUL account | `payee` (`gcul.Account`) | Runtime-validated account; must hold `ROLE_RECEIVER` |
| leg amount (integer minor units) | `amount_minor` and the payment itself | Integers only; no floats anywhere |
| — | GCUL transaction hash | Captured by the adapter from the submission result |

Off-ledger only: names, roles, durations, rates, revenue shares, evidence, and agreement text. On-ledger data is visible to the network operator and permanent, so it must stay minimal. Hashed refs (`sha256(id@version)`) are an option if even opaque IDs are considered sensitive.

### 3. Payment-level idempotency

**Primary mechanism: atomic settle (contract v2).** A payable method pays and records in the same transaction:

```python
@gcul.payable
def settle(self, settlement_id: str, instruction_id: str, contribution_ref: str,
           agreement_ref: str, payee: gcul.Account) -> int:
    assert self.is_owner(gcul.sender), "Only the settlement operator can settle"
    assert settlement_id not in self.contribution_of, "Duplicate settlement_id"
    assert gcul.payment.value > 0, "Payment required"
    # ...record all fields, amount_minor = gcul.payment.value...
    self.native_transfer(payee, gcul.payment)
    return self.receipt_count
```

A failed GCUL method makes no state changes, so a replayed `settlement_id` fails the whole transaction and **no funds move**. This turns receipt deduplication into payment deduplication on the ledger itself, independent of adapter bugs. The language reference documents `@gcul.payable`, `gcul.payment` and `native_transfer`. A minimal version of this method compiles with `gculpyc` v0.2.0 (checked 2026-11-23). Its runtime behaviour with the network's test currency must still be verified on integration-testing (plan step 1).

**Adapter write-ahead log.** The adapter keeps a durable leg table keyed by `settlement_id` with a unique constraint. Every state change is written before the action it describes:

| State | Meaning | Allowed next |
| --- | --- | --- |
| `PLANNED` | Leg derived from a signed instruction | `APPROVED`, `CANCELLED` |
| `APPROVED` | Instruction approvals and referenced versions verified; simulation passed | `SUBMITTING` |
| `SUBMITTING` | Intent persisted; transaction about to be sent | `CONFIRMED`, `REJECTED_DUPLICATE`, `FAILED`, `UNKNOWN` |
| `UNKNOWN` | Timeout or crash; outcome not known | `CONFIRMED`, `FAILED` (only via ledger lookup) |
| `CONFIRMED` | Receipt found on-ledger and fields match | `RECONCILED` |
| `REJECTED_DUPLICATE` | Ledger says already settled | `CONFIRMED` once the existing receipt matches; otherwise `DISPUTED` |
| `FAILED` | Ledger rejected for another reason; no receipt exists | `APPROVED` (retry, same `settlement_id`) |
| `RECONCILED` | Passed reconciliation; receipt event emitted | terminal |
| `DISPUTED` | Mismatch; needs human review | correction flow (section 5) |

Rules:

1. **Never retry blind.** Before any retry, from `UNKNOWN` or `FAILED`, the adapter queries `is_recorded(settlement_id)`. If it is recorded, the leg goes to `CONFIRMED`. Because a replay fails atomically, even a mistaken resubmission cannot pay twice.
2. **One submitter per leg.** The adapter takes a row lock or lease on `SUBMITTING`, so a second worker cannot submit the same leg concurrently. The contract still catches any slip.
3. **Same ID forever.** A retry always reuses the deterministic `settlement_id`. A genuinely new payment requires a new signed instruction.

**Fallback (if atomic settle proves unavailable):** a two-transaction flow. Record the receipt first as a reservation, then transfer with the `settlement_id` in the transfer reference, under the same write-ahead log. An `UNKNOWN` transfer is resolved by comparing the payer's sequence number and balance delta with the log before any retry. This is weaker and is used only if section 3's primary mechanism fails verification.

### 4. Reconciliation

The adapter runs a three-way comparison after every submission and in a daily full pass:

| Source | What it provides |
| --- | --- |
| **Expected:** hOUR settlement instruction events | Legs, payees, amounts, refs |
| **Attempted:** adapter leg table | State, tx hashes, timestamps |
| **Actual:** GCUL contract state and account balances | Receipts and movements of funds |

Checks:

1. Every `APPROVED`-or-later leg has exactly one on-ledger receipt, and every receipt has exactly one leg. A receipt with no leg is an **orphan** and raises an alert.
2. Receipt fields equal the instruction exactly: payee, `amount_minor`, `contribution_ref`, `agreement_ref`, `instruction_id`.
3. The referenced contribution and agreement versions were approved before the instruction's `issuedAt` and have not been superseded by a dispute.
4. The operator account's balance delta over the window equals the sum of settled `amount_minor`. Per payee, the received amount equals the sum of that payee's legs.
5. The contract's `receipt_count` equals the number of confirmed legs for that contract.

On success the adapter emits a signed **settlement receipt event** (hOUR envelope, `network: "gcul"`). It carries the instruction ID, `settlement_id`, GCUL transaction hash, contract ID, finality status, and reconciliation run ID. Any failed check moves the leg to `DISPUTED` and emits a dispute event. Nothing is overwritten.

### 5. Corrections, reversals and disputes

- Receipts are immutable on-ledger and in hOUR.
- A reversal or correction is a **new** signed instruction that references the original (`reverses: <instructionEventId>`). It gets new legs with new `settlement_id`s, and money moves back from payee to operator only with the payee's approval.
- A disputed contribution or agreement version blocks new instructions that reference it. It does not alter receipts that already exist; it starts the correction flow.

### 6. Custody, roles and security disclosure

- The contract owner is a dedicated **settlement-operator** account with its key in Cloud KMS. It should be separate from the account-manager and treasury keys, which on integration-testing currently share one key.
- GCUL signatures are not post-quantum. Per SPEC.md, GCUL receipts are external receipts; the hOUR receipt event carries the PQC-capable signature. No end-to-end post-quantum claim is made.
- Payees need GCUL user accounts with `ROLE_RECEIVER`. How contributors without GCUL accounts are paid (custodial sub-accounts or another network) is an open question.

### 7. Limits

- All contract fields share about 5 MiB, which is roughly 10–15k v2 receipts. Production should roll to a new contract per period (the adapter tracks the active contract ID) or move receipts into per-payee account fields.
- Computation per transaction is capped network-wide. A single `settle()` call per leg stays well inside it.
- Real-value settlement requires a Currency Operator and Google approval for `user-testing` and then mainnet.

## Interfaces (ADR-0001)

| Interface | GCUL adapter behaviour |
| --- | --- |
| `simulate(instruction)` | Validate the instruction signature, approvals and referenced versions; derive legs and `settlement_id`s; check payee accounts and roles, operator balance, and `is_recorded` for each leg; no submission. Optionally build each transaction with `--sign-only` without submitting it. |
| `approve(instruction)` | Record the required approvals; legs move to `APPROVED`. |
| `submit(leg)` | Write-ahead `SUBMITTING`, then call `settle()` once; map the result to the states in section 3. |
| `receipt(leg)` | Read the on-ledger receipt, run reconciliation, emit the signed hOUR receipt event. |

## Pilot mapping (TIME-CONTRIBUTIONS.md)

| Pilot criterion | Where it is shown |
| --- | --- |
| Attributable, approved time contribution | hOUR events; referenced as `contribution_ref` |
| Agreed compensation basis | Approved agreement version; `agreement_ref` |
| Calculated obligation | Signed settlement instruction |
| Reconciled settlement receipt | Section 4, then the hOUR receipt event |
| Rejected or disputed claim; traceable correction | Section 5 |
| Prevention of duplicate payment | Section 3: atomic `settle()` plus never-blind retry, demonstrated by a replay test |
| Simulated and live reported separately | Integration-testing runs are labelled simulated; only Currency-Operator-backed settlement is live |

## Implementation plan

1. **Contract v2 on integration-testing:** add `settle()` (payable, atomic) plus `instruction_id`. Verify payment, forwarding to the payee, duplicate rejection with no movement of funds, and the non-owner rejection. Keep v1 deployed as the historical test.
2. **Schema:** add `"gcul"` to the event-envelope `network` enum and define the instruction and receipt payload schemas (legs, `settlement_id`, refs, finality).
3. **Adapter service:** leg table with a unique `settlement_id`, the state machine, the four interfaces, and KMS signing through the `ul-cli` or API client.
4. **Reconciliation job** with the checks in section 4, plus fault-injection tests: crash after submit, timeout, duplicate worker, orphan receipt, amount mismatch.
5. **Pilot run** on integration-testing covering the criteria above, reported as simulated.
6. **Apply for `user-testing`** with this ADR and the pilot evidence. Then mainnet and a Currency Operator.

## Open questions (for Google where noted)

1. Does `@gcul.payable` with `native_transfer` work with the network's test currency on integration-testing, and which roles does the contract account need? *(Google)*
2. Does GCUL offer client idempotency keys or lookup of a transaction by hash? Either would simplify `UNKNOWN` resolution. *(Google)*
3. What does a Currency Operator arrangement require for USD-denominated creator payouts? *(Google)*
4. How are payees without GCUL accounts onboarded? Options include the account manager creating `USR` accounts for them, or settling those legs on Base instead.

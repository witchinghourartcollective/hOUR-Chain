# time-contributions

This package implements the real-hours contribution workflow from [TIME-CONTRIBUTIONS.md](../../docs/TIME-CONTRIBUTIONS.md): attributable hours of creative work are claimed, approved by collaborators, linked to a separately approved agreement, and turned into a calculated payment obligation. The settlement adapter can then pay that obligation, for example [`gcul-adapter`](../gcul-adapter/README.md).

Time is a record of contribution. It does not grant ownership or set payment on its own. Money moves only under an explicit agreement, and an obligation is distinct from a completed payment. This package defines no token, conversion rate or minting.

## Records

Every record is a signed hOUR Chain event (`specs/event-envelope.schema.json`, ML-DSA via `pqc-profile`) with a content-addressed payload defined in [`specs/payloads/time-contributions.schema.json`](../../specs/payloads/time-contributions.schema.json). The envelope gets no new fields.

| `eventType` | Signed by | Payload |
| --- | --- | --- |
| `contribution.claimed` | the contributor | Work, role, activity, `durationSeconds` (an integer), optional `startAt` / `endAt` / `timezone`, evidence references, and reviewers. A correction is `version + 1` with `amends`. |
| `contribution.reviewed` | each reviewer | `approve` or `dispute` (with a reason) for one exact version |
| `agreement.proposed` | a party | Exactly one of `feeMinor`, `rateMinorPerHour` or `shareBps`, plus the payee, the parties, the currency, and a reference to the off-ledger terms |
| `agreement.reviewed` | each party | `approve` or `dispute` for one exact version |
| `revenue.reported` | an operator | Revenue for a work and period, used by revenue-share agreements |
| `obligation.calculated` | an operator | The amount, with the formula and the rounding remainder. The registry recomputes it and rejects any mismatch. |

## Rules enforced by `ContributionRegistry.append()`

A rejected event changes nothing.

- **Signatures and identity:** the payload must match its hash, the ML-DSA signature must verify, and the signer must be the `actor`. Contributors claim only their own time. Reviewers and parties sign their own decisions.
- **Time:** durations are positive integer seconds. When start and end times are given, the duration must fit inside them. Claims by the same contributor may not overlap. An untimed claim that duplicates another must add times to tell the sessions apart.
- **Approval:** a version is approved only when every listed reviewer (for a contribution) or every party (for an agreement) approves it. One dispute blocks that version. Decisions are immutable, and a contributor cannot review their own claim.
- **History:** a correction is a new version that references the previous one. Earlier versions, and their reviews and disputes, stay in the log as `SUPERSEDED`. Approvals never carry over to a new version.
- **Obligations:** an obligation requires the current approved version of both the contribution and the agreement, and that agreement must cover that contribution. The amount must equal the deterministic, integer-only calculation, which rounds down and records the remainder. Only one obligation is allowed per contribution version, agreement version and revenue report. Amending either record makes existing obligations stale, and a stale obligation cannot be settled.

## Settlement

`buildSettlementInstruction(registry, obligationEventId, { network, currency, payeeAccount })` returns a payload that matches `specs/payloads/settlement-instruction.schema.json`. The operator signs it as a `settlement.instruction` event. Pass `isApproved: (ref) => registry.isApproved(ref)` to `GculSettlementAdapter`, and the adapter will settle only obligations whose records are still approved.

## Command line: `hour-time`

Each person has a profile in `$HOUR_HOME` (default `~/.hour`) holding their ML-DSA-65 signing key (mode 600), the public keys they trust, and the store path. Run `npm run hour-time -- help` from the repository root for every command.

```
# once per person
hour-time keygen --identity producer          # prints the public key to share
hour-time trust --identity artist --public-key <their key>
hour-time config --store /shared/registry.db --operators hour-operator

# the workflow
hour-time claim --contribution-id contrib-s1 --work work-07 --role producer --activity recording \
  --duration 2h --start 2026-11-20T18:00:00Z --end 2026-11-20T20:00:00Z --reviewers artist,engineer
hour-time review --contribution-id contrib-s1 --version 1 --approve          # run by each reviewer
hour-time propose-agreement --agreement-id agree-s1 --work work-07 --contribution-id contrib-s1 \
  --payee producer --parties producer,artist --currency DEM --terms-ref vault://t/1 --rate-per-hour 3000
hour-time review-agreement --agreement-id agree-s1 --version 1 --approve    # run by each party
hour-time obligation --obligation-id obl-1 --contribution-ref contrib-s1@1 --agreement-ref agree-s1@1   # operator; amount computed
hour-time instruction --obligation <event id> --payee-account 1:USR:DEM:... --currency DEM --out instruction.json
```

A collaborator without access to the store adds `--out file.json` to any write command, which signs without appending, and sends the file to whoever holds the store, who runs `hour-time append file.json`. Corrections use `claim ... --amends`. Disputes require `--reason`. `hour-time head` prints the `{ seq, hash }` to record as an anchor.

## Storage

`DurableRegistry(path, { resolveKey, operators, expectedHead? })` has the same query API as `ContributionRegistry`, and persists events in SQLite (`node:sqlite`):

- **Atomic appends.** Each event is validated and written inside one `BEGIN IMMEDIATE` transaction, so a rejected event never reaches disk and two writers cannot interleave.
- **Corruption and naive tampering.** Every row carries `entry_hash = sha256(prev_hash + "\n" + canonical event)`. Every open checks contiguous sequence numbers and the unbroken chain, then replays the whole log, re-verifying every ML-DSA signature, payload hash and rule. An edited, inserted or removed row refuses to open.
- **No rollback.** A running instance never moves backwards. Once it has verified an entry, any later state must still contain that exact entry. Deleting a trailing amendment, or rewriting history to the same length, makes the store refuse to answer, so a stale obligation cannot become payable again.
- **Deliberate rewrites need an anchor.** Someone with write access to the file could delete events (for example a dispute), renumber and recompute the whole chain while nothing is running. Replay accepts the result if the remaining events still form a valid workflow. To detect that, record `head()` (`{ seq, hash }`, including the genesis `{ seq: 0 }`) somewhere they cannot rewrite, for example on a ledger, and pass it back as `expectedHead`. The anchor is enforced on every reload and covers all history up to its `seq`.
- **Several processes.** Every query and append first picks up rows appended by other processes. A settlement adapter in one process therefore sees an amendment made in another, and cancels the stale leg instead of paying it.
- **Backup.** `exportJsonl()` writes one canonical signed event per line. `DurableRegistry.importJsonl(path, text, options)` restores the backup into an empty store, all or nothing: the whole backup is verified, and checked against an optional `expectedHead`, before anything is written.

Replay re-verifies every signature on open. That is fine at pilot scale; larger logs would need verified checkpoints.

## Status

Tested offline, including an end-to-end run of every TIME-CONTRIBUTIONS.md pilot criterion through `gcul-adapter` on a fake ledger, and durable storage with tamper, truncation and multi-process tests. A command-line client (`hour-time`) is included. Not built yet: an application UI and a pilot with real collaborators.

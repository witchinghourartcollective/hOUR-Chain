# Real-hours contribution model

Status: product requirement and implementation direction, restored 2026-10-22. This document does not claim the complete workflow is implemented or alter the existing chain architecture, event schema, or token model.

## Purpose

"Spending hOURS like currency" connects hOUR Chain (HBC) to actual hours of creative work. Production, engineering, rehearsal, performance, design, and other contributions should be visible, attributable, approved, and connected to compensation through explicit agreements.

For example, a producer documents two hours on a recording and attaches session evidence. Collaborators approve the contribution. A separately approved agreement determines whether that work receives a fixed fee, an agreed hourly rate, a revenue share, or another arrangement. Payment calculations and settlement receipts reference those approved records.

## Required workflow

1. Identify the work or session, contributor, role, and activity.
2. Record the actual duration and, where appropriate, start/end times and timezone. Preserve the distinction between claimed and approved time.
3. Attach evidence references while keeping private session records, agreements, and media under suitable access controls.
4. Have the relevant participants explicitly approve or dispute the contribution. Preserve approval identities, versions, and amendment history.
5. Link the approved contribution to a separately approved compensation or rights agreement.
6. Calculate obligations under that agreement and record settlement receipts with traceable references.

Use exact duration units such as integer seconds or minutes in a future schema design. Validate non-negative durations and address overlapping or duplicate claims. These are implementation requirements, not new fields in the current event envelope.

## Separate records and decisions

- Time measures a contribution; it does not by itself grant ownership or determine payment.
- Rights percentages, hourly rates, fees, and revenue shares require explicit agreement.
- A payment obligation is distinct from a completed payment.
- Corrections and disputes must preserve history rather than silently overwrite approved records.
- This model does not specify one token per hour, a fixed cash value, redemption, or automatic token minting. Token economics remain a separate design decision.

## Repository and adapter requirements

Every HBC repository should expose this concept in its README and keep its implementation status explicit. This applies to protocol, application, storage, consent, and settlement components without changing their established architecture or deployment status.

- Protocol and applications: support attributable time records, approvals, agreement references, and traceability when the workflow is implemented.
- Filecoin integration: preserve evidence and agreement references with appropriate privacy and retrieval controls; storing a claim does not verify the work happened.
- Consent integrations, including the existing Solana module: bind approvals to the exact contribution/agreement version if developed further. This requirement does not resume a paused integration.
- Future GCUL adapter or repository: include the real-hours model in its README and integration design from inception. Reference approved contribution and agreement identifiers in accounting/settlement mappings where supported; keep settlement state separate from time and rights approval; require idempotency and reconciliation. GCUL capabilities, access, and implementation remain to be confirmed.

The intended organizational home is the hOUR blockchain GitHub organization designated by the project owner. This document does not transfer repositories or declare an unverified organization URL canonical.

## Pilot acceptance criteria

A pilot should demonstrate one attributable time contribution, participant approval, an agreed compensation basis, a calculated obligation, and a reconciled settlement receipt. It should also demonstrate rejection or dispute of a claim, a traceable correction, and prevention of duplicate payment. Report simulated and live settlement separately.

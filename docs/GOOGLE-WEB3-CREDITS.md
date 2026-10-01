# Google for Startups Cloud Program — Web3 Application

Status: application prep. Program terms checked against
<https://cloud.google.com/startup/web3> on 2026-10-01; re-check before submitting.

This document follows the rules in `FUNDING.md` and `CLOUD-COST-BASELINE.md`.
Every number in the application must trace to one of those documents or to an
invoice.

## Which tier

| Tier | Credits | Eligibility | Fit today |
| --- | --- | --- | --- |
| **Start** | Up to US$2,000, 1 year | Working MVP, clear business model, plans to seek venture funding soon; founded within 24 months; no prior Google Cloud credits beyond the free trial | **Apply here**, if the founding-date and prior-credits rows below check out |
| **Scale** | Up to US$200,000 over 2 years (100% of the first $100k, 20% of the next $100k) | Pre-seed/seed equity, SAFE, convertible note, verifiable token raise, or blockchain-foundation grant within 5 years; founded within 5 years | **Not eligible yet.** Self-funding does not qualify. A Base or Filecoin ecosystem grant would (see `FUNDING.md` funding ladder, steps 3–4) |

Google evaluates funding that doesn't qualify for Scale (crowdfunding, friends and family, prizes, government grants) for Start instead.

## Eligibility checklist

| Requirement | Status | Evidence / action |
| --- | --- | --- |
| Business email on the startup's website domain | Ready | `@witchinghourmac.com` mailbox (Zoho MX); site live at <https://witchinghourmac.com> |
| 18-character Google Cloud billing account ID | Owner to confirm | Use the billing account that will carry hOUR Chain workloads |
| No prior Google Cloud credits beyond the free trial (Start) | **Owner to confirm** | Check *Billing → Credits* on every billing account the company has used |
| Founded within the last 24 months (Start) | **Owner to confirm** | Use the legal entity's formation date. If the entity is older, Start is closed and the route is a Scale-qualifying grant |
| Working MVP | Partial | This repo is pre-alpha. Present the running ecosystem as the MVP (see below), with hOUR Chain as the protocol layer being built on it |
| Not an excluded category | Ready, with care | Excluded categories include mining companies and companies distributing tokens contrary to regulatory guidance. The application must not mention a token sale (`FUNDING.md` rule), and it must keep any ecosystem token activity separate from hOUR Chain, as `FIRST-RELEASE-PILOT.md` already requires |
| Workspace rule | Check | The company domain must not have moved to a paid Google Workspace plan within 31 days of applying |

## What counts as the MVP

Name only components that are running and can be demonstrated on request:

- Witching Hour App: creator-facing web product.
- Lightning node on a DigitalOcean host, with live channels.
- WHM onchain agent: automated wallet and payment workflows on Base.
- hOUR Chain PQC signing profile: ML-DSA-65 and SLH-DSA-SHA2-128s signed event envelopes, a fail-closed suite registry, and CI-tested conformance between the spec and the schema (`packages/pqc-profile/`, `specs/`).

Don't describe hOUR Chain as a live chain, L1, or mainnet (README status).

## Workloads the credits would fund

Each line is a 30-day deliverable with a success metric, as `FUNDING.md` requires
under "Evidence gates".

| Workload | Google Cloud service | Why Google specifically | 30-day deliverable |
| --- | --- | --- | --- |
| PQC root and recovery keys | Cloud KMS, quantum-safe signatures (ML-DSA-65, SLH-DSA-SHA2-128s) | Cloud KMS supports exactly the two suites in `specs/signature-suite-registry.json`, so protocol root, recovery, and release-signing keys can live in a managed KMS without changing the spec | Envelope signed by a KMS-held ML-DSA-65 key verifies against `verifyEnvelope` in CI |
| Managed EVM RPC | Blockchain RPC / Blockchain Node Engine | Runs the "capped managed RPC instead of a self-hosted node" experiment that `CLOUD-COST-BASELINE.md` calls for | Base testnet reads and writes for the first-release pilot, with a measured monthly cost |
| Indexer and verification API | Cloud Run | Scales to zero while the pilot is small | Public read endpoint that verifies the provenance events of one real release |
| Evidence archive | Cloud Storage | Durable, versioned store for evidence references | Pilot evidence bundle stored with an integrity hash recorded in an event |
| Chain analytics | BigQuery public blockchain datasets | Settlement-receipt reconciliation without running archive nodes | Receipt reconciliation query for pilot settlements |

A Start-tier grant of up to US$2,000 should cover the first two to three rows for the pilot period. The application should say so, rather than presenting US$2,000 as a fix for the full US$569+/month floor.

## Draft application answers

**One-line description.** hOUR Chain is a post-quantum-native protocol for
creator rights, provenance, and settlement, built for the Witching Hour music
and art ecosystem and settling on Base.

**Problem.** Independent artists and collaborators lack a verifiable,
portable record of who made a work, how rights and splits changed, and whether
they were paid. Existing records are fragmented across distributors, PROs, and
spreadsheets, and onchain alternatives use signatures that won't survive a
cryptographically relevant quantum computer.

**What's built.** A specified event envelope with versioned, downgrade-resistant
signature suites; a reference ML-DSA-65 / SLH-DSA implementation with
fail-closed verification; a wallet-optional first-release pilot design; and a
running ecosystem (web app, Lightning node, Base onchain agent) that the protocol
will serve.

**Business model.** Paid creator pilots for rights setup, provenance,
split approvals, settlement receipts, and statements; later, protocol services
for labels, collectives, and live-event operators.

**Why Google Cloud.** Cloud KMS's quantum-safe signatures match the protocol's
signature suites one-for-one. Blockchain RPC replaces a self-hosted node that
proved costly to operate.

**Funding status.** Self-funded by a solo founder at approximately
US$569+/month (owner-reported, pending billing reconciliation). Planning to
seek pre-seed funding after the first-release pilot produces 30 days of measured
usage.

## Open questions before submitting

1. **GCP line in `CLOUD-COST-BASELINE.md`.** It still lists "two running
   blockchain full nodes, ~$300/month" on GCP. If the Ethereum node has been
   shut down and GCP usage is paused, update that row before the application
   cites the baseline, because a reviewer can check it against the billing
   account.
2. **Infrastructure direction.** Running these workloads on Google Cloud
   conflicts with any policy of self-hosting only free/open-source software.
   Decide which workloads move to Google Cloud before naming them in the
   application.
3. **Entity formation date and prior credits**, which decide whether Start is
   available at all.

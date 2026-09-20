---
name: code-review
description: Review changes to this repository. Use for any pull request or diff touching SPEC.md, the event-envelope schema, the ADRs, the trust and threat models, or the cost and funding docs.
---

# Reviewing hOUR Chain

This is a protocol specification, not an implementation. There is no build, no
test runner and no CI. The artifacts are `SPEC.md`, `THREAT-MODEL.md`,
`TRUST-MODEL.md`, the ADRs, `specs/event-envelope.schema.json`, and the cost and
funding documents. A defect here is a requirement that contradicts another
requirement, or a number that cannot be evidenced — both of which propagate into
everything built later.

Run `python3 specs/check-conformance.py` before forming an opinion on any change
to `SPEC.md` or the schema. Standard library only, no install step. It exits
non-zero and names each disagreement.

## Documents that must agree

The single recurring defect in this repository is two files stating
incompatible things while each looks correct alone. Review in pairs.

**`SPEC.md` against `specs/event-envelope.schema.json`.** This has already
drifted once: `SPEC.md` Draft 0.2 began requiring a "signature-suite version"
while the schema defined `signature` as `{algorithm, signer, value}` with
`additionalProperties: false`, so a document mandating downgrade resistance
shipped beside a schema that made downgrade detection impossible. Nothing
caught it because nothing compared them. That comparison is now
`specs/check-conformance.py`; a change to either file that makes it fail is
blocking, and a requirement deliberately dropped from `SPEC.md` must also drop
its assertions.

**An ADR against the ADRs it depends on.** ADR-0003 derives the envelope
boundary from ADR-0002's post-quantum requirements. An Accepted ADR resting on
a Proposed one is backwards; check the status line, not just the argument.

**ADR numbering.** Two documents have already tried to claim ADR-0002
simultaneously. Check `docs/` for the number before adding one.

## Post-quantum requirements are binding

ADR-0002 is Accepted, so these constrain every later change rather than
advising it:

- Algorithms must stay **replaceable through governance**. A hard enum of
  algorithm names in the schema makes each approved change a schema break, so
  the accepted set belongs in the signature-suite registry. A diff that pins
  them into the schema fights the ADR.
- Suite versions must stay **orderable**. Downgrade resistance means a
  validator decides an offered suite is older than its accepted minimum, which
  is a comparison. A version loosened to free-form text (`v1`, `latest`,
  `1.0-rc1`) silently removes downgrade detection while still looking like a
  version field.
- **No component may claim end-to-end post-quantum security** while a
  security-critical proof, trusted setup, bridge, consensus path, administrator
  path, or settlement dependency relies solely on quantum-vulnerable public-key
  cryptography. Phase 1 settles on Base, Lightning and Solana, none of which are
  post-quantum. A diff that blurs an hOUR-signed record together with an
  external settlement receipt is a correctness finding, not a wording nit.
- Custom cryptographic primitives are prohibited. Reviewed standards only.

## Schema review

`additionalProperties: false` on the envelope is what makes the ADR-0003
boundary enforceable rather than advisory. Removing it anywhere is blocking.

Unconstrained strings accept the empty string. `signature.algorithm`, `signer`
and `value` carry `minLength: 1` for that reason — a signature of `""` used to
satisfy the schema. `actor`, `subject`, `eventType`, `protocolVersion` and
`schemaVersion` still do not, and a new field without a length or pattern
constraint repeats the same hole.

## Numbers must be evidenced

`docs/CLOUD-COST-BASELINE.md` feeds a funding application, which makes an
unevidenced figure a different category of problem from a wrong one.

This has already gone wrong: a US$2,870/month table was presented as "the
current baseline" and "Current burn estimate" with no billing data behind it,
including US$1,780/month of AWS for an indexer and API that do not exist in
this repository, and a resource audit asserting duplicate Postgres and Redis
stacks that nobody had looked for. It also contradicted its own total by $300.

So, for any diff touching cost or funding:

- **Add up the table.** Confirm the line items match the stated total, and that
  any derived figure (per-creator, per-event) divides the same total.
- **Check every label.** "Actual", "current" and "baseline" are claims about
  measurement. "Projected" and "estimated" are not. The document separates an
  owner-reported floor from a pilot-scale projection deliberately; a diff that
  merges them, or relabels a projection as current burn, is blocking.
- **Check that asserted findings were actually found.** An audit that did not
  happen must not be written as one.
- **There is no AWS spend.** AWS Activate is a credits programme being applied
  to, and Activate is aimed at startups not yet spending on AWS. A document
  claiming existing AWS production spend damages that application as well as
  being untrue.

## What to report, and how

Say which two files disagree and on what, or which number does not add up.
"This could be clearer" is not a finding; "SPEC.md requires a suite version the
schema has no field for, so a retired suite cannot be rejected" is.

Verify before reporting. Run the conformance check. Sum the table. Resolve every
path a document names. Several findings here were reproduced before being
written down, and at least one review comment pointed at real code while the
more serious instance of the same bug sat beside it.

Do not invent severity. A style preference reported as a risk trains the author
to ignore the next real finding.

Rank blocking findings first: contradictions between binding documents, then
unevidenced claims headed for an external reader, then everything else.

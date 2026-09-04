# ADR-0002: Boundary between the hOUR Chain envelope and the platform envelope

Status: Proposed

## Context

Two event envelopes exist in the ecosystem, and neither repository mentions the
other.

- `hOUR-Chain/specs/event-envelope.schema.json` — the canonical protocol
  envelope described in `SPEC.md`.
- `witching-hour-platform/packages/contracts/schemas/event-envelope.schema.json`
  — the envelope its Cloudflare Worker validates and records in the D1 event
  ledger.

Their field names are disjoint, and both set `additionalProperties: false`:

| Concept | Platform | hOUR Chain |
| --- | --- | --- |
| Identifier | `id` | `eventId` |
| Type | `type` | `eventType` |
| Time | `time` | `issuedAt` |
| Versioning | `specVersion`, `version` | `protocolVersion`, `schemaVersion` |
| Origin | `source` | `actor` |
| Subject | `subject` | `subject` |
| Payload | `data`, inline object | `payloadHash`, content-addressed |
| Causality | `correlationId`, `causationId` | `previousEventRefs` |
| Signature | HMAC over the HTTP request | `signature` object inside the envelope |
| Network | not represented | `network`, including `lightning` |
| Environment | `environment` | not represented |

`subject` is the only shared name. This is not a mapping gap: the platform's
`validateEnvelope` rejects unknown fields, so an hOUR Chain event submitted to
it fails on `eventId` before any other rule is evaluated. The reverse also
fails.

Two differences are substantive rather than cosmetic.

**Payload by hash versus by value.** The platform carries `data` inline, capped
at 64 KiB, with `privateKey`, `seedPhrase` and `mnemonic` rejected. hOUR Chain
carries only `payloadHash` and keeps the payload outside the event. For an
append-only provenance log the content-addressed form is the better fit, and it
satisfies principle 1 of `TRUST-MODEL.md` directly.

**Where the signature lives.** hOUR Chain signs the envelope. The platform
authenticates the HTTP request with an HMAC and a freshness window. That
protects the hop, not the record: once a platform event is written to D1,
nothing in it proves who produced it. `SPEC.md` requires "signature and
verification material" in the envelope, which the platform envelope has no
field for.

## Decision

Keep both, at different layers, with an explicit boundary.

1. **The hOUR Chain envelope is the canonical protocol record.** Every event
   that carries rights, provenance, settlement or authorization meaning uses
   it, signed, content-addressed and append-only.
2. **The platform envelope is a service-internal observation format.** It is
   what Witching Hour services emit and what the Worker validates and stores.
   It is not a protocol record and must not be treated as one.
3. **A documented adapter promotes observations into protocol events.** It maps
   the fields, resolves `data` to a `payloadHash`, and signs. Promotion is the
   moment a `Platform-attested` claim enters the protocol.

`TRUST-MODEL.md` already contains the reason this works. **Platform-attested**
is one of six trust classes, defined as "observed or validated by a Witching
Hour service". Platform events are exactly that and nothing stronger. They are
not creator-signed, not counterparty-acknowledged, and not network-settled.
Promoting them without a signature would let a service observation enter the
record at a trust class it has not earned.

## Options considered

**Adopt the hOUR Chain envelope everywhere.** One vocabulary, signatures that
survive relay. Rejected for now: it requires rewriting the platform's
contracts, validator, Worker and test suite, and it discards `environment`,
which the platform uses to keep development traffic out of production records.
The gain is real but is not worth blocking the current work.

**Adopt the platform envelope everywhere.** Rejected. It would remove
in-envelope signatures and content addressing, which are the two properties the
protocol most needs, in exchange for convenience in one service.

**Rename platform fields to match without changing shape.** Rejected as
insufficient. It removes surface confusion while leaving the structural
differences, and would suggest a compatibility that does not exist.

**Keep both with an explicit boundary.** Chosen. Each envelope is correct for
its layer, no working code is rewritten, and the mapping is written down before
new event families are designed against the wrong one.

## Consequences

- `specs/` gains a mapping table from platform fields to protocol fields, and
  names the fields that have no counterpart in each direction.
- The adapter is the only sanctioned path from a platform event to a protocol
  event. Direct submission of platform-shaped events to the protocol is invalid.
- Events promoted through the adapter enter at trust class
  **Platform-attested** and no higher, until separately signed or verified.
- The platform keeps HTTP-layer authentication for ingest. That remains
  appropriate for transport and is not represented as provenance.
- Revisit if the platform ever needs to relay events it did not originate. At
  that point transport-only authentication stops being sufficient and adopting
  the protocol envelope throughout becomes the better trade.

## Immediate consequence for Lightning

`network` in the hOUR Chain envelope already enumerates `lightning`, and
`README.md` lists a Lightning adapter. A separate `com.witchinghour.lightning.*`
event family was being considered for the platform.

Under this decision the two are not alternatives, and the split is:

- **Operational Lightning telemetry** — node health, channel counts, forwarding
  totals, fee policy. Read-only, no rights meaning. These belong in the
  platform envelope and stay there.
- **Lightning as a settlement network** — settlement instructions and receipts
  where `network` is `lightning`. These are protocol records and use the hOUR
  Chain envelope with a signature.

Deciding this before either is built avoids inventing Lightning events in a
shape that cannot be promoted later.

## Not decided here

- The concrete field mapping. This ADR states that one is required and where it
  lives, not its contents.
- The signing algorithm and signer identity used at promotion.
- Whether the platform eventually adopts the protocol envelope wholesale.

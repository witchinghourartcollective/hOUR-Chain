import { createHash, randomUUID } from "node:crypto";
import canonicalize from "canonicalize";
import { signEnvelope, verifyEnvelope } from "./index.mjs";
import { assertEnvelopeSchema } from "./schema.mjs";

const DOMAIN = "HBC-EVIDENCE-RECORD-v1";

function bytes(value) {
  return Buffer.from(canonicalize(value), "utf8");
}

function digest(value) {
  return createHash("sha512").update(bytes(value)).digest("hex");
}

function text(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required`);
}

function timestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value) throw new TypeError("Use a canonical UTC timestamp");
}

/** Content address of the complete record, including its signature. */
export function evidenceRecordHash(record) {
  return `sha512:${digest({ domain: DOMAIN, record })}`;
}

/**
 * Seal authorization evidence or renew the head of an existing chain.
 * The caller supplies public evidence only; private keys stay with its signer.
 * A signed issuedAt is a claim, not independently verified time.
 */
export function sealEvidence(evidence, privateKey, {
  signer, subject, previousRecordHash = null, issuedAt = new Date().toISOString(),
  algorithm = "ML-DSA-65", suiteVersion = "1.0.0",
} = {}) {
  text(signer, "signer");
  text(subject, "subject");
  timestamp(issuedAt);
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new TypeError("Evidence must be an object");
  }
  if (previousRecordHash !== null && !/^sha512:[a-f0-9]{128}$/.test(previousRecordHash)) {
    throw new TypeError("Invalid previous record hash");
  }
  const payload = JSON.parse(bytes({ domain: DOMAIN, evidence, previousRecordHash }));
  const envelope = signEnvelope({
    eventId: randomUUID(), protocolVersion: "0.1.0", schemaVersion: "0.1.0",
    eventType: previousRecordHash === null ? "evidence.authorization" : "evidence.renewal",
    actor: signer, subject, issuedAt,
    payloadHash: createHash("sha256").update(bytes(payload)).digest("hex"),
    network: "offchain", nonce: randomUUID(),
  }, privateKey, { signer, algorithm, suiteVersion });
  return { payload, envelope };
}

/**
 * Verify from genesis to an externally pinned head. resolveKey must enforce
 * subject/key/epoch authorization; a key embedded in the record is not trusted.
 * Synchronous callbacks only. Time anchoring is a separate verifier policy.
 */
export function verifyEvidenceChain(records, { resolveKey, expectedHead } = {}) {
  try {
    if (typeof resolveKey !== "function") throw new TypeError("Trusted key resolver is required");
    if (!/^sha512:[a-f0-9]{128}$/.test(expectedHead ?? "")) throw new TypeError("Pinned head is required");
    if (!Array.isArray(records) || records.length === 0) throw new TypeError("Empty evidence chain");
    let previous = null;
    let subject;
    let lastTime = -Infinity;
    for (const record of records) {
      const { payload, envelope } = record;
      assertEnvelopeSchema(envelope);
      if (payload?.domain !== DOMAIN || payload.previousRecordHash !== previous) {
        throw new Error("Broken evidence chain");
      }
      if (!payload.evidence || typeof payload.evidence !== "object" || Array.isArray(payload.evidence)) {
        throw new Error("Invalid evidence payload");
      }
      timestamp(envelope.issuedAt);
      if (Date.parse(envelope.issuedAt) < lastTime) throw new Error("Non-monotonic claimed time");
      lastTime = Date.parse(envelope.issuedAt);
      text(envelope.subject, "subject");
      subject ??= envelope.subject;
      if (envelope.subject !== subject || envelope.actor !== envelope.signature?.signer ||
          envelope.eventType !== (previous === null ? "evidence.authorization" : "evidence.renewal")) {
        throw new Error("Evidence identity or kind mismatch");
      }
      if (envelope.payloadHash !== createHash("sha256").update(bytes(payload)).digest("hex")) {
        throw new Error("Evidence payload was modified");
      }
      const key = resolveKey(envelope.signature, envelope);
      if (key !== null && (typeof key === "object" || typeof key === "function") &&
          typeof key.then === "function") {
        // The API is synchronous. Observe eventual rejection before refusing
        // asynchronous resolvers, so a caller error cannot terminate Node.
        Promise.resolve(key).catch(() => {});
        throw new TypeError("Async key resolvers are unsupported");
      }
      if (!verifyEnvelope(envelope, key).valid) throw new Error("Untrusted or invalid signature");
      previous = evidenceRecordHash(record);
    }
    if (previous !== expectedHead) throw new Error("Evidence head does not match pinned checkpoint");
    return { valid: true, head: previous, records: records.length, timeAnchored: false };
  } catch (error) {
    return { valid: false, reason: error.message };
  }
}

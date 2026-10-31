import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify, KeyObject } from "node:crypto";
import { spawnSync } from "node:child_process";
import { canonicalSigningBytes, generateTestKeyPair, signEnvelope, verifyEnvelope } from "../src/index.mjs";
import { evidenceRecordHash, sealEvidence, verifyEvidenceChain } from "../src/evidence.mjs";

test("a classical key cannot be labelled as a post-quantum suite", () => {
  const keys = generateKeyPairSync("ed25519");
  assert.throws(() => signEnvelope({}, keys.privateKey, { signer: "agent:one" }), /match/);
  const pq = generateTestKeyPair();
  const { envelope } = sealEvidence({ action: "test" }, pq.privateKey, { signer: "agent:one", subject: "work:one" });
  envelope.signature.value = sign(null, canonicalSigningBytes(envelope), keys.privateKey).toString("base64url");
  assert.equal(verify(null, canonicalSigningBytes(envelope), keys.publicKey, Buffer.from(envelope.signature.value, "base64url")), true);
  assert.equal(verifyEnvelope(envelope, keys.publicKey).valid, false);
  const privateWrapper = { key: keys.privateKey, type: "private", asymmetricKeyType: "ml-dsa-65" };
  const publicWrapper = { key: keys.publicKey, type: "public", asymmetricKeyType: "ml-dsa-65" };
  assert.throws(() => signEnvelope(envelope, privateWrapper, { signer: "agent:one" }), /match/);
  assert.equal(verifyEnvelope(envelope, publicWrapper).valid, false);
  // A forged prototype must not make a wrapper into a genuine native key.
  Object.setPrototypeOf(privateWrapper, KeyObject.prototype);
  Object.setPrototypeOf(publicWrapper, KeyObject.prototype);
  assert.throws(() => signEnvelope(envelope, privateWrapper, { signer: "agent:one" }), /match/);
  assert.equal(verifyEnvelope(envelope, publicWrapper).valid, false);
  // Even real KeyObjects can have caller-controlled metadata shadowing getters.
  Object.defineProperty(keys.privateKey, "asymmetricKeyType", { value: "ml-dsa-65" });
  Object.defineProperty(keys.publicKey, "asymmetricKeyType", { value: "ml-dsa-65" });
  assert.throws(() => signEnvelope(envelope, keys.privateKey, { signer: "agent:one" }), /match/);
  assert.equal(verifyEnvelope(envelope, keys.publicKey).valid, false);
});

test("rejecting async resolvers and thenables cannot cause unhandled rejections", () => {
  const script = `
    import assert from 'node:assert/strict';
    import { generateTestKeyPair } from './packages/pqc-profile/src/index.mjs';
    import { sealEvidence, evidenceRecordHash, verifyEvidenceChain } from './packages/pqc-profile/src/evidence.mjs';
    const keys = generateTestKeyPair();
    const record = sealEvidence({ action: 'test' }, keys.privateKey, { signer: 'key:one', subject: 'work:one' });
    for (const resolveKey of [
      async () => keys.publicKey,
      async () => { throw new Error('resolver rejection'); },
      () => ({ then(resolve, reject) { reject(new Error('thenable rejection')); } }),
    ]) {
      const result = verifyEvidenceChain([record], { expectedHead: evidenceRecordHash(record), resolveKey });
      assert.equal(result.valid, false);
      assert.match(result.reason, /Async key resolvers are unsupported/);
    }
    await new Promise(resolve => setImmediate(resolve));
  `;
  const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
});

test("correctly signed and pinned malformed envelopes fail schema validation before key resolution", () => {
  const keys = generateTestKeyPair();
  const original = sealEvidence({ action: "test" }, keys.privateKey, { signer: "key:one", subject: "work:one" });
  for (const mutate of [
    e => { delete e.eventId; },
    e => { delete e.protocolVersion; },
    e => { delete e.schemaVersion; },
    e => { e.eventId = "short"; },
    e => { e.protocolVersion = 1; },
    e => { e.network = "unknown"; },
    e => { e.payloadHash = "invalid"; },
    e => { e.issuedAt = "invalid"; },
    e => { e.extraField = "forbidden"; },
    e => { e.evidenceRefs = ["duplicate", "duplicate"]; },
    e => { e.signature.extraField = "forbidden"; },
  ]) {
    const record = structuredClone(original);
    mutate(record.envelope);
    // Bypass the public signing guard to model a malicious authorized signer.
    record.envelope.signature.value = sign(null, canonicalSigningBytes(record.envelope), keys.privateKey).toString("base64url");
    assert.equal(verify(null, canonicalSigningBytes(record.envelope), keys.publicKey, Buffer.from(record.envelope.signature.value, "base64url")), true);
    let resolved = false;
    const result = verifyEvidenceChain([record], { expectedHead: evidenceRecordHash(record), resolveKey: () => { resolved = true; return keys.publicKey; } });
    assert.equal(result.valid, false);
    assert.match(result.reason, /Invalid event envelope/);
    assert.equal(resolved, false);
    assert.equal(verifyEnvelope(record.envelope, keys.publicKey).valid, false);
    if (!Object.hasOwn(record.envelope.signature, "extraField")) {
      assert.throws(() => signEnvelope(record.envelope, keys.privateKey, { signer: "key:one" }), /Invalid event envelope/);
    }
  }
});

test("renewal binds original evidence, rotated keys and an externally pinned head", () => {
  const first = generateTestKeyPair();
  const next = generateTestKeyPair();
  const evidence = { principal: "creator:one", agent: "flywheel:one", scope: ["royalty.settle"], policyVersion: "1", transactionRef: "base:test" };
  const a = sealEvidence(evidence, first.privateKey, { signer: "key:one", subject: "work:one", issuedAt: "2026-10-30T00:00:00.000Z" });
  const b = sealEvidence({ anchorReceipt: "external:test" }, next.privateKey, {
    signer: "key:two", subject: "work:one", previousRecordHash: evidenceRecordHash(a), issuedAt: "2026-10-31T00:00:00.000Z",
  });
  const policy = { expectedHead: evidenceRecordHash(b), resolveKey: ({ signer }) => ({ "key:one": first.publicKey, "key:two": next.publicKey })[signer] };
  assert.deepEqual(verifyEvidenceChain([a, b], policy), { valid: true, head: policy.expectedHead, records: 2, timeAnchored: false });
  assert.equal(verifyEvidenceChain([a], policy).valid, false);
  assert.equal(verifyEvidenceChain([b, a], policy).valid, false);
  assert.equal(verifyEvidenceChain([a, b], { ...policy, resolveKey: () => next.publicKey }).valid, false);
  const changed = structuredClone(a);
  changed.payload.evidence.scope = ["treasury.drain"];
  assert.equal(verifyEvidenceChain([changed, b], policy).valid, false);
  assert.equal(verifyEvidenceChain([a, b], { resolveKey: policy.resolveKey }).valid, false);
  assert.equal(verifyEvidenceChain([a, b], { ...policy, resolveKey: async () => first.publicKey }).valid, false);
  evidence.scope.push("other");
  assert.equal(verifyEvidenceChain([a, b], policy).valid, true);
});

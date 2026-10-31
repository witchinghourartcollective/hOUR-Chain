import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { generateTestKeyPair, signEnvelope, verifyEnvelope } from "../src/index.mjs";
import { evidenceRecordHash, sealEvidence, verifyEvidenceChain } from "../src/evidence.mjs";

test("a classical key cannot be labelled as a post-quantum suite", () => {
  const keys = generateKeyPairSync("ed25519");
  assert.throws(() => signEnvelope({}, keys.privateKey, { signer: "agent:one" }), /match/);
  assert.equal(verifyEnvelope({ signature: {
    algorithm: "ML-DSA-65", suiteVersion: "1.0.0", signer: "agent:one", value: "AA",
  } }, keys.publicKey).valid, false);
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

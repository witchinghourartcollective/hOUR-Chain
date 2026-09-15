import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalSigningBytes,
  generateTestKeyPair,
  verifyEnvelope,
  signEnvelope,
} from "../src/index.mjs";

function envelope() {
  return {
    eventId: "evt_01JOURCHAIN_TEST_VECTOR_0001",
    protocolVersion: "0.1.0",
    schemaVersion: "0.1.0",
    eventType: "creator.attestation",
    actor: "identity:creator:test",
    subject: "work:test",
    issuedAt: "2026-09-14T00:00:00Z",
    payloadHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    network: "offchain",
    nonce: "nonce-0001",
  };
}

for (const algorithm of ["ML-DSA-65", "SLH-DSA-SHA2-128s"]) {
  test(`${algorithm} signs and verifies an envelope`, () => {
    const { privateKey, publicKey } = generateTestKeyPair(algorithm);
    const signed = signEnvelope(envelope(), privateKey, {
      algorithm,
      signer: "identity:creator:test-key-1",
    });
    const result = verifyEnvelope(signed, publicKey);
    assert.equal(result.valid, true);
    assert.equal(result.algorithm, algorithm);
    assert.equal(result.signer, "identity:creator:test-key-1");
  });
}

test("signature binds the algorithm, signer, and envelope bytes", () => {
  const { privateKey, publicKey } = generateTestKeyPair();
  const signed = signEnvelope(envelope(), privateKey, { signer: "identity:creator:test-key-1" });

  for (const mutate of [
    (value) => { value.signature.signer = "identity:attacker"; },
    (value) => { value.signature.algorithm = "SLH-DSA-SHA2-128s"; },
    (value) => { value.nonce = "nonce-replayed"; },
    (value) => { value.payloadHash = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"; },
  ]) {
    const mutated = structuredClone(signed);
    mutate(mutated);
    assert.equal(verifyEnvelope(mutated, publicKey).valid, false);
  }
});

test("canonical bytes exclude the signature value but include suite and signer", () => {
  const { privateKey } = generateTestKeyPair();
  const signed = signEnvelope(envelope(), privateKey, { signer: "identity:creator:test-key-1" });
  const changedValue = structuredClone(signed);
  changedValue.signature.value = "different-value";
  assert.deepEqual(canonicalSigningBytes(signed), canonicalSigningBytes(changedValue));

  const changedSigner = structuredClone(signed);
  changedSigner.signature.signer = "identity:creator:test-key-2";
  assert.notDeepEqual(canonicalSigningBytes(signed), canonicalSigningBytes(changedSigner));
});

test("unsupported or downgraded suites fail closed", () => {
  const { privateKey, publicKey } = generateTestKeyPair();
  const signed = signEnvelope(envelope(), privateKey, { signer: "identity:creator:test-key-1" });
  const downgraded = structuredClone(signed);
  downgraded.signature.suiteVersion = "0.1.0";
  assert.equal(verifyEnvelope(downgraded, publicKey).valid, false);

  const unknown = structuredClone(signed);
  unknown.signature.algorithm = "future-unknown-suite";
  assert.equal(verifyEnvelope(unknown, publicKey).valid, false);

  const futureVersion = structuredClone(signed);
  futureVersion.signature.suiteVersion = "2.0.0";
  assert.equal(verifyEnvelope(futureVersion, publicKey).valid, false);

  const malformedVersion = structuredClone(signed);
  malformedVersion.signature.suiteVersion = "latest";
  assert.equal(verifyEnvelope(malformedVersion, publicKey).valid, false);

  assert.throws(
    () => signEnvelope(envelope(), privateKey, { suiteVersion: "2.0.0", signer: "identity:creator:test-key-1" }),
    /Unregistered signature suite version/,
  );
  assert.throws(
    () => signEnvelope(envelope(), privateKey, { suiteVersion: "latest", signer: "identity:creator:test-key-1" }),
    /Invalid signature suite version/,
  );
});

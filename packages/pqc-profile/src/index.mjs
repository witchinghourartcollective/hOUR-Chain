import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  KeyObject,
  sign,
  verify,
} from "node:crypto";
import { types } from "node:util";
import { canonicalSigningBytes } from "./canonicalize.mjs";
import { getNodeKeyType, getSuite } from "./registry.mjs";
import { assertEnvelopeSchema } from "./schema.mjs";

const SUITE_VERSION = "1.0.0";

// Capture native getters from a fixed public key, so caller-provided metadata
// (including overrides on an otherwise genuine KeyObject) is never trusted.
const publicKeyPrototype = Object.getPrototypeOf(createPublicKey({
  key: Buffer.from(`302a300506032b6570032100${"00".repeat(32)}`, "hex"),
  format: "der", type: "spki",
}));
const nativeAlgorithm = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(publicKeyPrototype), "asymmetricKeyType",
).get;
const nativeType = Object.getOwnPropertyDescriptor(KeyObject.prototype, "type").get;

function matchesKey(key, type, algorithm) {
  return key instanceof KeyObject && types.isKeyObject(key) &&
    nativeType.call(key) === type && nativeAlgorithm.call(key) === getNodeKeyType(algorithm);
}

function base64url(buffer) {
  return buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function generateTestKeyPair(algorithm = "ML-DSA-65") {
  getSuite(algorithm, SUITE_VERSION);
  return generateKeyPairSync(getNodeKeyType(algorithm));
}

export function exportPublicKey(publicKey) {
  return base64url(publicKey.export({ format: "der", type: "spki" }));
}

export function exportPrivateKey(privateKey) {
  return base64url(privateKey.export({ format: "der", type: "pkcs8" }));
}

export function importPublicKey(encoded) {
  return createPublicKey({ key: Buffer.from(encoded, "base64url"), format: "der", type: "spki" });
}

export function importPrivateKey(encoded) {
  return createPrivateKey({ key: Buffer.from(encoded, "base64url"), format: "der", type: "pkcs8" });
}

export function signEnvelope(envelope, privateKey, { algorithm = "ML-DSA-65", suiteVersion = SUITE_VERSION, signer } = {}) {
  if (!signer) throw new TypeError("Signer identity is required");
  getSuite(algorithm, suiteVersion);
  if (!matchesKey(privateKey, "private", algorithm)) {
    throw new TypeError("Private key does not match the signature suite");
  }
  const unsignedEnvelope = { ...envelope };
  delete unsignedEnvelope.signature;
  const candidate = {
    ...unsignedEnvelope,
    signature: { algorithm, suiteVersion, signer, value: "pending" },
  };
  assertEnvelopeSchema(candidate);
  const value = sign(null, canonicalSigningBytes(candidate), privateKey);
  return { ...unsignedEnvelope, signature: { ...candidate.signature, value: base64url(value) } };
}

export function verifyEnvelope(envelope, publicKey) {
  const signature = envelope?.signature;
  if (!signature?.algorithm || !signature?.suiteVersion || !signature?.signer || !signature?.value) {
    return { valid: false, reason: "incomplete signature" };
  }
  try {
    assertEnvelopeSchema(envelope);
    const suite = getSuite(signature.algorithm, signature.suiteVersion);
    if (!matchesKey(publicKey, "public", suite.id)) {
      return { valid: false, reason: "Public key does not match the signature suite" };
    }
    const valid = verify(
      null,
      canonicalSigningBytes(envelope),
      publicKey,
      Buffer.from(signature.value, "base64url"),
    );
    return { valid, algorithm: suite.id, suiteVersion: signature.suiteVersion, signer: signature.signer };
  } catch (error) {
    return { valid: false, reason: error.message };
  }
}

export { canonicalSigningBytes } from "./canonicalize.mjs";
export { getRegistry, getResearchCandidate, getSuite } from "./registry.mjs";

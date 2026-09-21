import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { canonicalSigningBytes } from "./canonicalize.mjs";
import { getNodeKeyType, getSuite } from "./registry.mjs";

const SUITE_VERSION = "1.0.0";

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
  const unsignedEnvelope = { ...envelope };
  delete unsignedEnvelope.signature;
  const candidate = {
    ...unsignedEnvelope,
    signature: { algorithm, suiteVersion, signer, value: "pending" },
  };
  const value = sign(null, canonicalSigningBytes(candidate), privateKey);
  return { ...unsignedEnvelope, signature: { ...candidate.signature, value: base64url(value) } };
}

export function verifyEnvelope(envelope, publicKey) {
  const signature = envelope?.signature;
  if (!signature?.algorithm || !signature?.suiteVersion || !signature?.signer || !signature?.value) {
    return { valid: false, reason: "incomplete signature" };
  }
  try {
    const suite = getSuite(signature.algorithm, signature.suiteVersion);
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

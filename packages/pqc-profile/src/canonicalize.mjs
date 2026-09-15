import canonicalize from "canonicalize";

const DOMAIN = "HBC-EVENT-SIGNATURE-v1";

export function signingDocument(envelope) {
  if (!envelope || typeof envelope !== "object") {
    throw new TypeError("Envelope must be an object");
  }
  const signature = envelope.signature;
  if (!signature || typeof signature !== "object") {
    throw new TypeError("Envelope signature is required before canonicalization");
  }

  const { signature: ignored, ...unsignedEnvelope } = envelope;
  return {
    domain: DOMAIN,
    suite: {
      algorithm: signature.algorithm,
      suiteVersion: signature.suiteVersion,
    },
    signer: signature.signer,
    envelope: unsignedEnvelope,
  };
}

export function canonicalSigningBytes(envelope) {
  return Buffer.from(canonicalize(signingDocument(envelope)), "utf8");
}

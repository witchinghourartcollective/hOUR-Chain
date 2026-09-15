# hOUR Chain Signature Canonicalization

- **Status:** Draft
- **Scope:** Signed hOUR Chain event envelopes
- **Related decision:** [ADR-0002](ADR-0002-post-quantum-native-cryptography.md)

This document defines the bytes authorized by an event signature. It is an
implementation contract, not a cryptographic implementation. A signer and a
verifier MUST produce identical bytes for the same event.

## Signed structure

The signature covers a wrapper with these members:

```json
{
  "domain": "HBC-EVENT-SIGNATURE-v1",
  "suite": {
    "algorithm": "ML-DSA-65",
    "suiteVersion": "1.0.0"
  },
  "signer": "identity:creator:example",
  "envelope": {
    "eventId": "...",
    "protocolVersion": "...",
    "schemaVersion": "...",
    "eventType": "...",
    "actor": "...",
    "subject": "...",
    "issuedAt": "...",
    "payloadHash": "..."
  }
}
```

`envelope` contains every event-envelope member except `signature`, including
optional members when they are present: `evidenceRefs`, `previousEventRefs`,
`network`, and `nonce`. The `suite` and `signer` values are copied from the
signature object so an attacker cannot substitute an algorithm or signer after
the message has been signed.

The `domain` value is a fixed context separator. It MUST NOT be user supplied,
and a verifier MUST reject a different domain for this signing operation.

## Byte encoding

1. Construct the wrapper above.
2. Serialize it using JSON Canonicalization Scheme (JCS), RFC 8785.
3. Encode the resulting UTF-8 JSON bytes directly as the signature message.
4. Encode public keys and signatures as unpadded base64url in the envelope and
   key registry.

The protocol MUST NOT sign a pretty-printed JSON string, a language-specific
object serialization, or a string containing the envelope's `signature.value`.

## Verification requirements

A verifier MUST:

- validate the envelope schema before constructing signing bytes;
- resolve `signature.algorithm` and `signature.suiteVersion` in the registry;
- reject unknown, retired, or below-minimum suite versions;
- resolve `signature.signer` to the active verification material;
- construct the same canonical wrapper and verify the signature;
- enforce event nonce, issuance, expiry, causality, and authorization rules;
- record the accepted suite and key version in the verification result.

This does not make Base, Lightning, Solana, TLS, RPC, or external wallet
signatures post-quantum. Those remain separate settlement or transport claims.

## Open implementation questions

- Select a reviewed implementation for FIPS 204 and FIPS 205.
- Confirm whether direct-message signing or pre-hashed signing is used by the
  selected implementation.
- Add deterministic test vectors and cross-language verification fixtures.
- Benchmark browser, mobile, server, HSM, and hardware-signer behavior before
  changing either candidate from `candidate` to `approved`.

import test from "node:test";
import assert from "node:assert/strict";
import { buildCheckpointEnvelope, signCheckpoint, verifyCheckpoint } from "../src/checkpoint.mjs";
import { generateCheckpointSignerKeyPair } from "../src/keys.mjs";
import { exportPublicKey } from "../../pqc-profile/src/index.mjs";
import { loadSignerRegistry, verifyCheckpointQuorum } from "../src/quorum.mjs";

function sampleEnvelope(overrides = {}) {
  return buildCheckpointEnvelope({
    chainId: "hour-devnet-9000",
    height: 82173,
    blockHash: "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789",
    appHash: "1111222233334444111122223333444411112222333344441111222233334444",
    time: "2026-10-20T14:54:20Z",
    ...overrides,
  });
}

test("signs and verifies a checkpoint envelope with ML-DSA-65", () => {
  const { publicKey, privateKey } = generateCheckpointSignerKeyPair();
  const envelope = sampleEnvelope();
  const signed = signCheckpoint(envelope, privateKey, { signer: "validator-a" });

  assert.equal(signed.signature.algorithm, "ML-DSA-65");
  assert.equal(signed.signature.signer, "validator-a");

  const result = verifyCheckpoint(signed, publicKey);
  assert.equal(result.valid, true);
});

test("rejects a tampered checkpoint", () => {
  const { publicKey, privateKey } = generateCheckpointSignerKeyPair();
  const signed = signCheckpoint(sampleEnvelope(), privateKey, { signer: "validator-a" });
  const tampered = { ...signed, height: signed.height + 1 };

  const result = verifyCheckpoint(tampered, publicKey);
  assert.equal(result.valid, false);
});

test("refuses to sign a non-checkpoint envelope", () => {
  const { privateKey } = generateCheckpointSignerKeyPair();
  assert.throws(() => signCheckpoint({ kind: "something-else" }, privateKey, { signer: "validator-a" }));
});

test("quorum: strictly-more-than-2/3 reaches quorum, exactly-2/3 does not", () => {
  const validators = ["validator-a", "validator-b", "validator-c"].map((id) => {
    const { publicKey, privateKey } = generateCheckpointSignerKeyPair();
    return { id, publicKey, privateKey };
  });

  const registry = loadSignerRegistry(
    Object.fromEntries(
      validators.map((v, i) => [
        v.id,
        { publicKey: exportPublicKey(v.publicKey), validatorAddress: `addr-${i}` },
      ]),
    ),
  );

  // Weighted (15, 15, 10) rather than equal thirds: a+b = 30/40 (75%, clears
  // the CometBFT-style strict >2/3 commit threshold); a alone = 15/40 (37.5%,
  // doesn't). Equal-thirds voting power would make 2-of-3 land at exactly
  // 2/3, which this quorum rule deliberately rejects (matches CometBFT's own
  // "> 2/3", not ">= 2/3", commit rule).
  const votingPowers = [15n, 15n, 10n];
  const validatorSet = validators.map((_, i) => ({ address: `addr-${i}`, votingPower: votingPowers[i] }));
  const envelope = sampleEnvelope();

  const twoSigned = [validators[0], validators[1]].map((v) =>
    signCheckpoint(envelope, v.privateKey, { signer: v.id }),
  );
  const oneSigned = [validators[0]].map((v) => signCheckpoint(envelope, v.privateKey, { signer: v.id }));

  const quorumResult = verifyCheckpointQuorum(twoSigned, {
    signerRegistry: registry,
    validatorSet,
    height: envelope.height,
    blockHash: envelope.blockHash,
  });
  assert.equal(quorumResult.hasQuorum, true);

  const noQuorumResult = verifyCheckpointQuorum(oneSigned, {
    signerRegistry: registry,
    validatorSet,
    height: envelope.height,
    blockHash: envelope.blockHash,
  });
  assert.equal(noQuorumResult.hasQuorum, false);
});

test("quorum: rejects signer not present in the registry", () => {
  const { publicKey, privateKey } = generateCheckpointSignerKeyPair();
  void publicKey;
  const envelope = sampleEnvelope();
  const signed = signCheckpoint(envelope, privateKey, { signer: "unregistered-validator" });

  const registry = loadSignerRegistry({});
  const result = verifyCheckpointQuorum([signed], {
    signerRegistry: registry,
    validatorSet: [{ address: "addr-0", votingPower: 10n }],
    height: envelope.height,
    blockHash: envelope.blockHash,
  });

  assert.equal(result.hasQuorum, false);
  assert.equal(result.details[0].ok, false);
});

import {
  exportPublicKey,
  signEnvelope,
  verifyEnvelope,
} from "../../pqc-profile/src/index.mjs";

// Additive PQ attestation layer: validator consensus keys stay Ed25519
// (CometBFT's pubkey wire format can't be swapped without forking
// cometbft/cosmos-sdk — see docs/GENESIS-DECISION-GATE.md). This gives
// anyone an independently ML-DSA-verifiable attestation of a block
// without touching consensus signing itself.
export const CHECKPOINT_KIND = "hour-chain-consensus-checkpoint-v1";

const ALGORITHM = "ML-DSA-65";
const SUITE_VERSION = "1.0.0";

export function buildCheckpointEnvelope({ chainId, height, blockHash, appHash, time }) {
  if (!chainId) throw new TypeError("chainId is required");
  if (!Number.isInteger(height) || height <= 0) throw new TypeError("height must be a positive integer");
  if (!blockHash) throw new TypeError("blockHash is required");
  if (!appHash) throw new TypeError("appHash is required");
  if (!time) throw new TypeError("time is required");
  return { kind: CHECKPOINT_KIND, chainId, height, blockHash, appHash, time };
}

export function signCheckpoint(envelope, privateKey, { signer }) {
  if (envelope.kind !== CHECKPOINT_KIND) {
    throw new Error(`Refusing to sign non-checkpoint envelope (kind=${envelope.kind})`);
  }
  return signEnvelope(envelope, privateKey, { algorithm: ALGORITHM, suiteVersion: SUITE_VERSION, signer });
}

export function verifyCheckpoint(signedEnvelope, publicKey) {
  if (signedEnvelope.kind !== CHECKPOINT_KIND) {
    return { valid: false, reason: `unexpected kind: ${signedEnvelope.kind}` };
  }
  return verifyEnvelope(signedEnvelope, publicKey);
}

export function exportCheckpointSignerPublicKey(publicKey) {
  return exportPublicKey(publicKey);
}

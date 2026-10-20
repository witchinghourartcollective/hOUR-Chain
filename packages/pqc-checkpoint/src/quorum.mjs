import { importPublicKey } from "../../pqc-profile/src/index.mjs";
import { verifyCheckpoint } from "./checkpoint.mjs";

// Known-signers registry: { "<signer-id>": { publicKey: "<base64url DER>", validatorAddress: "<cometbft hex address>" } }
// Distributed out-of-band among permissioned validator operators (see
// docs/GENESIS-DECISION-GATE.md, "Staged validator path"). Not on-chain yet.
export function loadSignerRegistry(record) {
  const entries = Object.entries(record).map(([signer, info]) => [
    signer,
    { publicKey: importPublicKey(info.publicKey), validatorAddress: info.validatorAddress },
  ]);
  return new Map(entries);
}

export function verifyCheckpointQuorum(signedCheckpoints, { signerRegistry, validatorSet, height, blockHash }) {
  const totalVotingPower = validatorSet.reduce((sum, v) => sum + v.votingPower, 0n);
  if (totalVotingPower === 0n) throw new Error("validator set has zero total voting power");

  const votingPowerByAddress = new Map(validatorSet.map((v) => [v.address, v.votingPower]));
  const seenSigners = new Set();
  let attestedVotingPower = 0n;
  const details = [];

  for (const signed of signedCheckpoints) {
    const signerId = signed?.signature?.signer;
    if (!signerId || seenSigners.has(signerId)) continue;
    const entry = signerRegistry.get(signerId);
    if (!entry) {
      details.push({ signer: signerId, ok: false, reason: "unknown signer, not in registry" });
      continue;
    }
    if (signed.height !== height || signed.blockHash !== blockHash) {
      details.push({ signer: signerId, ok: false, reason: "checkpoint does not match target height/blockHash" });
      continue;
    }
    const result = verifyCheckpoint(signed, entry.publicKey);
    if (!result.valid) {
      details.push({ signer: signerId, ok: false, reason: result.reason ?? "signature invalid" });
      continue;
    }
    const votingPower = votingPowerByAddress.get(entry.validatorAddress);
    if (votingPower === undefined) {
      details.push({ signer: signerId, ok: false, reason: "signer's validator address not in current validator set" });
      continue;
    }
    seenSigners.add(signerId);
    attestedVotingPower += votingPower;
    details.push({ signer: signerId, ok: true, votingPower: votingPower.toString() });
  }

  // Standard BFT quorum: strictly more than 2/3 of voting power.
  const hasQuorum = attestedVotingPower * 3n > totalVotingPower * 2n;

  return {
    height,
    blockHash,
    hasQuorum,
    attestedVotingPower: attestedVotingPower.toString(),
    totalVotingPower: totalVotingPower.toString(),
    details,
  };
}

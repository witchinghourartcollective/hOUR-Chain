// Settlement ID derivation for the GCUL settlement adapter (ADR-0009 section 2).
//
// settlement_id = "hst1_" + first 40 hex chars of sha256(instructionEventId + ":" + legIndex)
//
// Deterministic, so retries, restarts and a second adapter instance converge on
// one ID for the same leg. Opaque, so the ledger learns nothing about the work,
// the people or the rates.
import { createHash } from 'node:crypto';

export const SETTLEMENT_ID_PATTERN = /^hst1_[a-f0-9]{40}$/;

export function deriveSettlementId(instructionEventId, legIndex) {
  if (typeof instructionEventId !== 'string' || instructionEventId.length < 16) {
    throw new TypeError('instructionEventId must be a string of at least 16 characters');
  }
  if (!Number.isSafeInteger(legIndex) || legIndex < 0) {
    throw new TypeError('legIndex must be a non-negative integer');
  }
  const digest = createHash('sha256').update(`${instructionEventId}:${legIndex}`, 'utf8').digest('hex');
  return `hst1_${digest.slice(0, 40)}`;
}

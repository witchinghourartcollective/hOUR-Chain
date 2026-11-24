// GCUL settlement adapter (ADR-0009): simulate, approve, submit, resolve, reconcile.
//
// The adapter acts only on signed settlement instruction events whose referenced
// contribution, agreement and approvals are approved. It never creates or edits
// those records. Payment-level idempotency comes from two layers:
//   1. contract v2 settle() pays and records atomically and rejects a repeated
//      settlement ID with no funds moved;
//   2. this adapter's write-ahead leg table, leases, and "never retry blind".
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import canonicalize from 'canonicalize';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { verifyEnvelope } from '../../pqc-profile/src/index.mjs';
import { deriveSettlementId } from './settlement-id.mjs';
import { STATES as S } from './store.mjs';
import { DuplicateSettlementError, LedgerRejectedError, OutcomeUnknownError } from './ledger.mjs';

const loadSchema = (p) => JSON.parse(readFileSync(new URL(`../../../specs/${p}`, import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateInstructionPayload = ajv.compile(loadSchema('payloads/settlement-instruction.schema.json'));
const validateReceiptPayload = ajv.compile(loadSchema('payloads/settlement-receipt.schema.json'));

export class InstructionError extends Error {}

export function payloadHash(payload) {
  return createHash('sha256').update(Buffer.from(canonicalize(payload), 'utf8')).digest('hex');
}

export class GculSettlementAdapter {
  /**
   * @param {object} options
   * @param {import('./store.mjs').LegStore} options.store
   * @param {object} options.ledger          FakeLedger or UlCliLedger
   * @param {string} options.operator        ul-cli alias of the settlement operator (contract owner)
   * @param {string} options.contractAlias   ul-cli alias of the contract v2 instance
   * @param {string} options.contractId      its 1:CTR:... ID, copied into receipts
   * @param {string} options.currency        network currency code, e.g. DEM
   * @param {(signer: string) => object} options.resolveKey      public key for an instruction signer
   * @param {(eventId: string) => boolean} options.isApproved     true if an approval / versioned ref is approved
   * @param {string} [options.workerId]
   * @param {number} [options.leaseMs]
   */
  constructor({ store, ledger, operator, contractAlias, contractId, currency, resolveKey, isApproved,
    workerId = `worker-${process.pid}`, leaseMs = 120_000 }) {
    for (const [name, value] of Object.entries({ store, ledger, operator, contractAlias, contractId, currency, resolveKey, isApproved })) {
      if (!value) throw new TypeError(`${name} is required`);
    }
    Object.assign(this, { store, ledger, operator, contractAlias, contractId, currency, resolveKey, isApproved, workerId, leaseMs });
  }

  // ADR-0001 simulate: verify everything and derive legs; submits nothing.
  async simulate({ envelope, payload }) {
    this.#verifyInstruction(envelope, payload);
    const legs = [];
    for (const leg of payload.legs) {
      const settlementId = deriveSettlementId(envelope.eventId, leg.legIndex);
      const receipt = await this.ledger.getReceipt(this.contractAlias, settlementId);
      legs.push({
        settlementId,
        instructionEventId: envelope.eventId,
        legIndex: leg.legIndex,
        contractAlias: this.contractAlias,
        network: payload.network,
        currency: payload.currency,
        contributionRef: payload.contributionRef,
        agreementRef: payload.agreementRef,
        obligationRef: payload.obligationRef,
        approvalRefs: [...payload.approvals],
        payee: leg.payee,
        amountMinor: leg.amountMinor,
        alreadyOnLedger: receipt !== null,
      });
    }
    return { instructionEventId: envelope.eventId, legs };
  }

  // ADR-0001 approve: record verified legs as APPROVED. Replaying an instruction is a no-op.
  async approve(instruction) {
    const plan = await this.simulate(instruction);
    if (!this.store.assignObligation(instruction.payload.obligationRef, instruction.envelope.eventId)) {
      throw new InstructionError(`obligation ${instruction.payload.obligationRef} is already assigned to another instruction`);
    }
    return plan.legs.map((leg) => {
      const row = this.store.plan(leg);
      return row.state === S.PLANNED ? this.store.transition(leg.settlementId, S.APPROVED) : row;
    });
  }

  // ADR-0001 submit: pay one leg through contract v2, at most once.
  async submit(settlementId) {
    this.store.acquireLease(settlementId, this.workerId, this.leaseMs);
    try {
      const leg = this.store.get(settlementId);
      if (leg.state !== S.APPROVED) throw new InstructionError(`${settlementId} is ${leg.state}, not APPROVED`);

      // Never submit blind (rule 1): check the ledger before every submission,
      // not only retries. A lost or rebuilt leg table starts with attempts = 0,
      // and the pilot showed that skipping this check then spends a failing
      // transaction per leg (no funds move, but sequence numbers are consumed).
      // The contract's duplicate guard still backs this up if the check races.
      const existing = await this.ledger.getReceipt(this.contractAlias, settlementId);
      if (existing) {
        this.store.transition(settlementId, S.SUBMITTING, { lastError: 'pre-check found an existing receipt; not submitted' });
        this.store.transition(settlementId, S.REJECTED_DUPLICATE);
        return this.#confirmAgainstReceipt(settlementId, existing, null, null);
      }

      const approvalRefs = [leg.obligationRef, leg.contributionRef, leg.agreementRef, ...leg.approvalRefs];
      const staleRef = approvalRefs.find((ref) => !this.isApproved(ref));
      if (staleRef) {
        this.store.transition(settlementId, S.CANCELLED, { lastError: `${staleRef} is no longer approved` });
        throw new InstructionError(`${staleRef} is no longer approved; settlement leg cancelled`);
      }

      this.store.transition(settlementId, S.SUBMITTING); // written before the call: the write-ahead step
      let result;
      try {
        result = await this.ledger.settle({
          contractAlias: this.contractAlias,
          sender: this.operator,
          paymentMinor: leg.amountMinor,
          settlementId,
          instructionId: leg.instructionEventId,
          contributionRef: leg.contributionRef,
          agreementRef: leg.agreementRef,
          payee: leg.payee,
          amountMinor: leg.amountMinor,
        });
      } catch (error) {
        if (error instanceof DuplicateSettlementError) {
          this.store.transition(settlementId, S.REJECTED_DUPLICATE, { lastError: error.message });
          const existing = await this.ledger.getReceipt(this.contractAlias, settlementId);
          return this.#confirmAgainstReceipt(settlementId, existing, null, null);
        }
        if (error instanceof LedgerRejectedError) {
          return this.store.transition(settlementId, S.FAILED, { lastError: error.message });
        }
        if (error instanceof OutcomeUnknownError) {
          return this.store.transition(settlementId, S.UNKNOWN, { lastError: error.message });
        }
        // A bug or crash in our own code: the call may have reached the ledger.
        this.store.transition(settlementId, S.UNKNOWN, { lastError: `adapter error: ${error.message}` });
        throw error;
      }
      const receipt = await this.ledger.getReceipt(this.contractAlias, settlementId);
      return this.#confirmAgainstReceipt(settlementId, receipt, result.txRef, result.round);
    } finally {
      this.store.releaseLease(settlementId, this.workerId);
    }
  }

  // Resolves an UNKNOWN leg only from ledger state. A missing receipt means the
  // call did not commit; because v2 is atomic it also means nothing was paid.
  // If a slow transaction commits later, the retry is rejected as a duplicate,
  // so resolving to FAILED can never cause a double payment.
  async resolveUnknown(settlementId) {
    const leg = this.store.get(settlementId);
    if (leg.state !== S.UNKNOWN) throw new InstructionError(`${settlementId} is ${leg.state}, not UNKNOWN`);
    const receipt = await this.ledger.getReceipt(this.contractAlias, settlementId);
    if (!receipt) return this.store.transition(settlementId, S.FAILED, { lastError: 'no receipt on ledger after unknown outcome' });
    return this.#confirmAgainstReceipt(settlementId, receipt, null, null);
  }

  // Explicit retry of a FAILED leg, always with the same settlement ID (rule 3).
  retry(settlementId) {
    return this.store.transition(settlementId, S.APPROVED, { lastError: null });
  }

  // Three-way reconciliation (ADR-0009 section 4): expected (instructions),
  // attempted (leg table), actual (ledger). Emits receipt payloads for legs that
  // pass, moves mismatches to DISPUTED, and reports everything else as findings.
  // knownPreAdapter: settlement IDs written to the contract before the adapter
  // existed (for example hand-run tests). They are reported as known, not as
  // orphans, so a genuine orphan still stands out.
  async reconcile({ instructions, runId, balances, knownPreAdapter = [] }) {
    const known = new Set(knownPreAdapter);
    const expected = new Map();
    for (const { envelope, payload } of instructions) {
      for (const leg of payload.legs) {
        expected.set(deriveSettlementId(envelope.eventId, leg.legIndex), {
          instructionEventId: envelope.eventId, legIndex: leg.legIndex, payee: leg.payee,
          amountMinor: leg.amountMinor, contributionRef: payload.contributionRef, agreementRef: payload.agreementRef,
        });
      }
    }
    const rows = new Map(this.store.list().map((leg) => [leg.settlementId, leg]));
    const actual = new Map((await this.ledger.listReceipts(this.contractAlias)).map((r) => [r.settlementId, r]));
    const report = { runId, receipts: [], disputed: [], findings: [] };

    for (const [id, want] of expected) {
      if (!rows.has(id)) report.findings.push({ settlementId: id, kind: 'not-planned', detail: 'instruction leg has no leg row' });
      const row = rows.get(id);
      if (row && !sameLeg(row, want)) {
        report.findings.push({ settlementId: id, kind: 'row-mismatch', detail: 'leg row differs from its instruction' });
      }
    }
    for (const [id, receipt] of actual) {
      if (!rows.has(id)) {
        report.findings.push(known.has(id)
          ? { settlementId: id, kind: 'known-pre-adapter', detail: 'declared pre-adapter receipt; not an orphan' }
          : { settlementId: id, kind: 'orphan-receipt', detail: 'receipt on ledger with no leg row' });
      }
    }
    for (const [id, row] of rows) {
      const receipt = actual.get(id);
      const want = expected.get(id);
      if (row.state === S.CONFIRMED && !want) {
        report.findings.push({ settlementId: id, kind: 'no-instruction-supplied', detail: 'confirmed leg not reconciled: its instruction was not passed to this run' });
      } else if (row.state === S.CONFIRMED) {
        const mismatch = !receipt ? 'confirmed leg has no receipt on ledger' : diffReceipt(receipt, want, this.currency);
        if (mismatch) {
          this.store.transition(id, S.DISPUTED, { lastError: `reconciliation: ${mismatch}` });
          report.disputed.push({ settlementId: id, reason: mismatch });
          continue;
        }
        this.store.transition(id, S.RECONCILED);
        report.receipts.push(this.#receiptPayload(this.store.get(id), runId));
      } else if (receipt && [S.PLANNED, S.APPROVED, S.SUBMITTING, S.UNKNOWN, S.FAILED].includes(row.state)) {
        report.findings.push({ settlementId: id, kind: 'receipt-ahead-of-state', detail: `receipt exists while leg is ${row.state}` });
      }
    }

    if (balances) {
      const settled = [...rows.values()]
        .filter((r) => r.state === S.RECONCILED || r.state === S.CONFIRMED)
        .filter((r) => !balances.since || r.updatedAt >= balances.since)
        .reduce((sum, r) => sum + r.amountMinor, 0);
      const delta = balances.before - balances.after;
      if (delta !== settled) {
        report.findings.push({ kind: 'balance-mismatch', detail: `operator balance fell by ${delta}, settled legs total ${settled}` });
      }
    }
    return report;
  }

  #verifyInstruction(envelope, payload) {
    if (!validateInstructionPayload(payload)) {
      throw new InstructionError(`invalid instruction payload: ${ajv.errorsText(validateInstructionPayload.errors)}`);
    }
    if (envelope?.eventType !== 'settlement.instruction') throw new InstructionError('eventType must be settlement.instruction');
    if (envelope.network !== 'gcul' || payload.network !== 'gcul') throw new InstructionError('instruction is not for network gcul');
    if (payload.currency !== this.currency) throw new InstructionError(`currency ${payload.currency} is not ${this.currency}`);
    if (envelope.payloadHash !== payloadHash(payload)) throw new InstructionError('payloadHash does not match payload');
    const key = this.resolveKey(envelope.signature?.signer);
    if (!key) throw new InstructionError(`no key for signer ${envelope.signature?.signer}`);
    const verdict = verifyEnvelope(envelope, key);
    if (!verdict.valid) throw new InstructionError(`signature invalid: ${verdict.reason ?? 'verification failed'}`);
    for (const ref of [payload.contributionRef, payload.agreementRef, payload.obligationRef, ...payload.approvals]) {
      if (!this.isApproved(ref)) throw new InstructionError(`${ref} is not approved`);
    }
    const indexes = payload.legs.map((l) => l.legIndex);
    if (new Set(indexes).size !== indexes.length) throw new InstructionError('duplicate legIndex');
  }

  #confirmAgainstReceipt(settlementId, receipt, txRef, round) {
    const leg = this.store.get(settlementId);
    const mismatch = !receipt ? 'no receipt on ledger' : diffReceipt(receipt, leg, this.currency);
    const confirmed = this.store.transition(settlementId, S.CONFIRMED, { txRef, networkRound: round });
    if (!mismatch) return confirmed;
    return this.store.transition(settlementId, S.DISPUTED, { lastError: mismatch });
  }

  #receiptPayload(leg, runId) {
    const payload = {
      instructionEventId: leg.instructionEventId,
      legIndex: leg.legIndex,
      settlementId: leg.settlementId,
      network: leg.network,
      // GCUL offers no lookup of the transaction hash for a receipt found only in
      // contract state (ADR-0009 open question 2), so point at that state instead.
      networkTxRef: leg.txRef ?? `state:${this.contractId}/${leg.settlementId}`,
      contractId: this.contractId,
      payee: leg.payee,
      amountMinor: leg.amountMinor,
      currency: leg.currency,
      finality: 'final',
      reconciliationRunId: runId,
    };
    if (leg.networkRound != null) payload.networkRound = leg.networkRound;
    if (!validateReceiptPayload(payload)) {
      throw new Error(`built an invalid receipt payload: ${ajv.errorsText(validateReceiptPayload.errors)}`);
    }
    return payload;
  }
}

function sameLeg(row, want) {
  return row.instructionEventId === want.instructionEventId && row.legIndex === want.legIndex &&
    row.payee === want.payee && row.amountMinor === want.amountMinor &&
    row.contributionRef === want.contributionRef && row.agreementRef === want.agreementRef;
}

function diffReceipt(receipt, want, currency) {
  for (const key of ['payee', 'amountMinor', 'contributionRef', 'agreementRef']) {
    if (receipt[key] !== want[key]) return `${key} on ledger is ${receipt[key]}, expected ${want[key]}`;
  }
  if (receipt.instructionId !== want.instructionEventId) {
    return `instructionId on ledger is ${receipt.instructionId}, expected ${want.instructionEventId}`;
  }
  if (receipt.currency !== currency) return `currency on ledger is ${receipt.currency}, expected ${currency}`;
  return null;
}

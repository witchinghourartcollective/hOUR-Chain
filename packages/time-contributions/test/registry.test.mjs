// Tests for the real-hours workflow, including an end-to-end run of the
// TIME-CONTRIBUTIONS.md pilot criteria through gcul-adapter on a FakeLedger.
// All events are signed with real ML-DSA-65 test keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTestKeyPair, signEnvelope } from '../../pqc-profile/src/index.mjs';
import {
  ContributionRegistry, RegistryError, STATUS, payloadHash, calculateObligation, CalculationError, buildSettlementInstruction,
} from '../src/index.mjs';
import { GculSettlementAdapter, LegStore, FakeLedger, deriveSettlementId, STATES } from '../../gcul-adapter/src/index.mjs';

const PEOPLE = ['producer', 'artist', 'engineer', 'hour-operator', 'mallory'];
const KEYS = Object.fromEntries(PEOPLE.map((p) => [p, generateTestKeyPair()]));
const resolveKey = (signer) => KEYS[String(signer).split('#')[0]]?.publicKey ?? null;
let seq = 0;

function ev(type, payload, by, { eventId, network } = {}) {
  const envelope = {
    eventId: eventId ?? `evt-${type.replace('.', '-')}-${String(++seq).padStart(4, '0')}`,
    protocolVersion: '0.2', schemaVersion: '1', eventType: type, actor: by,
    subject: payload.contributionId ?? payload.agreementId ?? payload.revenueId ?? payload.obligationId ?? 'x',
    issuedAt: '2026-11-24T12:00:00.000Z', payloadHash: payloadHash(payload),
  };
  if (network) envelope.network = network;
  return { envelope: signEnvelope(envelope, KEYS[by].privateKey, { signer: `${by}#k1` }), payload };
}

const newRegistry = () => new ContributionRegistry({ resolveKey, operators: ['hour-operator'] });

const claim = (patch = {}) => ({
  contributionId: 'contrib-session-0001', version: 1, workRef: 'work-track-07', contributor: 'producer',
  role: 'producer', activity: 'recording', durationSeconds: 7200,
  startAt: '2026-11-20T18:00:00Z', endAt: '2026-11-20T20:30:00Z', timezone: 'America/New_York',
  evidenceRefs: ['ipfs://bafy-session-log'], reviewers: ['artist', 'engineer'], ...patch,
});

const hourly = (patch = {}) => ({
  agreementId: 'agree-track-07-producer', version: 1, workRef: 'work-track-07', contributionId: 'contrib-session-0001',
  payee: 'producer', parties: ['producer', 'artist'], currency: 'DEM', basis: 'hourly_rate', rateMinorPerHour: 3000,
  termsRef: 'vault://agreements/track-07-producer-v1', ...patch,
});

function approvedClaimAndAgreement(r, { claimPatch, agreementPatch } = {}) {
  const c = ev('contribution.claimed', claim(claimPatch), 'producer');
  r.append(c);
  r.append(ev('contribution.reviewed', { contributionId: 'contrib-session-0001', version: 1, decision: 'approve' }, 'artist'));
  r.append(ev('contribution.reviewed', { contributionId: 'contrib-session-0001', version: 1, decision: 'approve' }, 'engineer'));
  const a = ev('agreement.proposed', hourly(agreementPatch), 'artist');
  r.append(a);
  r.append(ev('agreement.reviewed', { agreementId: 'agree-track-07-producer', version: 1, decision: 'approve' }, 'producer'));
  r.append(ev('agreement.reviewed', { agreementId: 'agree-track-07-producer', version: 1, decision: 'approve' }, 'artist'));
  return { claimEvent: c, agreementEvent: a };
}

function obligationFor(r, { contributionRef = 'contrib-session-0001@1', agreementRef = 'agree-track-07-producer@1', obligationId = 'obl-0001', revenueRef } = {}) {
  const [cId, cVer] = contributionRef.split('@');
  const [aId, aVer] = agreementRef.split('@');
  const expected = calculateObligation({
    agreement: r.agreement(aId, Number(aVer)).payload,
    contribution: r.contribution(cId, Number(cVer)).payload,
    revenue: revenueRef ? r.revenues.get(revenueRef).payload : undefined,
  });
  const payload = { obligationId, contributionRef, agreementRef, payee: 'producer', currency: 'DEM', ...expected };
  if (revenueRef) payload.revenueRef = revenueRef;
  return ev('obligation.calculated', payload, 'hour-operator');
}

test('calculation is integer-only, rounds down and records the remainder', () => {
  const contribution = { durationSeconds: 5400 };
  assert.deepEqual(calculateObligation({ agreement: { basis: 'hourly_rate', rateMinorPerHour: 1999 }, contribution }), {
    amountMinor: 2998,
    calculation: { basis: 'hourly_rate', formula: 'floor(5400s * 1999/h / 3600)', remainderNumerator: 1800, remainderDenominator: 3600 },
  });
  const share = calculateObligation({ agreement: { basis: 'revenue_share', shareBps: 1500 }, revenue: { amountMinor: 123457 } });
  assert.equal(share.amountMinor, 18518);
  assert.equal(share.calculation.remainderNumerator, 5500);
  assert.equal(calculateObligation({ agreement: { basis: 'fixed_fee', feeMinor: 50000 } }).amountMinor, 50000);
  assert.throws(() => calculateObligation({ agreement: { basis: 'hourly_rate', rateMinorPerHour: 1 }, contribution: { durationSeconds: 60 } }), CalculationError);
  assert.throws(() => calculateObligation({ agreement: { basis: 'revenue_share', shareBps: 10 } }), /revenue report/);
});

test('pilot criteria end to end: claim, approval, agreement, obligation, settlement, reconciliation, no duplicate payment', async () => {
  const r = newRegistry();
  approvedClaimAndAgreement(r);
  assert.equal(r.contribution('contrib-session-0001', 1).status, STATUS.APPROVED);
  assert.equal(r.agreement('agree-track-07-producer', 1).status, STATUS.APPROVED);
  const obligation = obligationFor(r);
  r.append(obligation);
  assert.equal(obligation.payload.amountMinor, 6000); // 2h at 3000/h

  const PRODUCER_ACCOUNT = '1:USR:DEM:producer-account';
  const instructionPayload = buildSettlementInstruction(r, obligation.envelope.eventId, {
    network: 'gcul', currency: 'DEM', payeeAccount: (id) => (id === 'producer' ? PRODUCER_ACCOUNT : null),
  });
  assert.equal(instructionPayload.approvals.length, 4); // two contribution reviews + two agreement reviews
  const instruction = ev('settlement.instruction', instructionPayload, 'hour-operator', { eventId: 'evt-settlement-instruction-0001', network: 'gcul' });

  const ledger = new FakeLedger({ operator: 'hour_chain_owner', balances: { hour_chain_owner: 1_000_000 } });
  ledger.deploy('hour_settlement_v2');
  const adapter = new GculSettlementAdapter({
    store: new LegStore(), ledger, operator: 'hour_chain_owner', contractAlias: 'hour_settlement_v2', contractId: '1:CTR:test',
    currency: 'DEM', resolveKey, isApproved: (ref) => r.isApproved(ref),
  });
  const [leg] = await adapter.approve(instruction);
  assert.equal((await adapter.submit(leg.settlementId)).state, STATES.CONFIRMED);
  assert.equal(ledger.balances[PRODUCER_ACCOUNT], 6000);
  const report = await adapter.reconcile({ instructions: [instruction], runId: 'recon-pilot' });
  assert.deepEqual(report.findings, []);
  assert.equal(report.receipts[0].settlementId, deriveSettlementId('evt-settlement-instruction-0001', 0));
  assert.equal(report.receipts[0].amountMinor, 6000);

  // Duplicate payment: replaying the instruction, or calculating the obligation again, pays nothing more.
  await adapter.approve(instruction);
  await assert.rejects(adapter.submit(leg.settlementId), /RECONCILED/);
  assert.throws(() => r.append(obligationFor(r, { obligationId: 'obl-0002' })), /already calculated/);
  assert.equal(ledger.balances[PRODUCER_ACCOUNT], 6000);
});

test('dispute and traceable correction: a disputed claim cannot be paid; the amendment restarts review and keeps history', () => {
  const r = newRegistry();
  const v1 = ev('contribution.claimed', claim({ durationSeconds: 9000 }), 'producer');
  r.append(v1);
  r.append(ev('contribution.reviewed', { contributionId: 'contrib-session-0001', version: 1, decision: 'approve' }, 'artist'));
  r.append(ev('contribution.reviewed', { contributionId: 'contrib-session-0001', version: 1, decision: 'dispute', reason: 'session ended at 20:00' }, 'engineer'));
  assert.equal(r.contribution('contrib-session-0001', 1).status, STATUS.DISPUTED);
  assert.equal(r.isApproved('contrib-session-0001@1'), false);

  const v2 = ev('contribution.claimed', claim({ version: 2, amends: v1.envelope.eventId, durationSeconds: 7200 }), 'producer');
  r.append(v2);
  const old = r.contribution('contrib-session-0001', 1);
  assert.equal(old.status, STATUS.SUPERSEDED);
  assert.equal(old.reviews.get('engineer').reason, 'session ended at 20:00'); // dispute preserved
  assert.equal(r.contribution('contrib-session-0001').status, STATUS.PENDING); // approvals do not carry over
  r.append(ev('contribution.reviewed', { contributionId: 'contrib-session-0001', version: 2, decision: 'approve' }, 'artist'));
  r.append(ev('contribution.reviewed', { contributionId: 'contrib-session-0001', version: 2, decision: 'approve' }, 'engineer'));
  assert.equal(r.contribution('contrib-session-0001', 2).status, STATUS.APPROVED);
  assert.throws(() => r.append(ev('contribution.reviewed', { contributionId: 'contrib-session-0001', version: 1, decision: 'approve' }, 'engineer')), /superseded|already reviewed/);
});

test('amending after an obligation makes it stale, so it cannot be settled', async () => {
  const r = newRegistry();
  const { claimEvent } = approvedClaimAndAgreement(r);
  const obligation = obligationFor(r);
  r.append(obligation);
  assert.equal(r.isApproved(obligation.envelope.eventId), true);
  r.append(ev('contribution.claimed', claim({ version: 2, amends: claimEvent.envelope.eventId, durationSeconds: 3600 }), 'producer'));
  assert.equal(r.isApproved(obligation.envelope.eventId), false);
  assert.equal(r.obligation(obligation.envelope.eventId).valid, false);
  assert.throws(() => buildSettlementInstruction(r, obligation.envelope.eventId, { network: 'gcul', payeeAccount: () => 'acct' }), /stale/);
});

test('revenue share needs an operator revenue report and matches it exactly', () => {
  const r = newRegistry();
  approvedClaimAndAgreement(r, { agreementPatch: { basis: 'revenue_share', rateMinorPerHour: undefined, shareBps: 1500 } });
  const report = { revenueId: 'rev-2026-11', workRef: 'work-track-07', amountMinor: 123457, currency: 'DEM',
    periodStart: '2026-11-01T00:00:00Z', periodEnd: '2026-12-01T00:00:00Z' };
  assert.throws(() => r.append(ev('revenue.reported', report, 'producer')), /operator/);
  r.append(ev('revenue.reported', report, 'hour-operator'));
  assert.throws(() => r.append(obligationFor(r)), /revenue report|needs a reported revenueRef/);
  const o = obligationFor(r, { revenueRef: 'rev-2026-11' });
  r.append(o);
  assert.equal(o.payload.amountMinor, 18518);
});

test('rules that reject events leave the registry unchanged', () => {
  const r = newRegistry();
  approvedClaimAndAgreement(r);
  const before = r.log.length;
  const reject = (event, pattern, name) => assert.throws(() => r.append(event), pattern, name);

  reject(ev('contribution.claimed', claim({ contributionId: 'c-self', reviewers: ['producer'], startAt: '2026-11-21T10:00:00Z', endAt: '2026-11-21T11:00:00Z', durationSeconds: 3600 }), 'producer'), /own claim/, 'self review');
  reject(ev('contribution.claimed', claim({ contributionId: 'c-other' }), 'mallory'), /claimed by its contributor/, 'claim for someone else');
  reject(ev('contribution.claimed', claim({ contributionId: 'c-overlap', startAt: '2026-11-20T19:00:00Z', endAt: '2026-11-20T21:00:00Z', durationSeconds: 3600 }), 'producer'), /overlaps/, 'overlap');
  reject(ev('contribution.claimed', claim({ contributionId: 'c-long', startAt: '2026-11-21T10:00:00Z', endAt: '2026-11-21T11:00:00Z', durationSeconds: 7200 }), 'producer'), /exceeds/, 'duration > window');
  reject(ev('contribution.reviewed', { contributionId: 'contrib-session-0001', version: 1, decision: 'approve' }, 'mallory'), /not a reviewer/, 'non-reviewer');
  reject(ev('contribution.reviewed', { contributionId: 'contrib-session-0001', version: 1, decision: 'dispute' }, 'artist'), /immutable/, 're-review');
  reject(ev('agreement.proposed', hourly({ agreementId: 'a-2', payee: 'mallory' }), 'artist'), /payee must be a party/, 'payee not party');
  reject(ev('agreement.proposed', hourly({ agreementId: 'a-3', feeMinor: 100 }), 'artist'), /invalid agreement.proposed/, 'two bases');
  reject({ ...obligationFor(r), payload: { ...obligationFor(r).payload, amountMinor: 6001 } }, /payloadHash/, 'tampered payload');
  const wrong = obligationFor(r);
  reject(ev('obligation.calculated', { ...wrong.payload, amountMinor: 6001 }, 'hour-operator'), /does not match the agreement/, 'wrong amount');
  reject(ev('obligation.calculated', { ...wrong.payload, revenueRef: 'rev-x' }, 'hour-operator'), /only valid for revenue_share/, 'revenueRef on hourly');
  reject(ev('obligation.calculated', wrong.payload, 'producer'), /operator/, 'obligation by non-operator');
  const forged = ev('contribution.reviewed', { contributionId: 'contrib-session-0001', version: 1, decision: 'approve' }, 'mallory');
  forged.envelope.actor = 'engineer';
  reject(forged, /signature invalid|actor/, 'actor forgery');
  reject(ev('contribution.claimed', claim({ contributionId: 'c-net' }), 'producer', { network: 'gcul' }), /offchain/, 'network on a record');
  assert.equal(r.log.length, before);
});

test('duplicate claims without times are refused; the log replays to identical state', () => {
  const r = newRegistry();
  const untimed = { contributionId: 'c-a', version: 1, workRef: 'work-x', contributor: 'producer', role: 'editor',
    activity: 'editing', durationSeconds: 1800, evidenceRefs: [], reviewers: ['artist'] };
  r.append(ev('contribution.claimed', untimed, 'producer'));
  assert.throws(() => r.append(ev('contribution.claimed', { ...untimed, contributionId: 'c-b' }, 'producer')), /probable duplicate/);
  approvedClaimAndAgreement(r);
  r.append(obligationFor(r));
  const replayed = ContributionRegistry.fromLog(r.log, { resolveKey, operators: ['hour-operator'] });
  assert.equal(replayed.log.length, r.log.length);
  for (const ref of ['contrib-session-0001@1', 'agree-track-07-producer@1', 'c-a@1']) {
    assert.equal(replayed.isApproved(ref), r.isApproved(ref), ref);
  }
});

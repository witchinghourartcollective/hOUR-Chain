// Tests for the real-hours workflow, including an end-to-end run of the
// TIME-CONTRIBUTIONS.md pilot criteria through gcul-adapter on a FakeLedger.
// All events are signed with real ML-DSA-65 test keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTestKeyPair, signEnvelope } from '../../pqc-profile/src/index.mjs';
import {
  ContributionRegistry, RegistryError, STATUS, payloadHash, calculateObligation, CalculationError, buildSettlementInstruction, expectedLegs,
} from '../src/index.mjs';
import { GculSettlementAdapter, LegStore, FakeLedger, deriveSettlementId, STATES } from '../../gcul-adapter/src/index.mjs';

const PEOPLE = ['producer', 'artist', 'engineer', 'hour-operator', 'mallory'];
const PAYEE_ACCOUNT = '1:USR:DEM:producer-account';
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
    revenue: revenueRef ? r.revenue(revenueRef).payload : undefined,
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
    currency: 'DEM', resolveKey, isApproved: (ref) => r.isApproved(ref), instructionSigners: ['hour-operator'],
    expectedLegs: expectedLegs(r, { payeeAccount: (id) => (id === 'producer' ? PAYEE_ACCOUNT : null) }),
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
  const duplicateInstruction = ev('settlement.instruction', instructionPayload, 'hour-operator', {
    eventId: 'evt-settlement-instruction-duplicate', network: 'gcul',
  });
  await assert.rejects(adapter.approve(duplicateInstruction), /already assigned/);
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

test('an amendment after adapter approval cancels the leg before any payment', async () => {
  const r = newRegistry();
  const { claimEvent } = approvedClaimAndAgreement(r);
  const obligation = obligationFor(r);
  r.append(obligation);
  const instructionPayload = buildSettlementInstruction(r, obligation.envelope.eventId, {
    network: 'gcul', currency: 'DEM', payeeAccount: () => '1:USR:DEM:producer-account',
  });
  const instruction = ev('settlement.instruction', instructionPayload, 'hour-operator', {
    eventId: 'evt-settlement-instruction-before-amendment', network: 'gcul',
  });
  const ledger = new FakeLedger({ operator: 'hour_chain_owner', balances: { hour_chain_owner: 1_000_000 } });
  ledger.deploy('hour_settlement_v2');
  const adapter = new GculSettlementAdapter({
    store: new LegStore(), ledger, operator: 'hour_chain_owner', contractAlias: 'hour_settlement_v2', contractId: '1:CTR:test',
    currency: 'DEM', resolveKey, isApproved: (ref) => r.isApproved(ref), instructionSigners: ['hour-operator'],
    expectedLegs: expectedLegs(r, { payeeAccount: (id) => (id === 'producer' ? PAYEE_ACCOUNT : null) }),
  });
  const [leg] = await adapter.approve(instruction);
  r.append(ev('contribution.claimed', claim({ version: 2, amends: claimEvent.envelope.eventId, durationSeconds: 3600 }), 'producer'));

  await assert.rejects(adapter.submit(leg.settlementId), /no longer approved/);
  assert.equal(adapter.store.get(leg.settlementId).state, STATES.CANCELLED);
  assert.equal(ledger.balances['1:USR:DEM:producer-account'] ?? 0, 0);
  assert.equal(ledger.settleCalls, 0);
});

test('agreement amendments require a current party, and agreement IDs cannot collide across kinds', () => {
  const r = newRegistry();
  const { agreementEvent } = approvedClaimAndAgreement(r);
  const unauthorized = ev('agreement.proposed', hourly({
    version: 2, amends: agreementEvent.envelope.eventId, parties: ['mallory'], payee: 'mallory',
  }), 'mallory');
  assert.throws(() => r.append(unauthorized), /current party/);
  assert.equal(r.agreement('agree-track-07-producer').version, 1);

  assert.throws(() => r.append(ev('agreement.proposed', hourly({
    agreementId: 'contrib-session-0001',
  }), 'artist')), /collides/);
  assert.throws(() => r.append(ev('contribution.claimed', claim({
    contributionId: 'agree-track-07-producer',
  }), 'producer')), /collides/);
});

test('obligations reject an agreement whose workRef differs from the selected contribution', () => {
  const r = newRegistry();
  const { claimEvent } = approvedClaimAndAgreement(r);
  const changedWork = ev('contribution.claimed', claim({
    version: 2, amends: claimEvent.envelope.eventId, workRef: 'work-another-track',
  }), 'producer');
  r.append(changedWork);
  r.append(ev('contribution.reviewed', { contributionId: 'contrib-session-0001', version: 2, decision: 'approve' }, 'artist'));
  r.append(ev('contribution.reviewed', { contributionId: 'contrib-session-0001', version: 2, decision: 'approve' }, 'engineer'));
  assert.throws(() => r.append(obligationFor(r, { contributionRef: 'contrib-session-0001@2' })), /workRef/);
});

test('accepted events, query results, and log entries are detached from registry state', () => {
  const r = newRegistry();
  const event = ev('contribution.claimed', claim(), 'producer');
  r.append(event);
  event.payload.durationSeconds = 1;
  event.payload.reviewers.push('mallory');
  assert.equal(r.contribution('contrib-session-0001').payload.durationSeconds, 7200);
  assert.deepEqual(r.contribution('contrib-session-0001').payload.reviewers, ['artist', 'engineer']);

  const result = r.contribution('contrib-session-0001');
  result.payload.durationSeconds = 2;
  result.reviews.set('artist', { decision: 'approve' });
  const log = r.log;
  log[0].payload.durationSeconds = 3;
  assert.equal(r.contribution('contrib-session-0001').payload.durationSeconds, 7200);
  assert.equal(r.log[0].payload.durationSeconds, 7200);
  assert.equal(ContributionRegistry.fromLog(r.log, { resolveKey, operators: ['hour-operator'] }).log.length, 1);

  const paidRegistry = newRegistry();
  approvedClaimAndAgreement(paidRegistry);
  const obligation = obligationFor(paidRegistry);
  paidRegistry.append(obligation);
  const obligationView = paidRegistry.obligation(obligation.envelope.eventId);
  obligationView.payload.amountMinor = 1;
  assert.equal(paidRegistry.obligation(obligation.envelope.eventId).payload.amountMinor, 6000);
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
  reject(ev('contribution.reviewed', { contributionId: 'contrib-session-0001', version: 1, decision: 'dispute', reason: 'changed my mind' }, 'artist'), /immutable/, 're-review');
  reject(ev('contribution.reviewed', { contributionId: 'contrib-session-0001', version: 1, decision: 'dispute' }, 'engineer'), /invalid contribution.reviewed/, 'dispute without reason');
  reject(ev('contribution.reviewed', { contributionId: 'contrib-session-0001', version: 1, decision: 'dispute', reason: '  ' }, 'engineer'), /invalid contribution.reviewed/, 'blank dispute reason');
  reject(ev('agreement.proposed', (({ termsRef, ...rest }) => ({ ...rest, agreementId: 'a-4' }))(hourly()), 'artist'), /invalid agreement.proposed/, 'no termsRef');
  reject(ev('contribution.claimed', claim({ contributionId: 'c-untimed-dup', startAt: undefined, endAt: undefined, timezone: undefined }), 'producer'), /probable duplicate/, 'untimed duplicate of a timed claim');
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

const FLOW = {
  tool: 'Google Flow', provider: 'Google', model: 'Lyria', outputs: ['audio', 'lyrics'],
  use: 'Generated instrumental and lyric drafts from my prompts in the Flow iPhone app; I chose, arranged and edited the takes.',
  evidenceRefs: ['vault://flow/project-song1'],
};

test('AI disclosure is part of the approved claim and summarised per work', () => {
  const r = newRegistry();
  const flowClaim = ev('contribution.claimed', claim({ aiAssistance: [FLOW] }), 'producer');
  r.append(flowClaim);
  r.append(ev('contribution.reviewed', { contributionId: 'contrib-session-0001', version: 1, decision: 'approve' }, 'artist'));
  r.append(ev('contribution.reviewed', { contributionId: 'contrib-session-0001', version: 1, decision: 'approve' }, 'engineer'));
  r.append(ev('contribution.claimed', claim({ contributionId: 'contrib-vocals', contributor: 'artist', role: 'vocalist', activity: 'vocals',
    startAt: '2026-11-21T18:00:00Z', endAt: '2026-11-21T19:00:00Z', durationSeconds: 3600, reviewers: ['producer'], aiAssistance: [] }), 'artist'));
  r.append(ev('contribution.claimed', claim({ contributionId: 'contrib-mix', contributor: 'engineer', role: 'engineer', activity: 'mixing',
    startAt: '2026-11-22T18:00:00Z', endAt: '2026-11-22T19:00:00Z', durationSeconds: 3600, reviewers: ['producer'] }), 'engineer'));

  const d = r.aiDisclosure('work-track-07');
  assert.equal(d.contributions.length, 3);
  assert.deepEqual(d.summary, {
    aiUsed: true, tools: ['Google Flow'], outputs: ['audio', 'lyrics'],
    undeclared: ['contrib-mix'], unapproved: ['contrib-vocals', 'contrib-mix'],
  });
  assert.deepEqual(d.contributions.find((c) => c.contributionId === 'contrib-vocals').aiAssistance, []); // declared: none
  assert.equal(d.contributions.find((c) => c.contributionId === 'contrib-mix').aiAssistance, null); // not declared

  // Changing the disclosure is an amendment: approval does not carry over.
  r.append(ev('contribution.claimed', claim({ version: 2, amends: flowClaim.envelope.eventId,
    aiAssistance: [{ ...FLOW, outputs: ['audio', 'lyrics', 'vocals'] }] }), 'producer'));
  assert.equal(r.contribution('contrib-session-0001').status, STATUS.PENDING);
  assert.ok(r.aiDisclosure('work-track-07').summary.unapproved.includes('contrib-session-0001'));
});

test('AI disclosure entries must say what the tool did and what it produced', () => {
  const r = newRegistry();
  const bad = (entry, name) => assert.throws(() => r.append(ev('contribution.claimed', claim({ aiAssistance: [entry] }), 'producer')),
    /invalid contribution.claimed/, name);
  bad({ ...FLOW, tool: ' ' }, 'blank tool');
  bad({ ...FLOW, use: '' }, 'empty use');
  bad((({ use, ...rest }) => rest)(FLOW), 'missing use');
  bad({ ...FLOW, outputs: [] }, 'no outputs');
  bad({ ...FLOW, outputs: ['song'] }, 'unknown output kind');
  bad({ ...FLOW, author: 'Google Flow' }, 'extra fields');
  assert.equal(r.log.length, 0);
});

// Adapter tests against FakeLedger, covering ADR-0009 sections 3-4: the happy
// path, replays, every unknown-outcome case, concurrent workers, mismatches,
// and reconciliation findings. Instructions are signed with real ML-DSA-65 test keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateTestKeyPair, signEnvelope } from '../../pqc-profile/src/index.mjs';
import {
  GculSettlementAdapter, InstructionError, LegStore, FakeLedger, LeaseError, STATES as S,
  deriveSettlementId, payloadHash, OutcomeUnknownError,
} from '../src/index.mjs';

const OPERATOR = 'hour_chain_owner';
const ALIAS = 'hour_settlement_v2';
const PAYEE = '1:USR:DEM:payee';
const PAYEE2 = '1:USR:DEM:payee2';
const SIGNER = 'hour:operator#k1';
const keys = generateTestKeyPair();
const APPROVED = new Set(['contrib-1@3', 'agree-1@2', 'evt-obligation-0001', 'evt-approval-0001']);

function instruction(eventId = 'evt-instruction-0001', patch = {}, { key = keys.privateKey } = {}) {
  const payload = {
    network: 'gcul',
    currency: 'DEM',
    contributionRef: 'contrib-1@3',
    agreementRef: 'agree-1@2',
    obligationRef: 'evt-obligation-0001',
    legs: [{ legIndex: 0, payee: PAYEE, amountMinor: 100 }, { legIndex: 1, payee: PAYEE2, amountMinor: 250 }],
    approvals: ['evt-approval-0001'],
    ...patch,
  };
  const envelope = signEnvelope({
    eventId,
    protocolVersion: '0.2',
    schemaVersion: '1',
    eventType: 'settlement.instruction',
    actor: 'hour:operator',
    subject: 'contrib-1',
    issuedAt: '2026-11-24T10:00:00.000Z',
    payloadHash: payloadHash(payload),
    network: 'gcul',
  }, key, { signer: SIGNER });
  return { envelope, payload };
}

function setup({ storePath = ':memory:', balance = 10_000, workerId = 'w1', ledger } = {}) {
  ledger ??= new FakeLedger({ operator: OPERATOR, balances: { [OPERATOR]: balance } });
  if (!ledger.contracts.has(ALIAS)) ledger.deploy(ALIAS);
  const store = new LegStore(storePath);
  const adapter = new GculSettlementAdapter({
    store, ledger, operator: OPERATOR, contractAlias: ALIAS, contractId: '1:CTR:test', currency: 'DEM',
    resolveKey: (signer) => (signer === SIGNER ? keys.publicKey : null),
    isApproved: (ref) => APPROVED.has(ref),
    workerId,
  });
  return { adapter, store, ledger };
}

const ids = (eventId = 'evt-instruction-0001') => [deriveSettlementId(eventId, 0), deriveSettlementId(eventId, 1)];

test('happy path: approve, submit, reconcile, valid receipt payloads', async () => {
  const { adapter, ledger } = setup();
  const ins = instruction();
  const legs = await adapter.approve(ins);
  assert.deepEqual(legs.map((l) => l.state), [S.APPROVED, S.APPROVED]);
  for (const id of ids()) assert.equal((await adapter.submit(id)).state, S.CONFIRMED);
  assert.equal(ledger.balances[PAYEE], 100);
  assert.equal(ledger.balances[PAYEE2], 250);
  assert.equal(ledger.balances[OPERATOR], 10_000 - 350);
  const report = await adapter.reconcile({ instructions: [ins], runId: 'recon-1', balances: { before: 10_000, after: ledger.balances[OPERATOR] } });
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.disputed, []);
  assert.equal(report.receipts.length, 2);
  assert.equal(report.receipts[0].settlementId, ids()[0]);
  assert.equal(report.receipts[0].finality, 'final');
  assert.match(report.receipts[0].networkTxRef, /^faketx/);
});

test('replaying an instruction or a submit never pays twice', async () => {
  const { adapter, store, ledger } = setup();
  const ins = instruction();
  await adapter.approve(ins);
  await adapter.approve(ins);
  assert.equal(store.list().length, 2);
  const [id] = ids();
  await adapter.submit(id);
  await assert.rejects(adapter.submit(id), InstructionError);
  assert.equal(ledger.settleCalls, 1);
  assert.equal(ledger.balances[PAYEE], 100);
});

test('timeout after commit: UNKNOWN resolves to CONFIRMED from the ledger, no second payment', async () => {
  const { adapter, ledger } = setup();
  await adapter.approve(instruction());
  const [id] = ids();
  ledger.faults.push('timeout-after-commit');
  assert.equal((await adapter.submit(id)).state, S.UNKNOWN);
  assert.equal((await adapter.resolveUnknown(id)).state, S.CONFIRMED);
  assert.equal(ledger.settleCalls, 1);
  assert.equal(ledger.balances[PAYEE], 100);
});

test('timeout before commit: UNKNOWN resolves to FAILED, retry pays exactly once', async () => {
  const { adapter, ledger } = setup();
  await adapter.approve(instruction());
  const [id] = ids();
  ledger.faults.push('timeout-before-commit');
  assert.equal((await adapter.submit(id)).state, S.UNKNOWN);
  assert.equal((await adapter.resolveUnknown(id)).state, S.FAILED);
  adapter.retry(id);
  assert.equal((await adapter.submit(id)).state, S.CONFIRMED);
  assert.equal(ledger.balances[PAYEE], 100);
});

test('mistaken resubmission after a lost success is caught by the pre-check, not paid', async () => {
  const { adapter, store, ledger } = setup();
  await adapter.approve(instruction());
  const [id] = ids();
  ledger.faults.push('timeout-after-commit');
  await adapter.submit(id);
  // An operator wrongly forces the leg back without resolving it first.
  store.transition(id, S.FAILED, { lastError: 'forced in test' });
  adapter.retry(id);
  const leg = await adapter.submit(id);
  assert.equal(leg.state, S.CONFIRMED);
  assert.equal(ledger.settleCalls, 1, 'pre-check must stop the second call');
  assert.equal(ledger.balances[PAYEE], 100);
});

test('slow commit after FAILED: the retry is rejected as a duplicate and confirms, still one payment', async () => {
  const { adapter, ledger } = setup();
  await adapter.approve(instruction());
  const [id] = ids();
  ledger.faults.push('timeout-before-commit');
  await adapter.submit(id);
  await adapter.resolveUnknown(id);
  adapter.retry(id);
  // The original transaction lands late, after we decided it failed.
  await ledger.settle({ contractAlias: ALIAS, sender: OPERATOR, paymentMinor: 100, settlementId: id,
    instructionId: 'evt-instruction-0001', contributionRef: 'contrib-1@3', agreementRef: 'agree-1@2', payee: PAYEE, amountMinor: 100 });
  // attempts > 0, so the pre-check finds it; either path must end CONFIRMED with one payment.
  assert.equal((await adapter.submit(id)).state, S.CONFIRMED);
  assert.equal(ledger.balances[PAYEE], 100);
});

test('crash after submit: a new adapter process resolves from the durable store', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gcul-adapter-'));
  try {
    const path = join(dir, 'legs.db');
    const ledger = new FakeLedger({ operator: OPERATOR, balances: { [OPERATOR]: 10_000 } });
    const first = setup({ storePath: path, ledger });
    await first.adapter.approve(instruction());
    const [id] = ids();
    const realSettle = ledger.settle.bind(ledger);
    ledger.settle = async (call) => { await realSettle(call); throw new Error('process killed'); };
    await assert.rejects(first.adapter.submit(id), /process killed/);
    assert.equal(first.store.get(id).state, S.UNKNOWN);
    first.store.close();
    ledger.settle = realSettle;

    const second = setup({ storePath: path, ledger, workerId: 'w2' });
    assert.equal((await second.adapter.resolveUnknown(id)).state, S.CONFIRMED);
    assert.equal(ledger.balances[PAYEE], 100);
    second.store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('two workers: the lease lets only one submit', async () => {
  const { adapter, store, ledger } = setup();
  await adapter.approve(instruction());
  const [id] = ids();
  store.acquireLease(id, 'other-worker', 60_000);
  await assert.rejects(adapter.submit(id), LeaseError);
  assert.equal(ledger.settleCalls, 0);
  store.releaseLease(id, 'other-worker');
  assert.equal((await adapter.submit(id)).state, S.CONFIRMED);
});

test('duplicate on ledger with different terms is DISPUTED, not confirmed', async () => {
  const { adapter, ledger } = setup();
  await adapter.approve(instruction());
  const [id] = ids();
  ledger.injectReceipt(ALIAS, { settlementId: id, instructionId: 'evt-instruction-0001', contributionRef: 'contrib-1@3',
    agreementRef: 'agree-1@2', payee: PAYEE, amountMinor: 999, currency: 'DEM' });
  const leg = await adapter.submit(id);
  assert.equal(leg.state, S.DISPUTED);
  assert.match(leg.lastError, /amountMinor/);
  assert.equal(ledger.balances[PAYEE] ?? 0, 0);
});

test('ledger rejection is FAILED with nothing moved', async () => {
  const { adapter, ledger } = setup({ balance: 50 });
  await adapter.approve(instruction());
  const leg = await adapter.submit(ids()[0]);
  assert.equal(leg.state, S.FAILED);
  assert.match(leg.lastError, /insufficient/);
  assert.equal(ledger.balances[OPERATOR], 50);
});

test('reconcile reports orphan receipts, receipts ahead of state, tampering and balance gaps', async () => {
  const { adapter, ledger, store } = setup();
  const ins = instruction();
  await adapter.approve(ins);
  const [a, b] = ids();
  await adapter.submit(a);
  ledger.injectReceipt(ALIAS, { settlementId: 'hst1_' + 'f'.repeat(40), instructionId: 'x', contributionRef: 'c@1',
    agreementRef: 'a@1', payee: PAYEE, amountMinor: 5, currency: 'DEM' });
  ledger.injectReceipt(ALIAS, { settlementId: b, instructionId: 'evt-instruction-0001', contributionRef: 'contrib-1@3',
    agreementRef: 'agree-1@2', payee: PAYEE2, amountMinor: 250, currency: 'DEM' });
  ledger.contracts.get(ALIAS).get(a).amountMinor = 101;
  const report = await adapter.reconcile({ instructions: [ins], runId: 'recon-2', balances: { before: 10_000, after: 9_000 } });
  const kinds = report.findings.map((f) => f.kind).sort();
  assert.deepEqual(kinds, ['balance-mismatch', 'orphan-receipt', 'receipt-ahead-of-state']);
  assert.deepEqual(report.disputed.map((d) => d.settlementId), [a]);
  assert.equal(store.get(a).state, S.DISPUTED);
  assert.equal(report.receipts.length, 0);
});

test('instructions that fail verification plan nothing', async () => {
  const { adapter, store } = setup();
  const good = instruction();
  const cases = [
    ['tampered payload', { ...good, payload: { ...good.payload, legs: [{ legIndex: 0, payee: PAYEE, amountMinor: 1_000_000 }] } }, /payloadHash/],
    ['wrong signer key', instruction('evt-instruction-0002', {}, { key: generateTestKeyPair().privateKey }), /signature invalid/],
    ['unapproved agreement', instruction('evt-instruction-0003', { agreementRef: 'agree-1@3' }), /not approved/],
    ['wrong currency', instruction('evt-instruction-0004', { currency: 'USD' }), /currency/],
    ['duplicate leg index', instruction('evt-instruction-0005', { legs: [{ legIndex: 0, payee: PAYEE, amountMinor: 1 }, { legIndex: 0, payee: PAYEE2, amountMinor: 2 }] }), /duplicate legIndex/],
    ['float amount', instruction('evt-instruction-0006', { legs: [{ legIndex: 0, payee: PAYEE, amountMinor: 1.5 }] }), /invalid instruction payload/],
  ];
  for (const [name, ins, pattern] of cases) {
    await assert.rejects(adapter.approve(ins), pattern, name);
  }
  assert.equal(store.list().length, 0);
});

test('state machine refuses transitions outside ADR-0009', async () => {
  const { adapter, store } = setup();
  await adapter.approve(instruction());
  const [id] = ids();
  assert.throws(() => store.transition(id, S.CONFIRMED), /not allowed/);
  assert.throws(() => store.transition(id, S.RECONCILED), /not allowed/);
  await assert.rejects(adapter.resolveUnknown(id), InstructionError);
  assert.ok(OutcomeUnknownError);
});

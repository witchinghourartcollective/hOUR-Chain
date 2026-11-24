// DurableRegistry: persistence, atomic appends, tamper evidence, truncation
// detection, multiple processes on one file, backup/restore, and settlement
// through gcul-adapter from a reopened store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import canonicalize from 'canonicalize';
import { createHash } from 'node:crypto';
import { generateTestKeyPair, signEnvelope } from '../../pqc-profile/src/index.mjs';
import {
  DurableRegistry, StoreIntegrityError, RegistryError, STATUS, payloadHash, calculateObligation, buildSettlementInstruction, GENESIS,
} from '../src/index.mjs';
import { GculSettlementAdapter, LegStore, FakeLedger, STATES } from '../../gcul-adapter/src/index.mjs';

const KEYS = Object.fromEntries(['producer', 'artist', 'hour-operator'].map((p) => [p, generateTestKeyPair()]));
const options = { resolveKey: (s) => KEYS[String(s).split('#')[0]]?.publicKey ?? null, operators: ['hour-operator'] };
let seq = 0;

function ev(type, payload, by, extra = {}) {
  const envelope = {
    eventId: extra.eventId ?? `evt-${type.replace('.', '-')}-${String(++seq).padStart(4, '0')}`,
    protocolVersion: '0.2', schemaVersion: '1', eventType: type, actor: by,
    subject: payload.contributionId ?? payload.agreementId ?? payload.obligationId ?? 'x',
    issuedAt: '2026-11-24T12:00:00.000Z', payloadHash: payloadHash(payload),
  };
  if (extra.network) envelope.network = extra.network;
  return { envelope: signEnvelope(envelope, KEYS[by].privateKey, { signer: `${by}#k1` }), payload };
}

const CLAIM = {
  contributionId: 'contrib-s1', version: 1, workRef: 'work-07', contributor: 'producer', role: 'producer', activity: 'recording',
  durationSeconds: 3600, startAt: '2026-11-20T18:00:00Z', endAt: '2026-11-20T19:00:00Z', evidenceRefs: [], reviewers: ['artist'],
};
const AGREEMENT = {
  agreementId: 'agree-s1', version: 1, workRef: 'work-07', contributionId: 'contrib-s1', payee: 'producer',
  parties: ['producer', 'artist'], currency: 'DEM', basis: 'hourly_rate', rateMinorPerHour: 2500, termsRef: 'vault://t/1',
};

function fullWorkflow(store) {
  store.append(ev('contribution.claimed', CLAIM, 'producer'));
  store.append(ev('contribution.reviewed', { contributionId: 'contrib-s1', version: 1, decision: 'approve' }, 'artist'));
  store.append(ev('agreement.proposed', AGREEMENT, 'artist'));
  store.append(ev('agreement.reviewed', { agreementId: 'agree-s1', version: 1, decision: 'approve' }, 'producer'));
  store.append(ev('agreement.reviewed', { agreementId: 'agree-s1', version: 1, decision: 'approve' }, 'artist'));
  const amount = calculateObligation({ agreement: AGREEMENT, contribution: CLAIM });
  const obligation = ev('obligation.calculated', { obligationId: 'obl-s1', contributionRef: 'contrib-s1@1',
    agreementRef: 'agree-s1@1', payee: 'producer', currency: 'DEM', ...amount }, 'hour-operator');
  store.append(obligation);
  return obligation;
}

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'tc-store-'));
  return Promise.resolve(fn(join(dir, 'registry.db'))).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test('state survives close and reopen, fully re-verified', () => withDir((path) => {
  const a = new DurableRegistry(path, options);
  const obligation = fullWorkflow(a);
  const head = a.head();
  assert.equal(head.seq, 6);
  a.close();
  const b = new DurableRegistry(path, { ...options, expectedHead: head });
  assert.equal(b.contribution('contrib-s1').status, STATUS.APPROVED);
  assert.equal(b.isApproved(obligation.envelope.eventId), true);
  assert.equal(b.obligation(obligation.envelope.eventId).payload.amountMinor, 2500);
  assert.deepEqual(b.head(), head);
  b.close();
}));

test('a rejected event never reaches disk', () => withDir((path) => {
  const store = new DurableRegistry(path, options);
  store.append(ev('contribution.claimed', CLAIM, 'producer'));
  assert.throws(() => store.append(ev('contribution.reviewed', { contributionId: 'contrib-s1', version: 1, decision: 'approve' }, 'producer')), RegistryError);
  assert.throws(() => store.append(ev('contribution.claimed', CLAIM, 'producer')), /next contribution version must be 2/);
  assert.equal(store.head().seq, 1);
  store.close();
  const raw = new DatabaseSync(path);
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM events').get().n, 1);
  raw.close();
}));

test('editing a stored event is detected, even with the hash chain recomputed', () => withDir((path) => {
  const store = new DurableRegistry(path, options);
  fullWorkflow(store);
  store.close();
  const raw = new DatabaseSync(path);
  const row = raw.prepare('SELECT body FROM events WHERE seq = 6').get();
  const tampered = JSON.parse(row.body);
  tampered.payload.amountMinor = 999999;
  raw.prepare('UPDATE events SET body = ? WHERE seq = 6').run(canonicalize(tampered));
  assert.throws(() => new DurableRegistry(path, options), (e) => e instanceof StoreIntegrityError && /entry hash mismatch at seq 6/.test(e.message));

  // A careful attacker also rewrites the chain; replay then rejects the bad signature/payload hash.
  let prev = GENESIS;
  for (const r of raw.prepare('SELECT seq, body FROM events ORDER BY seq').all()) {
    const hash = createHash('sha256').update(`${prev}\n${r.body}`, 'utf8').digest('hex');
    raw.prepare('UPDATE events SET prev_hash = ?, entry_hash = ? WHERE seq = ?').run(prev, hash, r.seq);
    prev = hash;
  }
  raw.close();
  assert.throws(() => new DurableRegistry(path, options), (e) => e instanceof StoreIntegrityError && /replay rejected seq 6: payloadHash/.test(e.message));
}));

test('deleting a stored event is detected; truncation is caught by an anchored head', () => withDir((path) => {
  const store = new DurableRegistry(path, options);
  fullWorkflow(store);
  const head = store.head();
  store.close();
  const raw = new DatabaseSync(path);
  raw.prepare('DELETE FROM events WHERE seq = 6').run();
  raw.close();
  // Removing only the newest row leaves a valid chain...
  const opened = new DurableRegistry(path, options);
  assert.equal(opened.head().seq, 5);
  opened.close();
  // ...which the externally anchored head exposes.
  assert.throws(() => new DurableRegistry(path, { ...options, expectedHead: head }), /expected head/);
  const raw2 = new DatabaseSync(path);
  raw2.prepare('DELETE FROM events WHERE seq = 3').run();
  raw2.close();
  assert.throws(() => new DurableRegistry(path, options), /sequence gap: expected 3, found 4/);
}));

test('two processes on one file see each other\'s appends', () => withDir((path) => {
  const a = new DurableRegistry(path, options);
  const b = new DurableRegistry(path, options);
  a.append(ev('contribution.claimed', CLAIM, 'producer'));
  // b has not read since a appended; append() syncs first, so the review finds the claim.
  b.append(ev('contribution.reviewed', { contributionId: 'contrib-s1', version: 1, decision: 'approve' }, 'artist'));
  assert.equal(a.isApproved('contrib-s1@1'), true);
  assert.equal(b.isApproved('contrib-s1@1'), true);
  assert.deepEqual(a.head(), b.head());
  a.close();
  b.close();
}));

test('JSONL backup restores to an identical, re-verified store', () => withDir((path) => {
  const a = new DurableRegistry(path, options);
  const obligation = fullWorkflow(a);
  const backup = a.exportJsonl();
  const head = a.head();
  a.close();
  const restored = DurableRegistry.importJsonl(`${path}.restore`, backup, options);
  assert.deepEqual(restored.head(), head);
  assert.equal(restored.isApproved(obligation.envelope.eventId), true);
  assert.throws(() => DurableRegistry.importJsonl(`${path}.restore`, backup, options), /not empty/);
  restored.close();
  const corrupt = backup.replace('"amountMinor":2500', '"amountMinor":2501');
  assert.throws(() => DurableRegistry.importJsonl(`${path}.corrupt`, corrupt, options), /payloadHash/);
}));

test('the adapter settles from a reopened store and refuses a stale obligation', () => withDir(async (path) => {
  const writer = new DurableRegistry(path, options);
  const obligation = fullWorkflow(writer);
  writer.close();

  const registry = new DurableRegistry(path, options);
  const payload = buildSettlementInstruction(registry, obligation.envelope.eventId,
    { network: 'gcul', currency: 'DEM', payeeAccount: () => '1:USR:DEM:producer' });
  const instruction = ev('settlement.instruction', payload, 'hour-operator', { eventId: 'evt-settlement-instruction-s1', network: 'gcul' });
  const ledger = new FakeLedger({ operator: 'op', balances: { op: 100_000 } });
  ledger.deploy('v2');
  const adapter = new GculSettlementAdapter({ store: new LegStore(), ledger, operator: 'op', contractAlias: 'v2', contractId: '1:CTR:t',
    currency: 'DEM', resolveKey: options.resolveKey, isApproved: (ref) => registry.isApproved(ref) });
  const [leg] = await adapter.approve(instruction);

  // A second process amends the claim before submission: the leg must be cancelled, not paid.
  const amender = new DurableRegistry(path, options);
  amender.append(ev('contribution.claimed', { ...CLAIM, version: 2, amends: amender.contribution('contrib-s1', 1).eventId,
    durationSeconds: 1800, endAt: '2026-11-20T18:30:00Z' }, 'producer'));
  amender.close();

  await assert.rejects(adapter.submit(leg.settlementId), /no longer approved/);
  assert.equal(adapter.store.get(leg.settlementId).state, STATES.CANCELLED);
  assert.equal(ledger.balances['1:USR:DEM:producer'] ?? 0, 0);
  registry.close();
}));

test('a running instance refuses to roll back when a trailing amendment is deleted', () => withDir((path) => {
  const adapterView = new DurableRegistry(path, options);
  const obligation = fullWorkflow(adapterView);
  adapterView.append(ev('contribution.claimed', { ...CLAIM, version: 2, amends: adapterView.contribution('contrib-s1', 1).eventId,
    durationSeconds: 1800, endAt: '2026-11-20T18:30:00Z' }, 'producer'));
  assert.equal(adapterView.isApproved(obligation.envelope.eventId), false); // stale after the amendment
  const raw = new DatabaseSync(path);
  raw.prepare('DELETE FROM events WHERE seq = 7').run(); // remove the amendment behind the instance's back
  raw.close();
  // Without the rollback guard this would return true and the stale obligation could be paid.
  assert.throws(() => adapterView.isApproved(obligation.envelope.eventId), /refusing to roll back/);
  adapterView.close();
}));

test('a same-length rewrite of the newest entry is refused by a running instance', () => withDir((path) => {
  const a = new DurableRegistry(path, options);
  fullWorkflow(a);
  const raw = new DatabaseSync(path);
  raw.prepare('DELETE FROM events WHERE seq = 6').run();
  raw.close();
  const b = new DurableRegistry(path, options); // fresh instance: has no memory of seq 6
  b.append(ev('revenue.reported', { revenueId: 'rev-x', workRef: 'work-07', amountMinor: 10, currency: 'DEM',
    periodStart: '2026-11-01T00:00:00Z', periodEnd: '2026-12-01T00:00:00Z' }, 'hour-operator'));
  b.close();
  assert.throws(() => a.head(), /refusing to roll back/);
  a.close();
}));

test('the genesis checkpoint round-trips and anchors any later log', () => withDir((path) => {
  const empty = new DurableRegistry(path, options);
  const genesis = empty.head();
  assert.deepEqual(genesis, { seq: 0, hash: GENESIS });
  empty.close();
  const reopened = new DurableRegistry(path, { ...options, expectedHead: genesis });
  fullWorkflow(reopened);
  reopened.close();
  new DurableRegistry(path, { ...options, expectedHead: genesis }).close();
  assert.throws(() => new DurableRegistry(path, { ...options, expectedHead: { seq: 0, hash: 'f'.repeat(64) } }), /expected head/);
}));

test('imports are all or nothing, and an anchored import succeeds', () => withDir((path) => {
  const source = new DurableRegistry(path, options);
  fullWorkflow(source);
  const backup = source.exportJsonl();
  const head = source.head();
  source.close();

  const lines = backup.split('\n');
  lines[5] = lines[5].replace('"amountMinor":2500', '"amountMinor":2501'); // corrupt the last line only
  assert.throws(() => DurableRegistry.importJsonl(`${path}.t`, lines.join('\n'), options), /backup rejected/);
  const raw = new DatabaseSync(`${path}.t`, { open: true });
  const exists = raw.prepare("SELECT name FROM sqlite_master WHERE name = 'events'").get();
  assert.equal(exists ? raw.prepare('SELECT COUNT(*) AS n FROM events').get().n : 0, 0, 'no partial prefix written');
  raw.close();

  const restored = DurableRegistry.importJsonl(`${path}.t`, backup, { ...options, expectedHead: head }); // retry into the same target
  assert.deepEqual(restored.head(), head);
  restored.close();
  assert.throws(() => DurableRegistry.importJsonl(`${path}.u`, backup, { ...options, expectedHead: { seq: 6, hash: 'a'.repeat(64) } }), /expected head/);
}));

test('importing into an in-memory store keeps the data, with or without an anchor', () => withDir((path) => {
  const source = new DurableRegistry(path, options);
  const obligation = fullWorkflow(source);
  const backup = source.exportJsonl();
  const head = source.head();
  source.close();
  const plain = DurableRegistry.importJsonl(':memory:', backup, options);
  assert.deepEqual(plain.head(), head);
  assert.equal(plain.isApproved(obligation.envelope.eventId), true);
  plain.close();
  const anchored = DurableRegistry.importJsonl(':memory:', backup, { ...options, expectedHead: head });
  assert.deepEqual(anchored.head(), head);
  anchored.close();
}));

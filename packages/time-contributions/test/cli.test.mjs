// Drives the hour-time binary end to end: one profile per person, a shared
// store, signing on separate machines with --out/append, a dispute and a
// traceable correction, an obligation computed by the tool, and a signed
// settlement instruction that gcul-adapter accepts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importPublicKey } from '../../pqc-profile/src/index.mjs';
import { GculSettlementAdapter, LegStore, FakeLedger, STATES } from '../../gcul-adapter/src/index.mjs';
import { DurableRegistry, expectedLegs } from '../src/index.mjs';
import { DatabaseSync } from 'node:sqlite';

const BIN = fileURLToPath(new URL('../bin/hour-time.mjs', import.meta.url));

test('hour-time runs the real-hours workflow end to end', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hour-time-'));
  try {
    const store = join(root, 'shared', 'registry.db');
    const people = ['producer', 'artist', 'engineer', 'hour-operator'];
    const home = (who) => join(root, who);
    const run = (who, ...args) => {
      const r = spawnSync(process.execPath, [BIN, ...args], { env: { ...process.env, HOUR_HOME: home(who) }, encoding: 'utf8' });
      return { code: r.status, out: r.stdout, err: r.stderr };
    };
    const ok = (who, ...args) => {
      const r = run(who, ...args);
      assert.equal(r.code, 0, `${who} ${args.join(' ')}\n${r.err}`);
      return r.out;
    };

    // Each person creates a key; everyone trusts everyone; all point at the shared store.
    const publicKeys = {};
    for (const who of people) {
      publicKeys[who] = ok(who, 'keygen', '--identity', who).trim().split('\n').pop();
      assert.equal(statSync(join(home(who), 'signing-key.json')).mode & 0o777, 0o600, 'signing key must be private');
    }
    assert.equal(run('producer', 'keygen', '--identity', 'producer').code, 1, 'keygen must not overwrite a key');
    for (const who of people) {
      for (const other of people) if (other !== who) ok(who, 'trust', '--identity', other, '--public-key', publicKeys[other]);
      ok(who, 'config', '--store', store, '--operators', 'hour-operator');
    }

    // The producer claims 3h; the engineer disputes; the producer corrects to 2h.
    ok('producer', 'claim', '--contribution-id', 'contrib-s1', '--work', 'work-07', '--role', 'producer', '--activity', 'recording',
      '--duration', '3h', '--start', '2026-11-20T18:00:00Z', '--end', '2026-11-20T21:00:00Z', '--timezone', 'America/New_York',
      '--evidence', 'ipfs://bafy-session', '--reviewers', 'artist,engineer');
    ok('artist', 'review', '--contribution-id', 'contrib-s1', '--version', '1', '--approve');
    assert.match(run('engineer', 'review', '--contribution-id', 'contrib-s1', '--version', '1', '--dispute').err, /invalid contribution.reviewed/,
      'a dispute without a reason is refused');
    ok('engineer', 'review', '--contribution-id', 'contrib-s1', '--version', '1', '--dispute', '--reason', 'session ended at 20:00');
    ok('producer', 'claim', '--contribution-id', 'contrib-s1', '--work', 'work-07', '--role', 'producer', '--activity', 'recording',
      '--duration', '2h', '--start', '2026-11-20T18:00:00Z', '--end', '2026-11-20T20:00:00Z', '--reviewers', 'artist,engineer', '--amends');

    // The engineer is on another machine: signs to a file; the operator appends it.
    const signed = join(root, 'engineer-review.json');
    ok('engineer', 'review', '--contribution-id', 'contrib-s1', '--version', '2', '--approve', '--out', signed);
    ok('artist', 'review', '--contribution-id', 'contrib-s1', '--version', '2', '--approve');
    ok('hour-operator', 'append', signed);
    const status = JSON.parse(ok('producer', 'status', '--contribution-id', 'contrib-s1'));
    assert.deepEqual(status.map((v) => v.status), ['SUPERSEDED', 'APPROVED']);
    assert.equal(status[0].reviews.engineer, 'dispute: session ended at 20:00');

    // Agreement, approved by both parties; the obligation amount is computed by the tool.
    ok('artist', 'propose-agreement', '--agreement-id', 'agree-s1', '--work', 'work-07', '--contribution-id', 'contrib-s1',
      '--payee', 'producer', '--parties', 'producer,artist', '--currency', 'DEM', '--terms-ref', 'vault://t/1', '--rate-per-hour', '3000');
    ok('producer', 'review-agreement', '--agreement-id', 'agree-s1', '--version', '1', '--approve');
    ok('artist', 'review-agreement', '--agreement-id', 'agree-s1', '--version', '1', '--approve');
    assert.equal(run('producer', 'obligation', '--obligation-id', 'obl-1', '--contribution-ref', 'contrib-s1@2', '--agreement-ref', 'agree-s1@1').code, 1,
      'only operators calculate obligations');
    const obl = ok('hour-operator', 'obligation', '--obligation-id', 'obl-1', '--contribution-ref', 'contrib-s1@2', '--agreement-ref', 'agree-s1@1');
    assert.match(obl, /amount: 6000 DEM/);
    const obligationEventId = /appended obligation.calculated (\S+)/.exec(obl)[1];

    // Settlement instruction, accepted and paid by the adapter exactly once.
    const instructionFile = join(root, 'instruction.json');
    ok('hour-operator', 'instruction', '--obligation', obligationEventId, '--payee-account', '1:USR:DEM:producer', '--currency', 'DEM', '--out', instructionFile);
    const instruction = JSON.parse(readFileSync(instructionFile, 'utf8'));
    const keys = Object.fromEntries(Object.entries(publicKeys).map(([who, k]) => [who, importPublicKey(k)]));
    const resolveKey = (s) => keys[String(s).split('#')[0]] ?? null;
    const registry = new DurableRegistry(store, { resolveKey, operators: ['hour-operator'] });
    const resolveInstructionKey = (s) => (s === 'hour-operator#k1' ? keys['hour-operator'] : null);
    const ledger = new FakeLedger({ operator: 'op', balances: { op: 100_000 } });
    ledger.deploy('v2');
    const adapter = new GculSettlementAdapter({ store: new LegStore(), ledger, operator: 'op', contractAlias: 'v2', contractId: '1:CTR:t',
      currency: 'DEM', resolveKey: resolveInstructionKey, isApproved: (ref) => registry.isApproved(ref), instructionSigners: ['hour-operator'],
      expectedLegs: expectedLegs(registry, { payeeAccount: (id) => (id === 'producer' ? '1:USR:DEM:producer' : null) }) });
    const [leg] = await adapter.approve(instruction);
    assert.equal((await adapter.submit(leg.settlementId)).state, STATES.CONFIRMED);
    assert.equal(ledger.balances['1:USR:DEM:producer'], 6000);
    registry.close();

    // Unknown signers are refused; head is printable for anchoring.
    const stranger = join(root, 'stranger');
    spawnSync(process.execPath, [BIN, 'keygen', '--identity', 'mallory'], { env: { ...process.env, HOUR_HOME: stranger } });
    spawnSync(process.execPath, [BIN, 'config', '--store', store], { env: { ...process.env, HOUR_HOME: stranger } });
    const forged = join(root, 'forged.json');
    spawnSync(process.execPath, [BIN, 'review', '--contribution-id', 'contrib-s1', '--version', '2', '--approve', '--out', forged],
      { env: { ...process.env, HOUR_HOME: stranger } });
    assert.match(run('hour-operator', 'append', forged).err, /no key for signer mallory/);
    assert.match(ok('producer', 'head'), /^\{"seq":\d+,"hash":"[0-9a-f]{64}"\}/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('hour-time: operator-only instructions, offline amendments, key rotation, recorded anchors', () => {
  const root = mkdtempSync(join(tmpdir(), 'hour-time-2-'));
  try {
    const store = join(root, 'shared', 'registry.db');
    const people = ['producer', 'artist', 'hour-operator'];
    const home = (who) => join(root, who);
    const run = (who, ...args) => {
      const r = spawnSync(process.execPath, [BIN, ...args], { env: { ...process.env, HOUR_HOME: home(who) }, encoding: 'utf8' });
      return { code: r.status, out: r.stdout, err: r.stderr };
    };
    const ok = (who, ...args) => { const r = run(who, ...args); assert.equal(r.code, 0, `${who} ${args.join(' ')}\n${r.err}`); return r.out; };
    const keyOf = (out) => out.trim().split('\n').pop();
    const pub = {};
    for (const who of people) pub[who] = keyOf(ok(who, 'keygen', '--identity', who));
    for (const who of people) {
      for (const other of people) if (other !== who) ok(who, 'trust', '--identity', other, '--public-key', pub[other]);
      ok(who, 'config', '--store', store, '--operators', 'hour-operator');
    }
    const claimArgs = ['--contribution-id', 'contrib-c1', '--work', 'work-w1', '--role', 'producer', '--activity', 'mixing',
      '--start', '2026-11-21T10:00:00Z', '--end', '2026-11-21T12:00:00Z', '--reviewers', 'artist'];
    ok('producer', 'claim', ...claimArgs, '--duration', '2h');
    const v1 = JSON.parse(ok('producer', 'status', '--contribution-id', 'contrib-c1'))[0];

    // Offline amendment: the producer's store path is unreachable, yet --amends-event/--amends-version + --out works.
    ok('producer', 'config', '--store', join(root, 'not-a-dir-file', 'x.db'));
    spawnSync('sh', ['-c', `: > ${join(root, 'not-a-dir-file')}`]);
    const amendFile = join(root, 'amend.json');
    ok('producer', 'claim', ...claimArgs, '--duration', '90m', '--amends', '--amends-event', v1.eventId, '--amends-version', '1', '--out', amendFile);
    assert.equal(run('producer', 'claim', ...claimArgs, '--duration', '90m', '--amends', '--out', amendFile).code, 1, 'store lookup fails offline');
    ok('hour-operator', 'append', amendFile);
    ok('producer', 'config', '--store', store);

    // Key rotation: the artist moves to k2; others add k2 without losing k1; history still verifies.
    assert.equal(run('hour-operator', 'trust', '--identity', 'artist', '--public-key', pub.producer).code, 1, 'k1 cannot be replaced');
    const k2 = keyOf(ok('artist', 'keygen', '--rotate'));
    assert.match(ok('artist', 'whoami'), /"keyId": "k2"/);
    for (const who of ['producer', 'hour-operator']) ok(who, 'trust', '--identity', 'artist', '--public-key', k2, '--key-id', 'k2');
    ok('artist', 'review', '--contribution-id', 'contrib-c1', '--version', '2', '--approve'); // signed artist#k2
    const status = JSON.parse(ok('hour-operator', 'status', '--contribution-id', 'contrib-c1'));
    assert.deepEqual(status.map((v) => v.status), ['SUPERSEDED', 'APPROVED']);

    // Only operators sign instructions.
    ok('artist', 'propose-agreement', '--agreement-id', 'agree-a1', '--work', 'work-w1', '--contribution-id', 'contrib-c1', '--payee', 'producer',
      '--parties', 'producer,artist', '--currency', 'DEM', '--terms-ref', 'vault://t', '--fee', '5000');
    ok('producer', 'review-agreement', '--agreement-id', 'agree-a1', '--version', '1', '--approve');
    ok('artist', 'review-agreement', '--agreement-id', 'agree-a1', '--version', '1', '--approve');
    const obl = ok('hour-operator', 'obligation', '--obligation-id', 'obl-o1', '--contribution-ref', 'contrib-c1@2', '--agreement-ref', 'agree-a1@1');
    const oblId = /appended obligation.calculated (\S+)/.exec(obl)[1];
    const byProducer = run('producer', 'instruction', '--obligation', oblId, '--payee-account', '1:USR:DEM:attacker', '--out', join(root, 'i.json'));
    assert.equal(byProducer.code, 1);
    assert.match(byProducer.err, /only operators may sign settlement instructions/);
    ok('hour-operator', 'instruction', '--obligation', oblId, '--payee-account', '1:USR:DEM:producer', '--out', join(root, 'i.json'));

    // A recorded anchor makes a later truncation fatal for that profile.
    assert.match(ok('hour-operator', 'head', '--record'), /recorded as this profile's anchor/);
    const raw = new DatabaseSync(store);
    raw.prepare('DELETE FROM events WHERE seq = (SELECT MAX(seq) FROM events)').run();
    raw.close();
    assert.match(run('hour-operator', 'status').err, /expected head/);
    assert.equal(run('producer', 'status').code, 0, 'a profile without that anchor still opens the shorter valid log');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('hour-time: AI disclosure for a song made in Google Flow', () => {
  const root = mkdtempSync(join(tmpdir(), 'hour-time-ai-'));
  try {
    const store = join(root, 'shared', 'registry.db');
    const people = ['producer', 'artist'];
    const run = (who, ...args) => {
      const r = spawnSync(process.execPath, [BIN, ...args], { env: { ...process.env, HOUR_HOME: join(root, who) }, encoding: 'utf8' });
      return { code: r.status, out: r.stdout, err: r.stderr };
    };
    const ok = (who, ...args) => { const r = run(who, ...args); assert.equal(r.code, 0, `${who} ${args.join(' ')}\n${r.err}`); return r.out; };
    const pub = {};
    for (const who of people) pub[who] = ok(who, 'keygen', '--identity', who).trim().split('\n').pop();
    for (const who of people) {
      for (const other of people) if (other !== who) ok(who, 'trust', '--identity', other, '--public-key', pub[other]);
      ok(who, 'config', '--store', store, '--operators', 'producer');
    }
    const base = ['--work', 'work-song1', '--duration', '2h'];
    assert.match(run('producer', 'claim', '--contribution-id', 'contrib-x', ...base, '--role', 'producer', '--activity', 'production',
      '--reviewers', 'artist', '--ai-tool', 'Google Flow').err, /--ai-use is required/);
    assert.match(run('producer', 'claim', '--contribution-id', 'contrib-x', ...base, '--role', 'producer', '--activity', 'production',
      '--reviewers', 'artist', '--no-ai', '--ai-tool', 'Google Flow').err, /cannot be combined/);

    ok('producer', 'claim', '--contribution-id', 'contrib-song1-prod', ...base, '--role', 'producer', '--activity', 'ai-assisted-production',
      '--start', '2026-11-24T19:00:00Z', '--end', '2026-11-24T21:00:00Z', '--reviewers', 'artist',
      '--ai-tool', 'Google Flow', '--ai-provider', 'Google', '--ai-model', 'Lyria', '--ai-output', 'audio,lyrics',
      '--ai-use', 'Generated the beat and lyric drafts from my prompts in the Flow iPhone app; I picked, arranged and edited them.',
      '--ai-evidence', 'vault://flow/song1-session');
    ok('artist', 'review', '--contribution-id', 'contrib-song1-prod', '--version', '1', '--approve');
    ok('artist', 'claim', '--contribution-id', 'contrib-song1-vocals', ...base, '--role', 'vocalist', '--activity', 'vocals',
      '--start', '2026-11-24T21:00:00Z', '--end', '2026-11-24T23:00:00Z', '--reviewers', 'producer', '--no-ai');

    const out = ok('producer', 'disclosure', '--work', 'work-song1');
    assert.match(out, /^AI used: yes \(Google Flow; outputs: audio, lyrics\)/);
    assert.match(out, /not yet approved by reviewers: contrib-song1-vocals/);
    const json = JSON.parse(out.slice(out.indexOf('{')));
    const prod = json.contributions.find((c) => c.contributionId === 'contrib-song1-prod');
    assert.equal(prod.aiAssistance[0].model, 'Lyria');
    assert.equal(prod.status, 'APPROVED');
    assert.deepEqual(json.contributions.find((c) => c.contributionId === 'contrib-song1-vocals').aiAssistance, []);
    assert.match(ok('producer', 'status', '--contribution-id', 'contrib-song1-prod'), /"tool": "Google Flow"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

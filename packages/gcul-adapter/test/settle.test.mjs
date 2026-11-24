// End-to-end: a solo pilot (producer, label, operator identities) through
// hour-time, then scripts/settle.mjs on a persisted fake ledger: dry run sends
// nothing, live pays once, a re-run never pays twice, and an instruction that
// pays the wrong account is refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOUR_TIME = fileURLToPath(new URL('../../time-contributions/bin/hour-time.mjs', import.meta.url));
const SETTLE = fileURLToPath(new URL('../scripts/settle.mjs', import.meta.url));
const PAYEE_ACCOUNT = '1:USR:DEM:022nXHgAmjMB8mXkdDcqA3HaR9D8EyXD6vAj6urJ7qJ68';

test('solo pilot: hour-time records, then settle.mjs pays exactly once', () => {
  const root = mkdtempSync(join(tmpdir(), 'settle-'));
  try {
    const store = join(root, 'registry.db');
    const ids = ['fletcher', 'witchinghour-label', 'hour-operator'];
    const home = (id) => join(root, id);
    const hour = (id, ...a) => spawnSync(process.execPath, [HOUR_TIME, ...a], { env: { ...process.env, HOUR_HOME: home(id) }, encoding: 'utf8' });
    const ok = (id, ...a) => { const r = hour(id, ...a); assert.equal(r.status, 0, `${id} ${a.join(' ')}\n${r.stderr}`); return r.stdout; };
    const pub = {};
    for (const id of ids) pub[id] = ok(id, 'keygen', '--identity', id).trim().split('\n').pop();
    for (const id of ids) {
      for (const o of ids) if (o !== id) ok(id, 'trust', '--identity', o, '--public-key', pub[o]);
      ok(id, 'config', '--store', store, '--operators', 'hour-operator');
    }
    ok('fletcher', 'claim', '--contribution-id', 'contrib-song1-prod', '--work', 'work-song1', '--role', 'producer',
      '--activity', 'ai-assisted-production', '--duration', '2h', '--start', '2026-11-25T19:00:00Z', '--end', '2026-11-25T21:00:00Z',
      '--reviewers', 'witchinghour-label', '--ai-tool', 'Google Flow', '--ai-provider', 'Google', '--ai-model', 'Lyria',
      '--ai-output', 'audio,lyrics', '--ai-use', 'Generated the track from my prompts; I selected and arranged the takes.');
    ok('witchinghour-label', 'review', '--contribution-id', 'contrib-song1-prod', '--version', '1', '--approve');
    ok('witchinghour-label', 'propose-agreement', '--agreement-id', 'agree-song1-prod', '--work', 'work-song1',
      '--contribution-id', 'contrib-song1-prod', '--payee', 'fletcher', '--parties', 'fletcher,witchinghour-label',
      '--currency', 'DEM', '--terms-ref', 'vault://agreements/song1', '--fee', '250');
    ok('fletcher', 'review-agreement', '--agreement-id', 'agree-song1-prod', '--version', '1', '--approve');
    ok('witchinghour-label', 'review-agreement', '--agreement-id', 'agree-song1-prod', '--version', '1', '--approve');
    const obl = ok('hour-operator', 'obligation', '--obligation-id', 'obl-song1-prod', '--contribution-ref', 'contrib-song1-prod@1',
      '--agreement-ref', 'agree-song1-prod@1');
    const oblId = /appended obligation.calculated (\S+)/.exec(obl)[1];
    ok('hour-operator', 'head', '--record');
    const instruction = join(root, 'instruction.json');
    ok('hour-operator', 'instruction', '--obligation', oblId, '--payee-account', PAYEE_ACCOUNT, '--currency', 'DEM', '--out', instruction);

    const payees = join(root, 'payees.json');
    writeFileSync(payees, JSON.stringify({ fletcher: { account: PAYEE_ACCOUNT, alias: 'hour_chain_user2' } }));
    const ledgerState = join(root, 'fake-ledger.json');
    const settle = (file, ...extra) => spawnSync(process.execPath, [SETTLE, '--instruction', file, '--operator-home', home('hour-operator'),
      '--payees', payees, '--state-dir', join(root, 'state'), '--ledger', 'fake', '--fake-ledger-state', ledgerState, ...extra], { encoding: 'utf8' });
    const balances = () => JSON.parse(readFileSync(ledgerState, 'utf8')).balances;

    const dry = settle(instruction);
    assert.equal(dry.status, 0, dry.stderr + dry.stdout);
    assert.match(dry.stdout, /Dry run only: nothing was submitted/);
    assert.equal(balances()[PAYEE_ACCOUNT] ?? 0, 0);

    const live = settle(instruction, '--live');
    assert.equal(live.status, 0, live.stderr + live.stdout);
    assert.match(live.stdout, /"state": "CONFIRMED"/);
    assert.match(live.stdout, /"finality": "final"/);
    assert.equal(balances()[PAYEE_ACCOUNT], 250);

    const again = settle(instruction, '--live');
    assert.equal(again.status, 0, again.stderr + again.stdout);
    assert.match(again.stdout, /not submitted/);
    assert.equal(balances()[PAYEE_ACCOUNT], 250, 'a re-run must not pay twice');

    // The operator signs an instruction paying another account: refused before anything is planned.
    const redirected = join(root, 'redirected.json');
    ok('hour-operator', 'instruction', '--obligation', oblId, '--payee-account', '1:USR:DEM:somebody-else', '--currency', 'DEM', '--out', redirected);
    const bad = settle(redirected, '--live');
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /do not match the expected payee accounts and amounts/);
    assert.equal(balances()['1:USR:DEM:somebody-else'] ?? 0, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

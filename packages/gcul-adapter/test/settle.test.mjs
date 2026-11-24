// End-to-end: a solo pilot (producer, label, operator identities) through
// hour-time, then scripts/settle.mjs on a persisted fake ledger: dry run sends
// nothing, live pays once, a re-run never pays twice, and an instruction that
// pays the wrong account is refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

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

    // The real-ledger path refuses a stale alias before displaying a plan or invoking the contract.
    mkdirSync(join(root, 'bin'));
    writeFileSync(join(root, 'bin', 'ul-cli'), `#!/bin/sh
case "$*" in
  *"contracts invoke"*) echo invoked >> "${root}/invoked"; exit 1 ;;
  *"--alias hour_chain_owner"*) echo "Balance: 1000000" ;;
  *"--alias hour_settlement_v2"*) echo "Account: 1:CTR:contract" ;;
  *"--alias hour_chain_user2"*) echo "Account: 1:USR:DEM:wrong" ;;
esac
`, { mode: 0o755 });
    const real = spawnSync(process.execPath, [SETTLE, '--instruction', instruction, '--operator-home', home('hour-operator'),
      '--payees', payees, '--state-dir', join(root, 'real-state'), '--live'], { env: { ...process.env, HOME: root }, encoding: 'utf8' });
    assert.equal(real.status, 1, real.stderr + real.stdout);
    assert.match(real.stdout, /does not resolve/);
    assert.doesNotMatch(real.stdout, /verified plan/);
    assert.throws(() => readFileSync(join(root, 'invoked')));

    // A definite rejection is reported and needs an explicit same-ID retry.
    const empty = JSON.parse(readFileSync(ledgerState, 'utf8'));
    empty.balances.hour_chain_owner = 0;
    writeFileSync(ledgerState, JSON.stringify(empty));
    const failed = settle(instruction, '--live');
    assert.equal(failed.status, 1, failed.stderr + failed.stdout);
    assert.match(failed.stdout, /"state": "FAILED"/);
    assert.match(failed.stdout, /## reconcile/);
    assert.match(failed.stdout, /Evidence written to/);
    const funded = JSON.parse(readFileSync(ledgerState, 'utf8'));
    funded.balances.hour_chain_owner = 1000000;
    writeFileSync(ledgerState, JSON.stringify(funded));
    assert.equal(settle(instruction, '--live').status, 1);
    assert.equal(balances()[PAYEE_ACCOUNT] ?? 0, 0);
    const live = settle(instruction, '--live', '--retry-failed');
    assert.equal(live.status, 0, live.stderr + live.stdout);
    assert.match(live.stdout, /"state": "CONFIRMED"/);
    assert.match(live.stdout, /"finality": "final"/);
    assert.equal(balances()[PAYEE_ACCOUNT], 250);

    const again = settle(instruction, '--live');
    assert.equal(again.status, 0, again.stderr + again.stdout);
    assert.match(again.stdout, /not submitted/);
    assert.equal(balances()[PAYEE_ACCOUNT], 250, 'a re-run must not pay twice');

    const db = new DatabaseSync(join(root, 'state', 'settlement-legs-fake.db'));
    const setState = (state, leaseOwner = null, expiry = null) =>
      db.prepare('UPDATE legs SET state = ?, lease_owner = ?, lease_expires_at = ?').run(state, leaseOwner, expiry);
    const snapshot = readFileSync(ledgerState, 'utf8');
    setState('UNKNOWN');
    const recovered = settle(instruction, '--live');
    assert.equal(recovered.status, 0, recovered.stderr + recovered.stdout);
    assert.match(recovered.stdout, /"state": "CONFIRMED"/);
    assert.equal(balances()[PAYEE_ACCOUNT], 250);

    setState('UNKNOWN');
    const absent = JSON.parse(snapshot);
    absent.receipts = [];
    absent.balances.hour_chain_owner = 1000000;
    delete absent.balances[PAYEE_ACCOUNT];
    writeFileSync(ledgerState, JSON.stringify(absent));
    const unresolved = settle(instruction, '--live');
    assert.equal(unresolved.status, 1);
    assert.match(unresolved.stdout, /"state": "FAILED"/);
    assert.equal(settle(instruction, '--live', '--retry-failed').status, 0);
    assert.equal(balances()[PAYEE_ACCOUNT], 250);

    setState('SUBMITTING', 'other-worker', Date.now() + 60000);
    assert.equal(settle(instruction, '--live').status, 1);
    assert.equal(settle(instruction, '--live', '--recover-submitting').status, 1);
    assert.equal(db.prepare('SELECT state FROM legs').get().state, 'SUBMITTING');
    setState('SUBMITTING', 'other-worker', Date.now() - 1);
    assert.equal(settle(instruction, '--live', '--recover-submitting').status, 0);
    assert.equal(balances()[PAYEE_ACCOUNT], 250);

    const mismatch = JSON.parse(readFileSync(ledgerState, 'utf8'));
    mismatch.receipts[0].payee = '1:USR:DEM:wrong';
    writeFileSync(ledgerState, JSON.stringify(mismatch));
    const disputed = settle(instruction, '--live');
    assert.equal(disputed.status, 1);
    assert.match(disputed.stdout, /reconciled-receipt-mismatch/);
    assert.match(disputed.stdout, /Evidence written to/);
    writeFileSync(ledgerState, snapshot);
    db.close();

    // The operator signs an instruction paying another account: refused before anything is planned.
    const redirected = join(root, 'redirected.json');
    ok('hour-operator', 'instruction', '--obligation', oblId, '--payee-account', '1:USR:DEM:somebody-else', '--currency', 'DEM', '--out', redirected);
    const bad = settle(redirected, '--live');
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /do not match the expected payee accounts and amounts/);
    assert.equal(balances()['1:USR:DEM:somebody-else'] ?? 0, 0);

    ok('witchinghour-label', 'propose-agreement', '--agreement-id', 'agree-usd', '--work', 'work-song1',
      '--contribution-id', 'contrib-song1-prod', '--payee', 'fletcher', '--parties', 'fletcher,witchinghour-label',
      '--currency', 'USD', '--terms-ref', 'vault://agreements/usd', '--fee', '250');
    ok('fletcher', 'review-agreement', '--agreement-id', 'agree-usd', '--version', '1', '--approve');
    ok('witchinghour-label', 'review-agreement', '--agreement-id', 'agree-usd', '--version', '1', '--approve');
    const usdObl = ok('hour-operator', 'obligation', '--obligation-id', 'obl-usd', '--contribution-ref', 'contrib-song1-prod@1',
      '--agreement-ref', 'agree-usd@1');
    ok('hour-operator', 'head', '--record');
    const usd = join(root, 'usd.json');
    ok('hour-operator', 'instruction', '--obligation', /appended obligation.calculated (\S+)/.exec(usdObl)[1],
      '--payee-account', PAYEE_ACCOUNT, '--currency', 'USD', '--out', usd);
    const wrongCurrency = settle(usd, '--live');
    assert.equal(wrongCurrency.status, 1);
    assert.match(wrongCurrency.stdout, /currency USD is not DEM/);
    assert.equal(balances()[PAYEE_ACCOUNT], 250);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

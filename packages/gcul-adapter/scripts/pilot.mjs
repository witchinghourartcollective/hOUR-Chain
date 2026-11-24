#!/usr/bin/env node
// GCUL settlement pilot runner (integration-testing only, test currency DEM).
//
// Usage (from the repository root):
//   node packages/gcul-adapter/scripts/pilot.mjs dry-run   # read-only: verify instruction, derive legs, read ledger
//   node packages/gcul-adapter/scripts/pilot.mjs live      # SUBMITS: approve, settle each leg, reconcile, emit receipts
//   node packages/gcul-adapter/scripts/pilot.mjs replay    # SUBMITS (expected to fail with no funds moved):
//                                                          # same instruction again, then with a lost (empty) leg table
//
// The contribution, agreement, obligation and approval records are SIMULATED
// pilot fixtures: the real time-contribution workflow does not exist yet. The
// instruction is signed with a pilot ML-DSA-65 key generated once and kept in
// the state directory. Evidence for every run is written to that directory.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import {
  generateTestKeyPair, signEnvelope, exportPublicKey, exportPrivateKey, importPublicKey, importPrivateKey,
} from '../../pqc-profile/src/index.mjs';
import { GculSettlementAdapter, LegStore, UlCliLedger, payloadHash, deriveSettlementId } from '../src/index.mjs';

const MODE = process.argv[2];
const STATE_DIR = process.env.GCUL_PILOT_DIR ?? join(process.env.HOME, '.local/state/hour-gcul-pilot');
const UL_CLI = `${process.env.HOME}/bin/ul-cli`;
const OPERATOR = 'hour_chain_owner';
const CONTRACT_ALIAS = 'hour_settlement_v2';
const CONTRACT_ID = '1:CTR:005788bGkaVpczkhPsWCfVfToTxywz15AiZG5fVD1f769';
const PAYEE = '1:USR:DEM:022nXHgAmjMB8mXkdDcqA3HaR9D8EyXD6vAj6urJ7qJ68';
const PAYEE_ALIAS = 'hour_chain_user2';
const SIGNER = 'hour:pilot-operator#k1';
const EVENT_ID = 'evt-pilot-20261124-instruction-0001';

const SIMULATED_APPROVED = new Set([
  'contrib-pilot-0001@1', 'agree-pilot-0001@1', 'evt-pilot-20261124-obligation-0001', 'evt-pilot-20261124-approval-0001',
]);

if (!['dry-run', 'live', 'replay'].includes(MODE)) {
  console.error('usage: pilot.mjs dry-run | live | replay');
  process.exit(2);
}
mkdirSync(STATE_DIR, { recursive: true });

const keys = loadOrCreateKeys();
const instruction = buildInstruction();
const ledger = new UlCliLedger({ bin: UL_CLI, querySender: OPERATOR, payeeAliases: { [PAYEE]: PAYEE_ALIAS } });
const adapterFor = (storePath, workerId) => new GculSettlementAdapter({
  store: new LegStore(storePath), ledger, operator: OPERATOR, contractAlias: CONTRACT_ALIAS, contractId: CONTRACT_ID,
  currency: 'DEM', resolveKey: (s) => (s === SIGNER ? keys.publicKey : null), isApproved: (r) => SIMULATED_APPROVED.has(r), workerId,
  instructionSigners: ['hour:pilot-operator'],
  // Pilot only: the simulated obligation's legs are the ones this script defines. Real use derives them from the
  // registry (time-contributions expectedLegs) so the instruction cannot choose its own payee or amount.
  expectedLegs: (p) => (p.obligationRef === 'evt-pilot-20261124-obligation-0001' ? PILOT_LEGS : null),
});
const evidence = { mode: MODE, startedAt: new Date().toISOString(), simulatedRecords: [...SIMULATED_APPROVED], instruction,
  signerPublicKey: exportPublicKey(keys.publicKey), steps: [] };
const step = (name, data) => { evidence.steps.push({ name, at: new Date().toISOString(), ...data }); console.log(`\n## ${name}\n${JSON.stringify(data, null, 2)}`); };

try {
  const balancesBefore = await balances();
  step('balances before', balancesBefore);
  const adapter = adapterFor(join(STATE_DIR, 'legs.db'), 'pilot-main');

  if (MODE === 'dry-run') {
    step('simulate (read-only)', await adapter.simulate(instruction));
  }

  if (MODE === 'live') {
    step('approve', { legs: (await adapter.approve(instruction)).map(brief) });
    for (const leg of adapter.store.list({ state: 'APPROVED' })) {
      step(`submit leg ${leg.legIndex}`, brief(await adapter.submit(leg.settlementId)));
    }
    const after = await balances();
    step('balances after', after);
    const report = await adapter.reconcile({ instructions: [instruction], runId: `recon-pilot-${Date.now()}`,
      balances: { before: balancesBefore[OPERATOR], after: after[OPERATOR] },
      knownPreAdapter: ['hst1_test_0001'] }); // hand-run contract v2 test, 2026-11-23
    step('reconcile', report);
    step('leg history', Object.fromEntries(adapter.store.list().map((l) => [l.settlementId, adapter.store.history(l.settlementId)])));
  }

  if (MODE === 'replay') {
    // 1. Same instruction, same leg table: approve is a no-op and submit is refused locally; no transaction.
    step('replay approve (same table)', { legs: (await adapter.approve(instruction)).map(brief) });
    for (const leg of adapter.store.list()) {
      try { await adapter.submit(leg.settlementId); step(`replay submit leg ${leg.legIndex}`, { unexpected: 'submitted' }); }
      catch (e) { step(`replay submit leg ${leg.legIndex} (same table)`, { refusedLocally: e.message }); }
    }
    // 2. Lost leg table: a fresh empty table knows nothing, so the adapter submits;
    //    contract v2 must reject each leg as a duplicate with no funds moved.
    const lostPath = join(STATE_DIR, `legs-lost-${Date.now()}.db`);
    const fresh = adapterFor(lostPath, 'pilot-lost-db');
    step('simulate with lost table', await fresh.simulate(instruction));
    await fresh.approve(instruction);
    for (const leg of fresh.store.list({ state: 'APPROVED' })) {
      step(`resubmit leg ${leg.legIndex} (lost table)`, brief(await fresh.submit(leg.settlementId)));
    }
    step('balances after replay', await balances());
  }
} catch (error) {
  step('error', { message: error.message });
  process.exitCode = 1;
} finally {
  const file = join(STATE_DIR, `evidence-${MODE}-${evidence.startedAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(evidence, null, 2));
  console.log(`\nEvidence written to ${file}`);
}

function brief(leg) {
  return { settlementId: leg.settlementId, legIndex: leg.legIndex, state: leg.state, amountMinor: leg.amountMinor,
    attempts: leg.attempts, txRef: leg.txRef, networkRound: leg.networkRound, lastError: leg.lastError };
}

const PILOT_LEGS = [{ legIndex: 0, payee: PAYEE, amountMinor: 40 }, { legIndex: 1, payee: PAYEE, amountMinor: 60 }];

function buildInstruction() {
  const payload = {
    network: 'gcul',
    currency: 'DEM',
    contributionRef: 'contrib-pilot-0001@1',
    agreementRef: 'agree-pilot-0001@1',
    obligationRef: 'evt-pilot-20261124-obligation-0001',
    legs: PILOT_LEGS,
    approvals: ['evt-pilot-20261124-approval-0001'],
  };
  const path = join(STATE_DIR, 'instruction.json');
  if (existsSync(path)) {
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    if (payloadHash(saved.payload) !== payloadHash(payload)) throw new Error('saved instruction differs from this script');
    return saved; // reuse the exact signed event, so replays use the same eventId and signature
  }
  const envelope = signEnvelope({
    eventId: EVENT_ID, protocolVersion: '0.2', schemaVersion: '1', eventType: 'settlement.instruction',
    actor: 'hour:pilot-operator', subject: 'contrib-pilot-0001', issuedAt: new Date().toISOString(),
    payloadHash: payloadHash(payload), network: 'gcul',
  }, keys.privateKey, { signer: SIGNER });
  const signed = { envelope, payload };
  writeFileSync(path, JSON.stringify(signed, null, 2));
  return signed;
}

function loadOrCreateKeys() {
  const path = join(STATE_DIR, 'pilot-signer.json');
  if (existsSync(path)) {
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    return { publicKey: importPublicKey(saved.publicKey), privateKey: importPrivateKey(saved.privateKey) };
  }
  const pair = generateTestKeyPair();
  writeFileSync(path, JSON.stringify({ publicKey: exportPublicKey(pair.publicKey), privateKey: exportPrivateKey(pair.privateKey) }), { mode: 0o600 });
  return pair;
}

async function balances() {
  const out = {};
  for (const alias of [OPERATOR, PAYEE_ALIAS]) {
    const text = await new Promise((resolve, reject) => execFile(UL_CLI,
      ['--timeout', '90s', 'accounts', 'describe', '--alias', alias, '--sender', alias], { cwd: process.env.HOME },
      (err, stdout, stderr) => (err ? reject(new Error(`${alias}: ${stderr || err.message}`)) : resolve(stdout + stderr))));
    const m = text.match(/Balance:\s*(\d+)/);
    if (!m) throw new Error(`no balance for ${alias}`);
    out[alias] = Number(m[1]);
  }
  out[PAYEE] = out[PAYEE_ALIAS];
  return out;
}

export { deriveSettlementId };

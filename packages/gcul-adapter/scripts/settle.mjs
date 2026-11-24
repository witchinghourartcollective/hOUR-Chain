#!/usr/bin/env node
// Settles a real settlement instruction (made with `hour-time instruction`) on
// GCUL through contract v2, then reconciles it. Dry run by default.
//
//   node packages/gcul-adapter/scripts/settle.mjs --instruction FILE --operator-home DIR --payees FILE [--live]
//
//   --instruction FILE   signed settlement.instruction from `hour-time instruction`
//   --operator-home DIR  the operator's $HOUR_HOME: store, operators, trusted keys, anchor
//   --payees FILE        JSON mapping payee identities to GCUL accounts and local ul-cli aliases:
//                        { "fletcher": { "account": "1:USR:DEM:...", "alias": "hour_chain_user2" } }
//   --live               actually submit; without it nothing is sent
//   --retry-failed       explicitly retry FAILED legs with their original settlement IDs
//   --recover-submitting recover abandoned SUBMITTING legs after confirming their workers stopped
//   --state-dir DIR      leg table and evidence (default ~/.local/state/hour-gcul)
//   --ledger fake --fake-ledger-state FILE   offline testing only
//
// The adapter accepts the instruction only if an operator signed it, its
// obligation and approvals are still approved in the registry, and its single
// leg pays exactly the obligation's amount to the account mapped for the
// obligation's payee. Each leg is paid at most once, across runs.
import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { DurableRegistry, readProfile, expectedLegs } from '../../time-contributions/src/index.mjs';
import { GculSettlementAdapter, LegStore, UlCliLedger, FakeLedger } from '../src/index.mjs';

const OPERATOR_ALIAS = 'hour_chain_owner';
const CONTRACT_ALIAS = 'hour_settlement_v2';
const CONTRACT_ID = '1:CTR:005788bGkaVpczkhPsWCfVfToTxywz15AiZG5fVD1f769';
// Receipts written to this contract before this runner existed (hand-run v2
// test 2026-11-23, simulated pilot 2026-11-24). Reported as known, not orphans.
const KNOWN_PRE_RUNNER = [
  'hst1_test_0001',
  'hst1_7807e6322b780852d444266a57a540c2a8cb6719',
  'hst1_736e9bf16059ef4f5d7aceca25e60d4165f52da5',
];

const fail = (m) => { console.error(`settle: ${m}`); process.exit(1); };
let args;
try {
  args = parseArgs({ options: {
    instruction: { type: 'string' }, 'operator-home': { type: 'string' }, payees: { type: 'string' }, live: { type: 'boolean' },
    'state-dir': { type: 'string' }, ledger: { type: 'string' }, 'fake-ledger-state': { type: 'string' },
    'retry-failed': { type: 'boolean' }, 'recover-submitting': { type: 'boolean' },
  } }).values;
} catch (e) { fail(e.message); }
for (const k of ['instruction', 'operator-home', 'payees']) if (!args[k]) fail(`--${k} is required`);

const instruction = JSON.parse(readFileSync(args.instruction, 'utf8'));
const payees = JSON.parse(readFileSync(args.payees, 'utf8'));
const profile = readProfile(args['operator-home']);
if (!profile.store) fail('operator profile has no store');
if (!profile.operators.includes(profile.identity)) fail(`${profile.identity} is not an operator in its own profile`);
const stateDir = args['state-dir'] ?? join(homedir(), '.local/state/hour-gcul');
mkdirSync(join(stateDir, 'settlements'), { recursive: true });

const fake = args.ledger === 'fake';
if (args.ledger && !fake) fail('--ledger only accepts "fake"');
const ledger = fake ? loadFakeLedger(args['fake-ledger-state']) : new UlCliLedger({
  querySender: OPERATOR_ALIAS,
  payeeAliases: Object.fromEntries(Object.values(payees).map((p) => [p.account, p.alias])),
});
const registry = new DurableRegistry(profile.store, {
  resolveKey: profile.resolveKey, operators: profile.operators, ...(profile.anchor ? { expectedHead: profile.anchor } : {}),
});
const adapter = new GculSettlementAdapter({
  store: new LegStore(join(stateDir, fake ? 'settlement-legs-fake.db' : 'settlement-legs.db')),
  ledger, operator: OPERATOR_ALIAS, contractAlias: CONTRACT_ALIAS, contractId: CONTRACT_ID,
  currency: 'DEM',
  resolveKey: profile.resolveOperatorKey,
  isApproved: (ref) => registry.isApproved(ref),
  instructionSigners: profile.operators,
  expectedLegs: expectedLegs(registry, { payeeAccount: (id) => payees[id]?.account ?? null }),
  workerId: `settle-${process.pid}`,
});

const evidence = { mode: args.live ? 'live' : 'dry-run', ledger: fake ? 'fake' : 'gcul integration-testing', at: new Date().toISOString(),
  instructionEventId: instruction.envelope?.eventId, registryHead: registry.head(), steps: [] };
const step = (name, data) => { evidence.steps.push({ name, ...data }); console.log(`\n## ${name}\n${JSON.stringify(data, null, 2)}`); };

try {
  step('balance before', { operator: await operatorBalance() });
  const plan = await adapter.simulate(instruction); // full verification, read-only
  if (!fake) for (const { payee } of plan.legs) await ledger.verifyPayee(payee);
  step('verified plan', { legs: plan.legs.map(({ settlementId, payee, amountMinor, alreadyOnLedger }) => ({ settlementId, payee, amountMinor, alreadyOnLedger })) });
  if (!args.live) {
    console.log('\nDry run only: nothing was submitted. Re-run with --live to pay.');
  } else {
    await adapter.approve(instruction);
    for (const { settlementId } of plan.legs) {
      let leg = adapter.store.get(settlementId);
      if (leg.state === 'UNKNOWN' || (leg.state === 'SUBMITTING' && args['recover-submitting']) ||
          (leg.state === 'FAILED' && args['retry-failed'])) {
        adapter.store.acquireLease(settlementId, adapter.workerId, adapter.leaseMs);
        try {
          leg = adapter.store.get(settlementId);
          if (leg.state === 'SUBMITTING' && args['recover-submitting']) {
            leg = adapter.store.transition(settlementId, 'UNKNOWN', { lastError: 'abandoned submission; operator confirmed worker stopped' });
          }
          if (leg.state === 'UNKNOWN') leg = await adapter.resolveUnknown(settlementId);
          if (leg.state === 'FAILED' && args['retry-failed']) leg = adapter.retry(settlementId);
        } finally {
          adapter.store.releaseLease(settlementId, adapter.workerId);
        }
      }
      if (leg.state !== 'APPROVED') { step(`leg ${leg.legIndex}`, { state: leg.state, note: 'not submitted' }); continue; }
      if (!fake) await ledger.verifyPayee(leg.payee);
      const r = await adapter.submit(settlementId);
      step(`leg ${r.legIndex}`, { state: r.state, txRef: r.txRef, round: r.networkRound, lastError: r.lastError });
    }
    const after = await operatorBalance();
    step('balance after', { operator: after });
    const report = await adapter.reconcile({ instructions: [instruction], runId: `recon-${Date.now()}`, knownPreAdapter: KNOWN_PRE_RUNNER });
    step('reconcile', report);
    const requested = new Set(plan.legs.map(({ settlementId }) => settlementId));
    if (plan.legs.some(({ settlementId }) => adapter.store.get(settlementId)?.state !== 'RECONCILED') ||
        report.findings.some(({ settlementId, kind }) => requested.has(settlementId) && kind !== 'known-pre-adapter')) {
      process.exitCode = 1;
    }
  }
} catch (error) {
  step('error', { message: error.message });
  process.exitCode = 1;
} finally {
  if (fake) saveFakeLedger(ledger, args['fake-ledger-state']);
  const file = join(stateDir, 'settlements', `${evidence.mode}-${evidence.at.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(evidence, null, 2));
  console.log(`\nEvidence written to ${file}`);
  registry.close();
}

async function operatorBalance() {
  if (fake) return ledger.balances[OPERATOR_ALIAS] ?? 0;
  const out = await new Promise((resolve, reject) => execFile(`${homedir()}/bin/ul-cli`,
    ['--timeout', '90s', 'accounts', 'describe', '--alias', OPERATOR_ALIAS, '--sender', OPERATOR_ALIAS], { cwd: homedir() },
    (e, so, se) => (e ? reject(new Error(se || e.message)) : resolve(so + se))));
  const m = out.match(/Balance:\s*(\d+)/);
  if (!m) throw new Error('could not read operator balance');
  return Number(m[1]);
}

function loadFakeLedger(path) {
  if (!path) fail('--fake-ledger-state is required with --ledger fake');
  const ledger = new FakeLedger({ operator: OPERATOR_ALIAS, balances: { [OPERATOR_ALIAS]: 1_000_000 } });
  ledger.deploy(CONTRACT_ALIAS);
  if (existsSync(path)) {
    const s = JSON.parse(readFileSync(path, 'utf8'));
    ledger.balances = s.balances;
    for (const r of s.receipts) ledger.injectReceipt(CONTRACT_ALIAS, r);
    ledger.settleCalls = s.settleCalls;
    ledger.txCount = s.txCount;
  }
  return ledger;
}

function saveFakeLedger(ledger, path) {
  writeFileSync(path, JSON.stringify({ balances: ledger.balances, receipts: [...ledger.contracts.get(CONTRACT_ALIAS).values()],
    settleCalls: ledger.settleCalls, txCount: ledger.txCount }, null, 2));
}

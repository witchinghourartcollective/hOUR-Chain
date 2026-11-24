#!/usr/bin/env node
// hour-time: command-line client for the real-hours contribution workflow.
//
// Each person keeps a profile in $HOUR_HOME (default ~/.hour): their ML-DSA-65
// signing key, the public keys they trust, and the shared store path.
// Every write command signs an event with the profile's key and appends it to
// the store, or, with --out FILE, only writes the signed event so it can be sent
// to whoever holds the store, who adds it with `append FILE`.
//
// Run `hour-time help` for commands.
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { generateTestKeyPair, signEnvelope, exportPublicKey, exportPrivateKey, importPublicKey, importPrivateKey } from '../../pqc-profile/src/index.mjs';
import { DurableRegistry, payloadHash, calculateObligation, buildSettlementInstruction, STATUS } from '../src/index.mjs';

const HOME = resolve(process.env.HOUR_HOME ?? join(homedir(), '.hour'));
const PROFILE = join(HOME, 'profile.json');
const KEY = join(HOME, 'signing-key.json');
const TRUSTED = join(HOME, 'trusted-keys.json');

const HELP = `hour-time — real-hours contribution workflow (docs/TIME-CONTRIBUTIONS.md)

Profile ($HOUR_HOME, default ~/.hour)
  keygen --identity ID                   create your ML-DSA-65 key; prints your public key to share
  trust --identity ID --public-key KEY   trust a collaborator's public key
  config --store PATH --operators A,B    set the shared store and operator identities
  whoami                                 show identity, public key, store

Records (signed with your key; --out FILE signs without appending)
  claim --contribution-id ID --work ID --role R --activity A --duration 2h30m
        [--start ISO --end ISO --timezone TZ] [--evidence ref,ref] --reviewers ID,ID [--amends]
  review --contribution-id ID --version N (--approve | --dispute --reason TEXT)
  propose-agreement --agreement-id ID --work ID --contribution-id ID --payee ID --parties ID,ID
        --currency CUR --terms-ref REF (--fee N | --rate-per-hour N | --share-bps N) [--amends]
  review-agreement --agreement-id ID --version N (--approve | --dispute --reason TEXT)
  report-revenue --revenue-id ID --work ID --amount N --currency CUR --period-start ISO --period-end ISO [--statement-ref REF]
  obligation --obligation-id ID --contribution-ref ID@N --agreement-ref ID@N [--revenue-ref ID]
  append FILE                            verify and append a signed event someone sent you

Settlement and audit
  instruction --obligation EVENT_ID --payee-account ACCOUNT [--network gcul] [--currency CUR] --out FILE
  status [--contribution-id ID | --agreement-id ID]
  head                                   current {seq, hash}; record it somewhere independent to anchor history
`;

const fail = (message) => { console.error(`hour-time: ${message}`); process.exit(1); };
const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback);
const list = (value) => (value ? String(value).split(',').map((s) => s.trim()).filter(Boolean) : []);

function writePrivate(path, data) {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}

function profile() {
  const p = readJson(PROFILE, null);
  if (!p?.identity) fail(`no profile in ${HOME}; run: hour-time keygen --identity YOUR_ID`);
  return p;
}

function trustedKeys() {
  const p = profile();
  const keys = { ...readJson(TRUSTED, {}) };
  keys[p.identity] = readJson(KEY, null)?.publicKey; // always trust yourself
  return keys;
}

function openStore(extra = {}) {
  const p = profile();
  if (!p.store) fail('no store configured; run: hour-time config --store PATH --operators ID,ID');
  const keys = trustedKeys();
  mkdirSync(dirname(p.store), { recursive: true });
  return new DurableRegistry(p.store, {
    resolveKey: (signer) => { const k = keys[String(signer).split('#')[0]]; return k ? importPublicKey(k) : null; },
    operators: p.operators ?? [],
    ...extra,
  });
}

function parseDuration(text) {
  const s = String(text).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(s);
  if (!m || !s) fail(`cannot read duration "${text}"; use seconds or e.g. 2h30m`);
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

function sign(eventType, payload, subject, { network } = {}) {
  const p = profile();
  const key = readJson(KEY, null);
  if (!key) fail('no signing key; run keygen');
  const envelope = {
    eventId: `evt-${eventType.replace('.', '-')}-${randomUUID()}`,
    protocolVersion: '0.2', schemaVersion: '1', eventType, actor: p.identity, subject,
    issuedAt: new Date().toISOString(), payloadHash: payloadHash(payload),
  };
  if (network) envelope.network = network;
  return { envelope: signEnvelope(envelope, importPrivateKey(key.privateKey), { signer: `${p.identity}#k1` }), payload };
}

function deliver(event, out) {
  if (out) {
    writeFileSync(out, JSON.stringify(event, null, 2));
    console.log(`signed ${event.envelope.eventType} ${event.envelope.eventId} -> ${out}`);
    return;
  }
  const store = openStore();
  try {
    const r = store.append(event);
    console.log(`appended ${r.type} ${r.eventId} (seq ${r.seq})`);
  } finally {
    store.close();
  }
}

function decision(v) {
  if (v.approve && v.dispute) fail('choose --approve or --dispute, not both');
  if (!v.approve && !v.dispute) fail('choose --approve or --dispute');
  return v.approve ? { decision: 'approve' } : { decision: 'dispute', reason: v.reason ?? '' };
}

function currentEventId(store, kind, id) {
  const record = kind === 'agreement' ? store.agreement(id) : store.contribution(id);
  if (!record) fail(`no ${kind} ${id} to amend`);
  return record;
}

const OPTIONS = {
  identity: { type: 'string' }, 'public-key': { type: 'string' }, store: { type: 'string' }, operators: { type: 'string' },
  'contribution-id': { type: 'string' }, work: { type: 'string' }, role: { type: 'string' }, activity: { type: 'string' },
  duration: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, timezone: { type: 'string' },
  evidence: { type: 'string' }, reviewers: { type: 'string' }, amends: { type: 'boolean' },
  version: { type: 'string' }, approve: { type: 'boolean' }, dispute: { type: 'boolean' }, reason: { type: 'string' },
  'agreement-id': { type: 'string' }, payee: { type: 'string' }, parties: { type: 'string' }, currency: { type: 'string' },
  'terms-ref': { type: 'string' }, fee: { type: 'string' }, 'rate-per-hour': { type: 'string' }, 'share-bps': { type: 'string' },
  'revenue-id': { type: 'string' }, amount: { type: 'string' }, 'period-start': { type: 'string' }, 'period-end': { type: 'string' },
  'statement-ref': { type: 'string' }, 'obligation-id': { type: 'string' }, 'contribution-ref': { type: 'string' },
  'agreement-ref': { type: 'string' }, 'revenue-ref': { type: 'string' }, obligation: { type: 'string' },
  'payee-account': { type: 'string' }, network: { type: 'string' }, out: { type: 'string' },
};

const need = (v, ...names) => { for (const n of names) if (v[n] === undefined || v[n] === '') fail(`--${n} is required`); };
const int = (v, name) => { const n = Number(v[name]); if (!Number.isSafeInteger(n)) fail(`--${name} must be an integer`); return n; };

const COMMANDS = {
  help() { console.log(HELP); },

  keygen(v) {
    need(v, 'identity');
    if (existsSync(KEY)) fail(`${KEY} already exists; refusing to overwrite a signing key`);
    const pair = generateTestKeyPair();
    writePrivate(KEY, { algorithm: 'ML-DSA-65', publicKey: exportPublicKey(pair.publicKey), privateKey: exportPrivateKey(pair.privateKey) });
    writePrivate(PROFILE, { ...readJson(PROFILE, {}), identity: v.identity });
    console.log(`identity: ${v.identity}\npublic key (share this):\n${exportPublicKey(pair.publicKey)}`);
  },

  trust(v) {
    need(v, 'identity', 'public-key');
    try { importPublicKey(v['public-key']); } catch { fail('not a valid public key'); }
    writePrivate(TRUSTED, { ...readJson(TRUSTED, {}), [v.identity]: v['public-key'] });
    console.log(`trusting ${v.identity}`);
  },

  config(v) {
    const p = profile();
    writePrivate(PROFILE, { ...p, ...(v.store ? { store: resolve(v.store) } : {}), ...(v.operators ? { operators: list(v.operators) } : {}) });
    console.log(JSON.stringify(readJson(PROFILE, {}), null, 2));
  },

  whoami() {
    const p = profile();
    console.log(JSON.stringify({ identity: p.identity, store: p.store ?? null, operators: p.operators ?? [],
      publicKey: readJson(KEY, null)?.publicKey, trusted: Object.keys(readJson(TRUSTED, {})) }, null, 2));
  },

  claim(v) {
    need(v, 'contribution-id', 'work', 'role', 'activity', 'duration', 'reviewers');
    const payload = {
      contributionId: v['contribution-id'], version: 1, workRef: v.work, contributor: profile().identity,
      role: v.role, activity: v.activity, durationSeconds: parseDuration(v.duration),
      evidenceRefs: list(v.evidence), reviewers: list(v.reviewers),
    };
    if (v.start || v.end) { need(v, 'start', 'end'); payload.startAt = v.start; payload.endAt = v.end; }
    if (v.timezone) payload.timezone = v.timezone;
    if (v.amends) {
      const store = openStore();
      const current = currentEventId(store, 'contribution', payload.contributionId);
      store.close();
      payload.version = current.version + 1;
      payload.amends = current.eventId;
    }
    deliver(sign('contribution.claimed', payload, payload.contributionId), v.out);
  },

  review(v) {
    need(v, 'contribution-id', 'version');
    const payload = { contributionId: v['contribution-id'], version: int(v, 'version'), ...decision(v) };
    deliver(sign('contribution.reviewed', payload, payload.contributionId), v.out);
  },

  'propose-agreement'(v) {
    need(v, 'agreement-id', 'work', 'contribution-id', 'payee', 'parties', 'currency', 'terms-ref');
    const bases = [['fee', 'fixed_fee', 'feeMinor'], ['rate-per-hour', 'hourly_rate', 'rateMinorPerHour'], ['share-bps', 'revenue_share', 'shareBps']]
      .filter(([flag]) => v[flag] !== undefined);
    if (bases.length !== 1) fail('give exactly one of --fee, --rate-per-hour, --share-bps');
    const [[flag, basis, field]] = bases;
    const payload = {
      agreementId: v['agreement-id'], version: 1, workRef: v.work, contributionId: v['contribution-id'], payee: v.payee,
      parties: list(v.parties), currency: v.currency, basis, [field]: int(v, flag), termsRef: v['terms-ref'],
    };
    if (v.amends) {
      const store = openStore();
      const current = currentEventId(store, 'agreement', payload.agreementId);
      store.close();
      payload.version = current.version + 1;
      payload.amends = current.eventId;
    }
    deliver(sign('agreement.proposed', payload, payload.agreementId), v.out);
  },

  'review-agreement'(v) {
    need(v, 'agreement-id', 'version');
    const payload = { agreementId: v['agreement-id'], version: int(v, 'version'), ...decision(v) };
    deliver(sign('agreement.reviewed', payload, payload.agreementId), v.out);
  },

  'report-revenue'(v) {
    need(v, 'revenue-id', 'work', 'amount', 'currency', 'period-start', 'period-end');
    const payload = { revenueId: v['revenue-id'], workRef: v.work, amountMinor: int(v, 'amount'), currency: v.currency,
      periodStart: v['period-start'], periodEnd: v['period-end'] };
    if (v['statement-ref']) payload.statementRef = v['statement-ref'];
    deliver(sign('revenue.reported', payload, payload.revenueId), v.out);
  },

  // Computes the amount from the stored agreement, so operators never type it.
  obligation(v) {
    need(v, 'obligation-id', 'contribution-ref', 'agreement-ref');
    const store = openStore();
    try {
      const [cId, cVer] = splitRef(v['contribution-ref']);
      const [aId, aVer] = splitRef(v['agreement-ref']);
      const contribution = store.contribution(cId, cVer);
      const agreement = store.agreement(aId, aVer);
      if (!contribution || !agreement) fail('unknown contribution or agreement reference');
      const revenue = v['revenue-ref'] ? store.revenue(v['revenue-ref'])?.payload : undefined;
      const result = calculateObligation({ agreement: agreement.payload, contribution: contribution.payload, revenue });
      const payload = { obligationId: v['obligation-id'], contributionRef: v['contribution-ref'], agreementRef: v['agreement-ref'],
        payee: agreement.payload.payee, currency: agreement.payload.currency, ...result };
      if (v['revenue-ref']) payload.revenueRef = v['revenue-ref'];
      console.log(`amount: ${result.amountMinor} ${payload.currency} (${result.calculation.formula})`);
      const event = sign('obligation.calculated', payload, payload.obligationId);
      if (v.out) return deliver(event, v.out);
      const r = store.append(event);
      console.log(`appended ${r.type} ${r.eventId} (seq ${r.seq})`);
    } finally {
      store.close();
    }
  },

  append(v, positionals) {
    const file = positionals[0];
    if (!file) fail('usage: hour-time append FILE');
    deliver(JSON.parse(readFileSync(file, 'utf8')));
  },

  instruction(v) {
    need(v, 'obligation', 'payee-account', 'out');
    const store = openStore();
    try {
      const payload = buildSettlementInstruction(store, v.obligation, {
        network: v.network ?? 'gcul', currency: v.currency, payeeAccount: () => v['payee-account'],
      });
      const event = sign('settlement.instruction', payload, payload.contributionRef, { network: payload.network });
      writeFileSync(v.out, JSON.stringify(event, null, 2));
      console.log(`signed settlement.instruction ${event.envelope.eventId} for ${payload.legs[0].amountMinor} ${payload.currency} -> ${v.out}`);
    } finally {
      store.close();
    }
  },

  status(v) {
    const store = openStore();
    try {
      const show = (kind, id) => {
        const versions = [];
        for (let n = 1; ; n += 1) {
          const r = kind === 'agreement' ? store.agreement(id, n) : store.contribution(id, n);
          if (!r) break;
          versions.push({ version: r.version, status: r.status, eventId: r.eventId,
            reviews: Object.fromEntries([...r.reviews].map(([who, x]) => [who, x.reason ? `${x.decision}: ${x.reason}` : x.decision])) });
        }
        return versions;
      };
      if (v['contribution-id']) return console.log(JSON.stringify(show('contribution', v['contribution-id']), null, 2));
      if (v['agreement-id']) return console.log(JSON.stringify(show('agreement', v['agreement-id']), null, 2));
      const counts = {};
      for (const e of store.log) counts[e.envelope.eventType] = (counts[e.envelope.eventType] ?? 0) + 1;
      console.log(JSON.stringify({ store: profile().store, head: store.head(), events: counts }, null, 2));
    } finally {
      store.close();
    }
  },

  head() {
    const store = openStore();
    try { console.log(JSON.stringify(store.head())); } finally { store.close(); }
  },
};

function splitRef(ref) {
  const at = String(ref).lastIndexOf('@');
  if (at < 1) fail(`reference "${ref}" must look like ID@VERSION`);
  return [ref.slice(0, at), Number(ref.slice(at + 1))];
}

const [command = 'help', ...rest] = process.argv.slice(2);
if (!COMMANDS[command]) fail(`unknown command "${command}"; run: hour-time help`);
let parsed;
try {
  parsed = parseArgs({ args: rest, options: OPTIONS, allowPositionals: true, strict: true });
} catch (error) {
  fail(error.message);
}
try {
  COMMANDS[command](parsed.values, parsed.positionals);
} catch (error) {
  fail(error.message);
}



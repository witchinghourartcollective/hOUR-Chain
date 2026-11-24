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
  keygen --identity ID                   create your ML-DSA-65 key (key id k1); prints your public key to share
  keygen --rotate                        new key with the next key id; the old public key stays trusted for history
  trust --identity ID --public-key KEY [--key-id k1]   trust a collaborator's key; key ids are never overwritten
  config --store PATH --operators A,B [--anchor SEQ:HASH]   store, operators, and an independently recorded anchor
  whoami                                 show identity, public key, store

Records (signed with your key; --out FILE signs without appending)
  claim --contribution-id ID --work ID --role R --activity A --duration 2h30m
        [--start ISO --end ISO --timezone TZ] [--evidence ref,ref] --reviewers ID,ID
        [--amends [--amends-event EVENT_ID --amends-version N]]   (explicit target works offline with --out)
        AI disclosure (approved by reviewers with the claim):
        [--ai-tool "Google Flow" --ai-use TEXT --ai-output audio,lyrics [--ai-provider Google] [--ai-model Lyria]
         [--ai-evidence ref,ref]]  |  [--ai-json FILE]  |  [--no-ai]      (omitting all = not declared)
  review --contribution-id ID --version N (--approve | --dispute --reason TEXT)
  propose-agreement --agreement-id ID --work ID --contribution-id ID --payee ID --parties ID,ID
        --currency CUR --terms-ref REF (--fee N | --rate-per-hour N | --share-bps N) [--amends]
  review-agreement --agreement-id ID --version N (--approve | --dispute --reason TEXT)
  report-revenue --revenue-id ID --work ID --amount N --currency CUR --period-start ISO --period-end ISO [--statement-ref REF]
  obligation --obligation-id ID --contribution-ref ID@N --agreement-ref ID@N [--revenue-ref ID]
  append FILE                            verify and append a signed event someone sent you

Settlement and audit
  instruction --obligation EVENT_ID --payee-account ACCOUNT [--network gcul] [--currency CUR] --out FILE   (operators only)
  status [--contribution-id ID | --agreement-id ID]
  disclosure --work ID                   AI disclosure for a work across all contributors
  head [--record]                        current {seq, hash}; --record saves it as this profile's anchor
                                         (also keep a copy somewhere the store's host cannot rewrite)
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

// Signers are "identity#keyId". Keys are never replaced: a rotated key gets a
// new key id, and old public keys stay trusted so history keeps verifying.
function trustedKeys() {
  const p = profile();
  const keys = {};
  for (const [id, entry] of Object.entries(readJson(TRUSTED, {}))) {
    keys[id] = typeof entry === 'string' ? { k1: entry } : { ...entry }; // older profiles stored one key per identity
  }
  const own = readJson(KEY, null);
  keys[p.identity] = { ...(p.retiredKeys ?? {}), ...(own ? { [own.keyId ?? 'k1']: own.publicKey } : {}) };
  return keys;
}

function resolverFor(keys) {
  return (signer) => {
    const [id, keyId = 'k1'] = String(signer).split('#');
    const k = keys[id]?.[keyId];
    return k ? importPublicKey(k) : null;
  };
}

function openStore(extra = {}) {
  const p = profile();
  if (!p.store) fail('no store configured; run: hour-time config --store PATH --operators ID,ID');
  const keys = trustedKeys();
  mkdirSync(dirname(p.store), { recursive: true });
  return new DurableRegistry(p.store, {
    resolveKey: resolverFor(keys),
    operators: p.operators ?? [],
    ...(p.anchor ? { expectedHead: p.anchor } : {}),
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
  return { envelope: signEnvelope(envelope, importPrivateKey(key.privateKey), { signer: `${p.identity}#${key.keyId ?? 'k1'}` }), payload };
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

// AI disclosure from flags. undefined = not declared; [] = declared no AI use.
// One tool via --ai-tool/--ai-use/--ai-output (plus optional provider, model,
// evidence); more via --ai-json FILE holding an array of entries.
function aiAssistance(v) {
  const flagged = ['ai-tool', 'ai-provider', 'ai-model', 'ai-use', 'ai-output', 'ai-evidence'].some((k) => v[k] !== undefined);
  if (v['no-ai']) {
    if (flagged || v['ai-json']) fail('--no-ai cannot be combined with AI details');
    return [];
  }
  const entries = [];
  if (v['ai-json']) {
    const parsed = JSON.parse(readFileSync(v['ai-json'], 'utf8'));
    if (!Array.isArray(parsed)) fail('--ai-json must contain a JSON array of entries');
    entries.push(...parsed);
  }
  if (flagged) {
    need(v, 'ai-tool', 'ai-use', 'ai-output');
    const entry = { tool: v['ai-tool'], use: v['ai-use'], outputs: list(v['ai-output']) };
    if (v['ai-provider']) entry.provider = v['ai-provider'];
    if (v['ai-model']) entry.model = v['ai-model'];
    if (v['ai-evidence']) entry.evidenceRefs = list(v['ai-evidence']);
    entries.push(entry);
  }
  return entries.length ? entries : undefined;
}

// The version being amended: given explicitly (works offline, with --out), or
// looked up in the store.
function amendTarget(v, kind, id) {
  if (v['amends-event'] || v['amends-version']) {
    need(v, 'amends-event', 'amends-version');
    return { eventId: v['amends-event'], version: int(v, 'amends-version') };
  }
  const store = openStore();
  try {
    const record = kind === 'agreement' ? store.agreement(id) : store.contribution(id);
    if (!record) fail(`no ${kind} ${id} to amend`);
    return record;
  } finally {
    store.close();
  }
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
  rotate: { type: 'boolean' }, 'key-id': { type: 'string' }, anchor: { type: 'string' }, record: { type: 'boolean' },
  'amends-event': { type: 'string' }, 'amends-version': { type: 'string' },
  'ai-tool': { type: 'string' }, 'ai-provider': { type: 'string' }, 'ai-model': { type: 'string' }, 'ai-use': { type: 'string' },
  'ai-output': { type: 'string' }, 'ai-evidence': { type: 'string' }, 'ai-json': { type: 'string' }, 'no-ai': { type: 'boolean' },
};

const need = (v, ...names) => { for (const n of names) if (v[n] === undefined || v[n] === '') fail(`--${n} is required`); };
const int = (v, name) => { const n = Number(v[name]); if (!Number.isSafeInteger(n)) fail(`--${name} must be an integer`); return n; };

const COMMANDS = {
  help() { console.log(HELP); },

  keygen(v) {
    const existing = readJson(KEY, null);
    let keyId = 'k1';
    let p = readJson(PROFILE, {});
    if (v.rotate) {
      if (!existing) fail('nothing to rotate; run keygen --identity ID first');
      const oldId = existing.keyId ?? 'k1';
      keyId = `k${Number(oldId.slice(1)) + 1}`;
      p = { ...p, retiredKeys: { ...(p.retiredKeys ?? {}), [oldId]: existing.publicKey } }; // history keeps verifying
    } else {
      need(v, 'identity');
      if (existing) fail(`${KEY} already exists; refusing to overwrite a signing key (use --rotate)`);
      p = { ...p, identity: v.identity };
    }
    const pair = generateTestKeyPair();
    writePrivate(PROFILE, p);
    writePrivate(KEY, { algorithm: 'ML-DSA-65', keyId, publicKey: exportPublicKey(pair.publicKey), privateKey: exportPrivateKey(pair.privateKey) });
    console.log(`identity: ${p.identity}\nkey id: ${keyId}\npublic key (share this with its key id):\n${exportPublicKey(pair.publicKey)}`);
  },

  trust(v) {
    need(v, 'identity', 'public-key');
    try { importPublicKey(v['public-key']); } catch { fail('not a valid public key'); }
    const keyId = v['key-id'] ?? 'k1';
    if (!/^k[1-9][0-9]*$/.test(keyId)) fail('--key-id must look like k1, k2, ...');
    const all = readJson(TRUSTED, {});
    const entry = typeof all[v.identity] === 'string' ? { k1: all[v.identity] } : { ...(all[v.identity] ?? {}) };
    if (entry[keyId] && entry[keyId] !== v['public-key']) {
      fail(`${v.identity}#${keyId} is already trusted with a different key; key ids are permanent, so a new key needs a new --key-id`);
    }
    entry[keyId] = v['public-key'];
    writePrivate(TRUSTED, { ...all, [v.identity]: entry });
    console.log(`trusting ${v.identity}#${keyId}`);
  },

  config(v) {
    const p = profile();
    let anchor;
    if (v.anchor) {
      const m = /^(\d+):([0-9a-f]{64})$/.exec(v.anchor);
      if (!m) fail('--anchor must be SEQ:HASH as printed by `hour-time head`');
      anchor = { seq: Number(m[1]), hash: m[2] };
    }
    writePrivate(PROFILE, { ...p, ...(v.store ? { store: resolve(v.store) } : {}), ...(v.operators ? { operators: list(v.operators) } : {}),
      ...(anchor ? { anchor } : {}) });
    console.log(JSON.stringify(readJson(PROFILE, {}), null, 2));
  },

  whoami() {
    const p = profile();
    console.log(JSON.stringify({ identity: p.identity, store: p.store ?? null, operators: p.operators ?? [],
      keyId: readJson(KEY, null)?.keyId ?? 'k1', publicKey: readJson(KEY, null)?.publicKey, anchor: p.anchor ?? null,
      trusted: Object.fromEntries(Object.entries(trustedKeys()).map(([id, ks]) => [id, Object.keys(ks)])) }, null, 2));
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
    const ai = aiAssistance(v);
    if (ai !== undefined) payload.aiAssistance = ai;
    if (v.amends) {
      const current = amendTarget(v, 'contribution', payload.contributionId);
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
      const current = amendTarget(v, 'agreement', payload.agreementId);
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
    const me = profile();
    if (!(me.operators ?? []).includes(me.identity)) fail(`only operators may sign settlement instructions; ${me.identity} is not one`);
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
            ...(kind === 'contribution' ? { aiAssistance: r.payload.aiAssistance ?? 'not declared' } : {}),
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

  disclosure(v) {
    need(v, 'work');
    const store = openStore();
    try {
      const d = store.aiDisclosure(v.work);
      if (!d.contributions.length) fail(`no contributions for work ${v.work}`);
      const s = d.summary;
      console.log({
        yes: `AI used: yes (${s.tools.join(', ')}; outputs: ${s.outputs.join(', ')})`,
        no: 'AI used: no (every contribution declares no AI use)',
        unknown: 'AI used: unknown (no AI declared, but some contributions have not declared either way)',
      }[s.aiUsed]);
      if (s.undeclared.length) console.log(`not declared: ${s.undeclared.join(', ')}`);
      if (s.unapproved.length) console.log(`not yet approved by reviewers: ${s.unapproved.join(', ')}`);
      console.log(JSON.stringify(d, null, 2));
    } finally {
      store.close();
    }
  },

  head(v) {
    const store = openStore();
    try {
      const head = store.head();
      console.log(JSON.stringify(head));
      if (v.record) {
        writePrivate(PROFILE, { ...profile(), anchor: head });
        console.log('recorded as this profile\'s anchor; every later open must contain it');
      }
    } finally {
      store.close();
    }
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



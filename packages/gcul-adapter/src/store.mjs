// Durable leg table and state machine for the GCUL settlement adapter
// (ADR-0009 section 3). One row per settlement leg, keyed by its deterministic
// settlement ID. Every state change is written before the action it describes,
// so a crash at any point leaves a row that says what may have happened.
import { DatabaseSync } from 'node:sqlite';

export const STATES = Object.freeze({
  PLANNED: 'PLANNED',
  APPROVED: 'APPROVED',
  SUBMITTING: 'SUBMITTING',
  UNKNOWN: 'UNKNOWN',
  CONFIRMED: 'CONFIRMED',
  REJECTED_DUPLICATE: 'REJECTED_DUPLICATE',
  FAILED: 'FAILED',
  RECONCILED: 'RECONCILED',
  DISPUTED: 'DISPUTED',
  CANCELLED: 'CANCELLED',
});

const S = STATES;

// ADR-0009 section 3, "Allowed next".
export const TRANSITIONS = Object.freeze({
  [S.PLANNED]: [S.APPROVED, S.CANCELLED],
  [S.APPROVED]: [S.SUBMITTING, S.CANCELLED],
  [S.SUBMITTING]: [S.CONFIRMED, S.REJECTED_DUPLICATE, S.FAILED, S.UNKNOWN],
  [S.UNKNOWN]: [S.CONFIRMED, S.FAILED],
  [S.CONFIRMED]: [S.RECONCILED, S.DISPUTED],
  [S.REJECTED_DUPLICATE]: [S.CONFIRMED, S.DISPUTED],
  [S.FAILED]: [S.APPROVED],
  [S.RECONCILED]: [],
  [S.DISPUTED]: [],
  [S.CANCELLED]: [],
});

export class TransitionError extends Error {}
export class LeaseError extends Error {}

const LEG_COLUMNS = [
  'settlement_id', 'instruction_event_id', 'leg_index', 'contract_alias', 'network', 'currency',
  'contribution_ref', 'agreement_ref', 'payee', 'amount_minor', 'state', 'attempts',
  'tx_ref', 'network_round', 'last_error', 'lease_owner', 'lease_expires_at', 'created_at', 'updated_at',
];

export class LegStore {
  constructor(path = ':memory:', { now = () => Date.now() } = {}) {
    this.db = new DatabaseSync(path);
    this.now = now;
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS legs (
        settlement_id TEXT PRIMARY KEY,
        instruction_event_id TEXT NOT NULL,
        leg_index INTEGER NOT NULL,
        contract_alias TEXT NOT NULL,
        network TEXT NOT NULL,
        currency TEXT NOT NULL,
        contribution_ref TEXT NOT NULL,
        agreement_ref TEXT NOT NULL,
        payee TEXT NOT NULL,
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        state TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        tx_ref TEXT,
        network_round INTEGER,
        last_error TEXT,
        lease_owner TEXT,
        lease_expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (instruction_event_id, leg_index)
      );
      CREATE TABLE IF NOT EXISTS leg_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        settlement_id TEXT NOT NULL REFERENCES legs(settlement_id),
        from_state TEXT,
        to_state TEXT NOT NULL,
        detail TEXT,
        at INTEGER NOT NULL
      );
    `);
  }

  close() {
    this.db.close();
  }

  // Inserts a leg in PLANNED. Re-planning the same leg is a no-op that returns
  // the existing row, so replaying an instruction never duplicates a leg.
  plan(leg) {
    const existing = this.get(leg.settlementId);
    if (existing) return existing;
    const t = this.now();
    this.db.prepare(`INSERT INTO legs (settlement_id, instruction_event_id, leg_index, contract_alias, network,
        currency, contribution_ref, agreement_ref, payee, amount_minor, state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      leg.settlementId, leg.instructionEventId, leg.legIndex, leg.contractAlias, leg.network, leg.currency,
      leg.contributionRef, leg.agreementRef, leg.payee, leg.amountMinor, S.PLANNED, t, t);
    this.#log(leg.settlementId, null, S.PLANNED, null, t);
    return this.get(leg.settlementId);
  }

  get(settlementId) {
    const row = this.db.prepare('SELECT * FROM legs WHERE settlement_id = ?').get(settlementId);
    return row ? toLeg(row) : null;
  }

  list({ state } = {}) {
    const rows = state
      ? this.db.prepare('SELECT * FROM legs WHERE state = ? ORDER BY created_at, settlement_id').all(state)
      : this.db.prepare('SELECT * FROM legs ORDER BY created_at, settlement_id').all();
    return rows.map(toLeg);
  }

  history(settlementId) {
    return this.db.prepare('SELECT from_state, to_state, detail FROM leg_events WHERE settlement_id = ? ORDER BY id')
      .all(settlementId).map((r) => ({ from: r.from_state, to: r.to_state, detail: r.detail }));
  }

  // Moves a leg from its current state to `to`, enforcing TRANSITIONS. The
  // update is conditional on the state read, so two writers cannot both win.
  transition(settlementId, to, fields = {}) {
    const leg = this.get(settlementId);
    if (!leg) throw new TransitionError(`unknown settlement ${settlementId}`);
    if (!TRANSITIONS[leg.state].includes(to)) {
      throw new TransitionError(`${settlementId}: ${leg.state} -> ${to} is not allowed`);
    }
    const t = this.now();
    const sets = ['state = ?', 'updated_at = ?'];
    const args = [to, t];
    for (const [key, column] of [['txRef', 'tx_ref'], ['networkRound', 'network_round'], ['lastError', 'last_error']]) {
      if (key in fields) { sets.push(`${column} = ?`); args.push(fields[key] ?? null); }
    }
    if (to === S.SUBMITTING) sets.push('attempts = attempts + 1');
    const result = this.db.prepare(`UPDATE legs SET ${sets.join(', ')} WHERE settlement_id = ? AND state = ?`)
      .run(...args, settlementId, leg.state);
    if (result.changes !== 1) throw new TransitionError(`${settlementId}: concurrent change from ${leg.state}`);
    this.#log(settlementId, leg.state, to, fields.lastError ?? fields.txRef ?? null, t);
    return this.get(settlementId);
  }

  // One submitter per leg (ADR-0009 section 3, rule 2). A lease is taken
  // atomically and expires, so a crashed worker cannot block a leg forever.
  acquireLease(settlementId, owner, ttlMs) {
    const t = this.now();
    const result = this.db.prepare(`UPDATE legs SET lease_owner = ?, lease_expires_at = ?
      WHERE settlement_id = ? AND (lease_owner IS NULL OR lease_owner = ? OR lease_expires_at < ?)`)
      .run(owner, t + ttlMs, settlementId, owner, t);
    if (result.changes !== 1) throw new LeaseError(`${settlementId} is leased by another worker`);
  }

  releaseLease(settlementId, owner) {
    this.db.prepare('UPDATE legs SET lease_owner = NULL, lease_expires_at = NULL WHERE settlement_id = ? AND lease_owner = ?')
      .run(settlementId, owner);
  }

  #log(settlementId, from, to, detail, at) {
    this.db.prepare('INSERT INTO leg_events (settlement_id, from_state, to_state, detail, at) VALUES (?, ?, ?, ?, ?)')
      .run(settlementId, from, to, detail, at);
  }
}

function toLeg(row) {
  const leg = {};
  for (const column of LEG_COLUMNS) {
    leg[column.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = row[column];
  }
  return leg;
}

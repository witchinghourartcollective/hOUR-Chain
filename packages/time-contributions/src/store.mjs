// Durable storage for the contribution registry.
//
// Events live in an append-only SQLite table. Each row carries a hash chain:
//   entry_hash = sha256(prev_hash + "\n" + canonical JSON of the signed event)
// On open, and whenever the log changes, the whole log is checked: contiguous
// sequence numbers, an unbroken hash chain, then a full replay through
// ContributionRegistry, which re-verifies every ML-DSA signature, payload hash
// and workflow rule. Any failure refuses to open (or to keep serving) the store.
//
// append() validates and writes inside one IMMEDIATE transaction, so a rejected
// event never reaches disk and two writers cannot interleave.
//
// What this does and does not prove:
//  - It detects corruption and naive tampering: an edited, inserted or removed
//    row breaks the chain or fails replay.
//  - A running instance never moves backwards: after it has verified entry
//    (seq, hash), any later state must still contain that exact entry. Deleting
//    a trailing amendment, or rewriting history to the same length, is refused.
//  - It cannot stop someone with write access to the file from deleting rows
//    (for example a dispute), renumbering and recomputing the whole chain while
//    no instance is running, if the remaining events still form a valid
//    workflow. Detecting that requires an independent anchor: record head()
//    somewhere the attacker cannot rewrite (for example on a ledger) and pass
//    it back as expectedHead. An anchor covers all history up to its seq.
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import canonicalize from 'canonicalize';
import { ContributionRegistry } from './registry.mjs';

export const GENESIS = '0'.repeat(64);

export class StoreIntegrityError extends Error {}

const chainHash = (prev, body) => createHash('sha256').update(`${prev}\n${body}`, 'utf8').digest('hex');

const SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    body TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    entry_hash TEXT NOT NULL UNIQUE,
    appended_at INTEGER NOT NULL
  );
`;

export class DurableRegistry {
  #db;
  #options;
  #anchor = null;
  #registry;
  #seq = 0;
  #head = GENESIS;
  #verified = false; // true once this instance has verified a state it must never move back from
  #dataVersion = null; // SQLite data_version at the last verification

  /**
   * @param {string} path  SQLite file path (':memory:' for tests)
   * @param {object} options  { resolveKey, operators } as for ContributionRegistry
   * @param {{ seq: number, hash: string }} [options.expectedHead]  an independently recorded head();
   *   the log must contain it, now and on every later reload
   */
  constructor(path, { expectedHead, ...options }) {
    this.#options = options;
    this.#anchor = expectedHead ?? null;
    this.#db = new DatabaseSync(path);
    try {
      this.#db.exec(SCHEMA_SQL);
      this.#reload();
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }

  close() {
    this.#db.close();
  }

  // Latest sequence number and chain hash. Record it independently to anchor history.
  head() {
    this.#sync();
    return { seq: this.#seq, hash: this.#head };
  }

  append(event) {
    this.#db.exec('BEGIN IMMEDIATE');
    let applied = false;
    try {
      this.#sync(); // another process may have appended since our last read
      const result = this.#registry.append(event); // full validation; throws before mutating
      applied = true;
      const body = canonicalize(event);
      const entryHash = chainHash(this.#head, body);
      const seq = this.#seq + 1;
      this.#insert(seq, event, body, this.#head, entryHash);
      this.#db.exec('COMMIT');
      this.#seq = seq;
      this.#head = entryHash;
      return { ...result, seq, entryHash };
    } catch (error) {
      try { this.#db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      if (applied) this.#reload(); // memory moved ahead of disk; rebuild from disk
      throw error;
    }
  }

  // --- queries (each first picks up changes made by other processes) ---

  isApproved(ref) { this.#sync(); return this.#registry.isApproved(ref); }
  contribution(id, version) { this.#sync(); return this.#registry.contribution(id, version); }
  agreement(id, version) { this.#sync(); return this.#registry.agreement(id, version); }
  revenue(id) { this.#sync(); return this.#registry.revenue(id); }
  obligation(eventId) { this.#sync(); return this.#registry.obligation(eventId); }
  approvalEventIds(id, version, kind) { this.#sync(); return this.#registry.approvalEventIds(id, version, kind); }
  get log() { this.#sync(); return this.#registry.log; }

  // One canonical signed event per line, in order: a portable backup.
  exportJsonl() {
    this.#sync();
    return this.#db.prepare('SELECT body FROM events ORDER BY seq').all().map((r) => r.body).join('\n');
  }

  // Restores a JSONL backup into a new, empty store, all or nothing. The whole
  // backup is parsed, replayed and checked against options.expectedHead in
  // memory first; only then is it written, in a single transaction.
  static importJsonl(path, text, options) {
    const { expectedHead, ...registryOptions } = options;
    const events = [];
    for (const [i, line] of text.split('\n').entries()) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch { throw new StoreIntegrityError(`backup line ${i + 1} is not JSON`); }
    }
    try {
      ContributionRegistry.fromLog(events, registryOptions);
    } catch (error) {
      throw new StoreIntegrityError(`backup rejected: ${error.message}`);
    }
    const rows = [];
    let prev = GENESIS;
    for (const event of events) {
      const body = canonicalize(event);
      const hash = chainHash(prev, body);
      rows.push({ event, body, prev, hash });
      prev = hash;
    }
    if (expectedHead && !checkpointIn(expectedHead, rows.map((r) => r.hash))) {
      throw new StoreIntegrityError(`backup does not contain the expected head ${expectedHead.seq}:${expectedHead.hash}`);
    }

    // Write through the connection the returned store keeps, so ':memory:'
    // imports are not lost to a closed connection.
    const store = new DurableRegistry(path, registryOptions);
    try {
      store.#db.exec('BEGIN IMMEDIATE');
      try {
        if (store.#db.prepare('SELECT COUNT(*) AS n FROM events').get().n !== 0) throw new StoreIntegrityError('import target is not empty');
        rows.forEach((r, i) => store.#insert(i + 1, r.event, r.body, r.prev, r.hash));
        store.#db.exec('COMMIT');
      } catch (error) {
        store.#db.exec('ROLLBACK');
        throw error;
      }
      store.#anchor = expectedHead ?? null;
      store.#reload(); // verifies the written log once more, including the anchor
      return store;
    } catch (error) {
      store.close();
      throw error;
    }
  }

  #insert(seq, event, body, prev, hash) {
    this.#db.prepare(`INSERT INTO events (seq, event_id, event_type, body, prev_hash, entry_hash, appended_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(seq, event.envelope.eventId, event.envelope.eventType, body, prev, hash, Date.now());
  }

  // Reloads (re-verifying the whole log) whenever any other connection has
  // committed to the database since our last verification. SQLite's
  // data_version changes on every commit by another connection, so edits or
  // deletions anywhere in the log, not only at the head, are caught. The
  // length and head-hash checks are a second line of defence.
  #sync() {
    const { data_version: version } = this.#db.prepare('PRAGMA data_version').get();
    const { n } = this.#db.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM events').get();
    const at = this.#seq === 0 ? null : this.#db.prepare('SELECT entry_hash FROM events WHERE seq = ?').get(this.#seq);
    if (version !== this.#dataVersion || n !== this.#seq || (this.#seq > 0 && at?.entry_hash !== this.#head)) this.#reload();
  }

  #reload() {
    const rows = this.#db.prepare('SELECT seq, event_id, body, prev_hash, entry_hash FROM events ORDER BY seq').all();
    let prev = GENESIS;
    const events = [];
    const hashes = [];
    for (const [i, row] of rows.entries()) {
      if (row.seq !== i + 1) throw new StoreIntegrityError(`sequence gap: expected ${i + 1}, found ${row.seq}`);
      if (row.prev_hash !== prev) throw new StoreIntegrityError(`hash chain broken at seq ${row.seq}`);
      if (chainHash(prev, row.body) !== row.entry_hash) throw new StoreIntegrityError(`entry hash mismatch at seq ${row.seq}`);
      const event = JSON.parse(row.body);
      if (event?.envelope?.eventId !== row.event_id) throw new StoreIntegrityError(`event_id mismatch at seq ${row.seq}`);
      events.push(event);
      hashes.push(row.entry_hash);
      prev = row.entry_hash;
    }
    // Never move backwards from a state this instance already verified.
    if (this.#verified && !checkpointIn({ seq: this.#seq, hash: this.#head }, hashes)) {
      throw new StoreIntegrityError(`log no longer contains verified entry ${this.#seq}:${this.#head}; refusing to roll back`);
    }
    if (this.#anchor && !checkpointIn(this.#anchor, hashes)) {
      throw new StoreIntegrityError(`log does not contain the expected head ${this.#anchor.seq}:${this.#anchor.hash}`);
    }
    const registry = new ContributionRegistry(this.#options);
    for (const [i, event] of events.entries()) {
      try {
        registry.append(event);
      } catch (error) {
        throw new StoreIntegrityError(`replay rejected seq ${i + 1}: ${error.message}`);
      }
    }
    this.#registry = registry;
    this.#seq = rows.length;
    this.#head = prev;
    this.#verified = true;
    this.#dataVersion = this.#db.prepare('PRAGMA data_version').get().data_version;
  }
}

// True if checkpoint { seq, hash } is in the chain given as entry hashes (index 0 = seq 1).
// The genesis checkpoint { seq: 0, hash: GENESIS } is in every chain.
function checkpointIn({ seq, hash }, hashes) {
  if (seq === 0) return hash === GENESIS;
  return Number.isInteger(seq) && seq > 0 && hashes[seq - 1] === hash;
}

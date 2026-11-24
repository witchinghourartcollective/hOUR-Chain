// Durable, tamper-evident storage for the contribution registry.
//
// Events live in an append-only SQLite table. Each row carries a hash chain:
//   entry_hash = sha256(prev_hash + "\n" + canonical JSON of the signed event)
// On open, and whenever another process has appended, the whole log is checked:
// contiguous sequence numbers, an unbroken hash chain, then a full replay
// through ContributionRegistry, which re-verifies every ML-DSA signature,
// payload hash and workflow rule. Any failure refuses to open the store.
//
// append() validates and writes inside one IMMEDIATE transaction, so a rejected
// event never reaches disk and two writers cannot interleave.
//
// The chain detects edits, insertions and deletions inside the log. It cannot
// detect the newest rows being cut off; for that, record head() somewhere
// independent (for example anchor it on a ledger) and pass it as expectedHead.
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import canonicalize from 'canonicalize';
import { ContributionRegistry } from './registry.mjs';

export const GENESIS = '0'.repeat(64);

export class StoreIntegrityError extends Error {}

const chainHash = (prev, body) => createHash('sha256').update(`${prev}\n${body}`, 'utf8').digest('hex');

export class DurableRegistry {
  #db;
  #options;
  #registry;
  #seq = 0;
  #head = GENESIS;

  /**
   * @param {string} path  SQLite file path (':memory:' for tests)
   * @param {object} options  { resolveKey, operators } as for ContributionRegistry
   * @param {{ seq: number, hash: string }} [options.expectedHead]  refuse to open if the log does not reach this head
   */
  constructor(path, { expectedHead, ...options }) {
    this.#options = options;
    this.#db = new DatabaseSync(path);
    this.#db.exec(`
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
    `);
    this.#reload();
    if (expectedHead) {
      const row = this.#db.prepare('SELECT entry_hash FROM events WHERE seq = ?').get(expectedHead.seq);
      if (!row || row.entry_hash !== expectedHead.hash) {
        throw new StoreIntegrityError(`log does not contain the expected head ${expectedHead.seq}:${expectedHead.hash}`);
      }
    }
  }

  close() {
    this.#db.close();
  }

  // Latest sequence number and chain hash; anchor these externally to detect truncation.
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
      this.#db.prepare(`INSERT INTO events (seq, event_id, event_type, body, prev_hash, entry_hash, appended_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(seq, event.envelope.eventId, event.envelope.eventType, body, this.#head, entryHash, Date.now());
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

  // --- queries (each first picks up appends made by other processes) ---

  isApproved(ref) { this.#sync(); return this.#registry.isApproved(ref); }
  contribution(id, version) { this.#sync(); return this.#registry.contribution(id, version); }
  agreement(id, version) { this.#sync(); return this.#registry.agreement(id, version); }
  revenue(id) { this.#sync(); return this.#registry.revenue(id); }
  obligation(eventId) { this.#sync(); return this.#registry.obligation(eventId); }
  approvalEventIds(id, version, kind) { this.#sync(); return this.#registry.approvalEventIds(id, version, kind); }
  get log() { this.#sync(); return this.#registry.log; }

  // One canonical signed event per line, in order: a portable backup.
  exportJsonl() {
    return this.#db.prepare('SELECT body FROM events ORDER BY seq').all().map((r) => r.body).join('\n');
  }

  // Restores a JSONL backup into a new, empty store. Every event is re-verified on the way in.
  static importJsonl(path, text, options) {
    const store = new DurableRegistry(path, options);
    if (store.head().seq !== 0) {
      store.close();
      throw new StoreIntegrityError('import target is not empty');
    }
    for (const line of text.split('\n').filter((l) => l.trim())) store.append(JSON.parse(line));
    return store;
  }

  #sync() {
    const { n } = this.#db.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM events').get();
    if (n !== this.#seq) this.#reload();
  }

  #reload() {
    const rows = this.#db.prepare('SELECT seq, event_id, body, prev_hash, entry_hash FROM events ORDER BY seq').all();
    let prev = GENESIS;
    const events = [];
    for (const [i, row] of rows.entries()) {
      if (row.seq !== i + 1) throw new StoreIntegrityError(`sequence gap: expected ${i + 1}, found ${row.seq}`);
      if (row.prev_hash !== prev) throw new StoreIntegrityError(`hash chain broken at seq ${row.seq}`);
      if (chainHash(prev, row.body) !== row.entry_hash) throw new StoreIntegrityError(`entry hash mismatch at seq ${row.seq}`);
      const event = JSON.parse(row.body);
      if (event?.envelope?.eventId !== row.event_id) throw new StoreIntegrityError(`event_id mismatch at seq ${row.seq}`);
      events.push(event);
      prev = row.entry_hash;
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
  }
}

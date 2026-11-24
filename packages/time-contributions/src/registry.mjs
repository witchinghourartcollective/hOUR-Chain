// Append-only registry for the real-hours workflow (docs/TIME-CONTRIBUTIONS.md).
//
// Every record is a signed hOUR Chain event: { envelope, payload }. append()
// verifies the envelope (schema, payload hash, ML-DSA signature, signer = actor)
// and the payload (schema plus cross-record rules), then applies it. A rejected
// event changes nothing. History is never overwritten: corrections are new
// versions, decisions are immutable, superseded versions stay in the log.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import canonicalize from 'canonicalize';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { verifyEnvelope } from '../../pqc-profile/src/index.mjs';
import { calculateObligation } from './calculate.mjs';

const SCHEMA = JSON.parse(readFileSync(new URL('../../../specs/payloads/time-contributions.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(SCHEMA);
export const EVENT_TYPES = ['contribution.claimed', 'contribution.reviewed', 'agreement.proposed', 'agreement.reviewed',
  'revenue.reported', 'obligation.calculated'];
const validators = Object.fromEntries(EVENT_TYPES.map((t) => [t, ajv.getSchema(`${SCHEMA.$id}#/$defs/${t}`)]));

export const STATUS = Object.freeze({ PENDING: 'PENDING', APPROVED: 'APPROVED', DISPUTED: 'DISPUTED', SUPERSEDED: 'SUPERSEDED' });

export class RegistryError extends Error {}

export function payloadHash(payload) {
  return createHash('sha256').update(Buffer.from(canonicalize(payload), 'utf8')).digest('hex');
}

export const identityOf = (signer) => String(signer ?? '').split('#')[0];

export class ContributionRegistry {
  #log = [];
  #eventIds = new Set();
  #contributions = new Map();
  #agreements = new Map();
  #revenues = new Map();
  #obligations = new Map();
  #obligationKeys = new Map();
  #operators = new Set();

  /**
   * @param {object} options
   * @param {(signer: string) => object} options.resolveKey  public key for a signer ("identity#key")
   * @param {string[]} options.operators  identities allowed to report revenue and calculate obligations
   */
  constructor({ resolveKey, operators }) {
    if (!resolveKey) throw new TypeError('resolveKey is required');
    if (!operators?.length) throw new TypeError('operators is required');
    this.resolveKey = resolveKey;
    this.#operators = new Set(operators);
  }

  get log() {
    return structuredClone(this.#log);
  }

  static fromLog(events, options) {
    const registry = new ContributionRegistry(options);
    for (const event of events) registry.append(event);
    return registry;
  }

  append(event) {
    const accepted = structuredClone(event);
    const { envelope, payload } = accepted ?? {};
    const type = envelope?.eventType;
    if (!EVENT_TYPES.includes(type)) throw new RegistryError(`unsupported eventType ${type}`);
    if (this.#eventIds.has(envelope.eventId)) throw new RegistryError(`duplicate eventId ${envelope.eventId}`);
    if (envelope.network && envelope.network !== 'offchain') throw new RegistryError('contribution records are offchain events');
    if (!validators[type](payload)) throw new RegistryError(`invalid ${type}: ${ajv.errorsText(validators[type].errors)}`);
    if (envelope.payloadHash !== payloadHash(payload)) throw new RegistryError('payloadHash does not match payload');
    const signer = envelope.signature?.signer;
    const key = this.resolveKey(signer);
    if (!key) throw new RegistryError(`no key for signer ${signer}`);
    const verdict = verifyEnvelope(envelope, key);
    if (!verdict.valid) throw new RegistryError(`signature invalid: ${verdict.reason ?? 'verification failed'}`);
    const actor = identityOf(signer);
    if (envelope.actor !== actor) throw new RegistryError(`actor ${envelope.actor} is not the signer ${actor}`);

    const handler = {
      'contribution.claimed': this.#claim,
      'contribution.reviewed': this.#reviewContribution,
      'agreement.proposed': this.#propose,
      'agreement.reviewed': this.#reviewAgreement,
      'revenue.reported': this.#reportRevenue,
      'obligation.calculated': this.#obligate,
    }[type];
    handler.call(this, envelope, payload, actor); // throws before mutating on any rule violation
    this.#eventIds.add(envelope.eventId);
    this.#log.push(accepted);
    return { eventId: envelope.eventId, type };
  }

  // --- queries ---

  contribution(id, version) {
    const record = this.#contributions.get(id);
    if (!record) return null;
    const result = version ? record.versions[version - 1] ?? null : record.versions.at(-1);
    return result ? structuredClone(result) : null;
  }

  agreement(id, version) {
    const record = this.#agreements.get(id);
    if (!record) return null;
    const result = version ? record.versions[version - 1] ?? null : record.versions.at(-1);
    return result ? structuredClone(result) : null;
  }

  revenue(id) {
    const result = this.#revenues.get(id);
    return result ? structuredClone(result) : null;
  }

  obligation(eventId) {
    const record = this.#obligations.get(eventId);
    if (!record) return null;
    return { ...structuredClone(record), valid: this.#obligationValid(record.payload) };
  }

  // Plugs into GculSettlementAdapter({ isApproved }). True for:
  //  - "id@version" of a contribution or agreement version that is APPROVED and current;
  //  - the event ID of an obligation whose contribution and agreement versions are still approved;
  //  - the event ID of an approving review of a version that is still approved.
  isApproved(ref) {
    const at = /^(.+)@([1-9][0-9]*)$/.exec(ref);
    if (at) {
      const version = this.#contribution(at[1], Number(at[2])) ?? this.#agreement(at[1], Number(at[2]));
      return version?.status === STATUS.APPROVED;
    }
    const obligation = this.#obligations.get(ref);
    if (obligation) return this.#obligationValid(obligation.payload);
    for (const records of [this.#contributions, this.#agreements]) {
      for (const record of records.values()) {
        for (const v of record.versions) {
          for (const review of v.reviews.values()) {
            if (review.eventId === ref) return review.decision === 'approve' && v.status === STATUS.APPROVED;
          }
        }
      }
    }
    return false;
  }

  approvalEventIds(id, version, kind) {
    const v = kind === 'agreement' ? this.#agreement(id, version) : this.#contribution(id, version);
    return [...(v?.reviews.values() ?? [])].filter((r) => r.decision === 'approve').map((r) => r.eventId);
  }

  #contribution(id, version) {
    const record = this.#contributions.get(id);
    return record ? version ? record.versions[version - 1] ?? null : record.versions.at(-1) : null;
  }

  #agreement(id, version) {
    const record = this.#agreements.get(id);
    return record ? version ? record.versions[version - 1] ?? null : record.versions.at(-1) : null;
  }

  // --- handlers ---

  #claim(envelope, p, actor) {
    if (actor !== p.contributor) throw new RegistryError('a contribution must be claimed by its contributor');
    if (p.reviewers.includes(p.contributor)) throw new RegistryError('a contributor cannot review their own claim');
    if (p.startAt) {
      const window = (Date.parse(p.endAt) - Date.parse(p.startAt)) / 1000;
      if (!(window > 0)) throw new RegistryError('endAt must be after startAt');
      if (p.durationSeconds > window) throw new RegistryError('durationSeconds exceeds the start/end window');
    }
    if (this.#agreements.has(p.contributionId)) throw new RegistryError('contributionId collides with an agreementId');
    const record = this.#contributions.get(p.contributionId);
    this.#checkVersioning(record, p, envelope, 'contribution');
    if (record && record.versions.at(-1).payload.contributor !== p.contributor) {
      throw new RegistryError('only the original contributor can amend a claim');
    }
    this.#checkOverlapAndDuplicates(p);
    this.#addVersion(this.#contributions, p.contributionId, envelope, p);
  }

  #reviewContribution(envelope, p, actor) {
    const v = this.#contribution(p.contributionId, p.version);
    if (!v) throw new RegistryError(`unknown contribution ${p.contributionId}@${p.version}`);
    if (!v.payload.reviewers.includes(actor)) throw new RegistryError(`${actor} is not a reviewer of this claim`);
    this.#review(v, envelope, p, actor, v.payload.reviewers);
  }

  #propose(envelope, p, actor) {
    if (!p.parties.includes(actor)) throw new RegistryError('an agreement must be proposed by one of its parties');
    if (!p.parties.includes(p.payee)) throw new RegistryError('the payee must be a party to the agreement');
    if (this.#contributions.has(p.agreementId)) throw new RegistryError('agreementId collides with a contributionId');
    const contribution = this.#contribution(p.contributionId);
    if (!contribution) throw new RegistryError(`unknown contribution ${p.contributionId}`);
    if (contribution.payload.workRef !== p.workRef) throw new RegistryError('agreement workRef does not match the contribution');
    const record = this.#agreements.get(p.agreementId);
    const current = record?.versions.at(-1);
    if (current && !current.payload.parties.includes(actor)) {
      throw new RegistryError('an agreement amendment must be proposed by a current party');
    }
    this.#checkVersioning(record, p, envelope, 'agreement');
    this.#addVersion(this.#agreements, p.agreementId, envelope, p);
  }

  #reviewAgreement(envelope, p, actor) {
    const v = this.#agreement(p.agreementId, p.version);
    if (!v) throw new RegistryError(`unknown agreement ${p.agreementId}@${p.version}`);
    if (!v.payload.parties.includes(actor)) throw new RegistryError(`${actor} is not a party to this agreement`);
    this.#review(v, envelope, p, actor, v.payload.parties);
  }

  #reportRevenue(envelope, p, actor) {
    if (!this.#operators.has(actor)) throw new RegistryError('revenue must be reported by an operator');
    if (this.#revenues.has(p.revenueId)) throw new RegistryError(`duplicate revenueId ${p.revenueId}`);
    if (!(Date.parse(p.periodEnd) > Date.parse(p.periodStart))) throw new RegistryError('periodEnd must be after periodStart');
    this.#revenues.set(p.revenueId, { eventId: envelope.eventId, payload: p });
  }

  #obligate(envelope, p, actor) {
    if (!this.#operators.has(actor)) throw new RegistryError('obligations must be calculated by an operator');
    const [cId, cVer] = splitRef(p.contributionRef);
    const [aId, aVer] = splitRef(p.agreementRef);
    const contribution = this.#contribution(cId, cVer);
    const agreement = this.#agreement(aId, aVer);
    if (contribution?.status !== STATUS.APPROVED) throw new RegistryError(`${p.contributionRef} is not an approved current version`);
    if (agreement?.status !== STATUS.APPROVED) throw new RegistryError(`${p.agreementRef} is not an approved current version`);
    if (agreement.payload.contributionId !== cId) throw new RegistryError('agreement does not cover this contribution');
    if (contribution.payload.workRef !== agreement.payload.workRef) throw new RegistryError('agreement workRef does not match the selected contribution');
    if (p.payee !== agreement.payload.payee) throw new RegistryError('payee does not match the agreement');
    if (p.currency !== agreement.payload.currency) throw new RegistryError('currency does not match the agreement');
    let revenue;
    if (agreement.payload.basis === 'revenue_share') {
      revenue = p.revenueRef && this.#revenues.get(p.revenueRef)?.payload;
      if (!revenue) throw new RegistryError('revenue_share obligation needs a reported revenueRef');
      if (revenue.workRef !== agreement.payload.workRef || revenue.currency !== p.currency) {
        throw new RegistryError('revenue report does not match the agreement work or currency');
      }
    } else if (p.revenueRef) {
      throw new RegistryError(`revenueRef is only valid for revenue_share, not ${agreement.payload.basis}`);
    }
    const expected = calculateObligation({ agreement: agreement.payload, contribution: contribution.payload, revenue });
    if (p.amountMinor !== expected.amountMinor || canonicalize(p.calculation) !== canonicalize(expected.calculation)) {
      throw new RegistryError(`amount does not match the agreement: expected ${expected.amountMinor} (${expected.calculation.formula})`);
    }
    const key = `${p.contributionRef}|${p.agreementRef}|${p.revenueRef ?? ''}`;
    if (this.#obligationKeys.has(key)) throw new RegistryError(`obligation already calculated for ${key}`);
    for (const o of this.#obligations.values()) {
      if (o.payload.obligationId === p.obligationId) throw new RegistryError(`duplicate obligationId ${p.obligationId}`);
    }
    this.#obligations.set(envelope.eventId, { eventId: envelope.eventId, payload: p, key });
    this.#obligationKeys.set(key, envelope.eventId);
  }

  // --- helpers ---

  #checkVersioning(record, p, envelope, kind) {
    if (!record) {
      if (p.version !== 1 || p.amends) throw new RegistryError(`a new ${kind} starts at version 1 with no amends`);
      return;
    }
    const current = record.versions.at(-1);
    if (p.version !== current.version + 1) throw new RegistryError(`next ${kind} version must be ${current.version + 1}`);
    if (p.amends !== current.eventId) throw new RegistryError(`amends must reference the current version's event ${current.eventId}`);
  }

  #checkOverlapAndDuplicates(p) {
    for (const [id, record] of this.#contributions) {
      if (id === p.contributionId) continue; // an amendment replaces its own previous version
      const other = record.versions.at(-1);
      if (other.status === STATUS.SUPERSEDED || other.payload.contributor !== p.contributor) continue;
      const o = other.payload;
      if (p.startAt && o.startAt && Date.parse(p.startAt) < Date.parse(o.endAt) && Date.parse(o.startAt) < Date.parse(p.endAt)) {
        throw new RegistryError(`overlaps ${id}@${other.version} for the same contributor`);
      }
      if (!p.startAt && !o.startAt && o.workRef === p.workRef && o.role === p.role && o.activity === p.activity &&
          o.durationSeconds === p.durationSeconds) {
        throw new RegistryError(`probable duplicate of ${id}@${other.version}; add startAt/endAt to distinguish sessions`);
      }
    }
  }

  #addVersion(map, id, envelope, payload) {
    const record = map.get(id) ?? { versions: [] };
    const previous = record.versions.at(-1);
    if (previous) previous.status = STATUS.SUPERSEDED;
    record.versions.push({ version: payload.version, eventId: envelope.eventId, payload, status: STATUS.PENDING, reviews: new Map() });
    map.set(id, record);
  }

  #review(v, envelope, p, actor, required) {
    if (v.status === STATUS.SUPERSEDED) throw new RegistryError('cannot review a superseded version');
    if (v.reviews.has(actor)) throw new RegistryError(`${actor} already reviewed this version; decisions are immutable`);
    v.reviews.set(actor, { decision: p.decision, eventId: envelope.eventId, reason: p.reason ?? null });
    if (p.decision === 'dispute') v.status = STATUS.DISPUTED;
    else if (v.status === STATUS.PENDING && required.every((r) => v.reviews.get(r)?.decision === 'approve')) {
      v.status = STATUS.APPROVED;
    }
  }

  #obligationValid(p) {
    const [cId, cVer] = splitRef(p.contributionRef);
    const [aId, aVer] = splitRef(p.agreementRef);
    return this.#contribution(cId, cVer)?.status === STATUS.APPROVED && this.#agreement(aId, aVer)?.status === STATUS.APPROVED;
  }
}

function splitRef(ref) {
  const at = ref.lastIndexOf('@');
  return [ref.slice(0, at), Number(ref.slice(at + 1))];
}

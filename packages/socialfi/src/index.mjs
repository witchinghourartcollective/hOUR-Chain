import { createHash, randomUUID } from 'node:crypto';

export const SOCIALFI_DOMAIN = 'HBC-SOCIALFI-v1';
export const HOUR_BASE_TOKEN = '0xFC1c0FFF99845676A588CE21c28C4859F3035866';
const FIELDS = {
  'profile.updated': ['handle', 'displayName', 'bio'],
  'work.created': ['title', 'description'],
  'post.published': ['text'],
  'follow.created': ['targetActorId'],
  'contribution.recorded': ['workId', 'role', 'minutes'],
  'contribution.reviewed': ['workId', 'contributionId', 'decision'],
  'support.requested': ['workId', 'recipientActorId', 'asset', 'amountAtomic'],
};
export const SOCIALFI_EVENT_TYPES = Object.freeze(Object.keys(FIELDS).map(t => `socialfi.${t}.v1`));

export function canonicalSocialFiJSON(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalSocialFiJSON).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalSocialFiJSON(value[k])}`).join(',')}}`;
  }
  throw new TypeError('SocialFi payloads require plain JSON with safe integer numbers');
}
export function socialFiPayloadHash(payload) {
  return createHash('sha256').update(canonicalSocialFiJSON(payload)).digest('hex');
}
function text(value, max = 300) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new TypeError('Invalid SocialFi text');
}
function validate(type, payload) {
  const key = type.replace(/^socialfi\./, '').replace(/\.v1$/, '');
  const fields = FIELDS[key];
  if (!SOCIALFI_EVENT_TYPES.includes(type) || !payload || Array.isArray(payload) ||
      Object.getPrototypeOf(payload) !== Object.prototype ||
      Object.keys(payload).length !== fields.length || fields.some(f => !(f in payload))) {
    throw new TypeError('Unknown SocialFi event or payload fields');
  }
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'minutes') {
      if (!Number.isSafeInteger(value) || value < 1 || value > 1440) throw new TypeError('Minutes must be 1–1440');
    } else if (key === 'description' || key === 'bio') {
      if (typeof value !== 'string' || value.length > 2000) throw new TypeError('Invalid description');
    } else text(value, key === 'text' ? 2000 : 300);
  }
  if (key === 'profile.updated' && !/^[a-z0-9_]{3,30}$/.test(payload.handle)) throw new TypeError('Invalid handle');
  if (key === 'contribution.reviewed' && !['reviewed', 'changes-requested'].includes(payload.decision)) throw new TypeError('Invalid review decision');
  if (key === 'support.requested' && (payload.asset !== 'hOUR:base:8453' ||
      !/^[1-9][0-9]{0,77}$/.test(payload.amountAtomic) || BigInt(payload.amountAtomic) >= 2n ** 256n)) {
    throw new TypeError('Support requires a positive uint256 hOUR amount in base units');
  }
  canonicalSocialFiJSON(payload);
}

/** Unsigned application intent. No rights approval, token award or payment is implied. */
export function createSocialFiDraft(eventType, actor, subject, payload, {
  eventId = randomUUID(), issuedAt = new Date().toISOString(),
} = {}) {
  validate(eventType, payload); text(actor); text(subject); text(eventId);
  if (eventId.length < 16 || typeof issuedAt !== 'string' || !Number.isFinite(Date.parse(issuedAt)) ||
      new Date(issuedAt).toISOString() !== issuedAt) throw new TypeError('Invalid event identity or UTC timestamp');
  return {
    domain: SOCIALFI_DOMAIN, status: 'draft', payload: JSON.parse(canonicalSocialFiJSON(payload)),
    envelope: { eventId, protocolVersion: '0.1.0', schemaVersion: '0.1.0', eventType,
      actor, subject, issuedAt, payloadHash: socialFiPayloadHash(payload), network: 'offchain', nonce: eventId },
  };
}

export function assertSocialFiDraft(draft) {
  if (draft?.domain !== SOCIALFI_DOMAIN || draft.status !== 'draft' ||
      Object.keys(draft).sort().join() !== ['domain', 'envelope', 'payload', 'status'].sort().join()) {
    throw new TypeError('Expected an unsigned SocialFi draft');
  }
  const e = draft.envelope;
  const expected = createSocialFiDraft(e?.eventType, e?.actor, e?.subject, draft.payload,
    { eventId: e?.eventId, issuedAt: e?.issuedAt });
  if (canonicalSocialFiJSON(draft) !== canonicalSocialFiJSON(expected)) throw new TypeError('Modified SocialFi draft');
  return draft;
}

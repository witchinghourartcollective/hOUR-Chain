import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocialFiDraft, assertSocialFiDraft, socialFiPayloadHash } from '../src/index.mjs';

test('contribution time produces a deterministic unsigned envelope, not a payment', () => {
  const d = createSocialFiDraft('socialfi.contribution.recorded.v1', 'demo:artist', 'hour:work:1',
    { workId: 'hour:work:1', minutes: 60, role: 'producer' });
  assert.equal(assertSocialFiDraft(d), d);
  assert.equal(d.status, 'draft');
  assert.equal(d.envelope.signature, undefined);
  assert.equal(d.envelope.payloadHash, socialFiPayloadHash({ role: 'producer', minutes: 60, workId: 'hour:work:1' }));
  assert.throws(() => assertSocialFiDraft({ ...d, status: 'settled' }));
  assert.throws(() => assertSocialFiDraft({ ...d, payload: { ...d.payload, minutes: 61 } }));
});
test('reject unknown reward fields, impossible time, malformed amounts and fake signatures', () => {
  const args = ['demo:artist', 'hour:work:1'];
  for (const minutes of [0, 1441, 1.5]) assert.throws(() => createSocialFiDraft(
    'socialfi.contribution.recorded.v1', ...args, { workId: args[1], role: 'producer', minutes }));
  assert.throws(() => createSocialFiDraft('socialfi.post.published.v1', ...args, { text: 'test', reward: 100 }));
  for (const amountAtomic of ['0', '-1', '1.0', String(2n ** 256n)]) assert.throws(() => createSocialFiDraft(
    'socialfi.support.requested.v1', ...args, { workId: args[1], recipientActorId: 'artist', asset: 'hOUR:base:8453', amountAtomic }));
  const draft = createSocialFiDraft('socialfi.post.published.v1', ...args, { text: 'test' });
  assert.throws(() => assertSocialFiDraft({ ...draft, envelope: { ...draft.envelope, signature: { value: 'fake' } } }));
});

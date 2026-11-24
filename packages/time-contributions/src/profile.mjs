// Reads an hour-time profile directory ($HOUR_HOME) for programs other than the
// CLI, such as the GCUL settlement runner. Key resolution matches hour-time:
// signers are "identity#keyId"; rotated keys stay trusted for history.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importPublicKey } from '../../pqc-profile/src/index.mjs';

const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback);

export function readProfile(home) {
  const profile = readJson(join(home, 'profile.json'), null);
  if (!profile?.identity) throw new Error(`no hour-time profile in ${home}`);
  const keys = {};
  for (const [id, entry] of Object.entries(readJson(join(home, 'trusted-keys.json'), {}))) {
    keys[id] = typeof entry === 'string' ? { k1: entry } : { ...entry };
  }
  const own = readJson(join(home, 'signing-key.json'), null);
  keys[profile.identity] = { ...(profile.retiredKeys ?? {}), ...(own ? { [own.keyId ?? 'k1']: own.publicKey } : {}) };
  const operators = profile.operators ?? [];

  const resolver = (allowed) => (signer) => {
    const [id, keyId = 'k1'] = String(signer).split('#');
    if (allowed && !allowed.has(id)) return null;
    const k = keys[id]?.[keyId];
    return k ? importPublicKey(k) : null;
  };

  return {
    identity: profile.identity,
    store: profile.store ?? null,
    operators,
    anchor: profile.anchor ?? null,
    // Every trusted key: for replaying the registry.
    resolveKey: resolver(null),
    // Operators' keys only: for verifying settlement instructions.
    resolveOperatorKey: resolver(new Set(operators)),
  };
}

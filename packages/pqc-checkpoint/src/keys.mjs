import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import {
  exportPrivateKey,
  exportPublicKey,
  importPrivateKey,
  importPublicKey,
} from "../../pqc-profile/src/index.mjs";
import { getNodeKeyType } from "../../pqc-profile/src/registry.mjs";

const ALGORITHM = "ML-DSA-65";

export function generateCheckpointSignerKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync(getNodeKeyType(ALGORITHM));
  return { publicKey, privateKey };
}

export async function loadOrCreateKeyFile(path, { signer }) {
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    if (raw.algorithm !== ALGORITHM) {
      throw new Error(`Key file ${path} uses unexpected algorithm ${raw.algorithm}, expected ${ALGORITHM}`);
    }
    return {
      signer: raw.signer,
      algorithm: raw.algorithm,
      publicKey: importPublicKey(raw.publicKey),
      privateKey: importPrivateKey(raw.privateKey),
      publicKeyEncoded: raw.publicKey,
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (!signer) throw new TypeError("signer identity is required to create a new key file");
  const { publicKey, privateKey } = generateCheckpointSignerKeyPair();
  const publicKeyEncoded = exportPublicKey(publicKey);
  const record = {
    algorithm: ALGORITHM,
    signer,
    createdAt: new Date().toISOString(),
    publicKey: publicKeyEncoded,
    privateKey: exportPrivateKey(privateKey),
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  return { signer, algorithm: ALGORITHM, publicKey, privateKey, publicKeyEncoded };
}

import { readFile } from "node:fs/promises";

const registryUrl = new URL("../../../specs/signature-suite-registry.json", import.meta.url);
const registry = JSON.parse(await readFile(registryUrl, "utf8"));

const nodeKeyTypes = {
  "ML-DSA-65": "ml-dsa-65",
  "SLH-DSA-SHA2-128s": "slh-dsa-sha2-128s",
};

const versionPattern = /^[0-9]+(\.[0-9]+){0,2}$/u;

const suites = new Map(registry.suites.map((suite) => [suite.id, suite]));

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function getSuite(algorithm, suiteVersion) {
  const suite = suites.get(algorithm);
  if (!suite) throw new Error(`Unsupported signature suite: ${algorithm}`);
  if (suite.status === "retired") throw new Error(`Retired signature suite: ${algorithm}`);
  if (typeof suiteVersion !== "string" || !versionPattern.test(suiteVersion)) {
    throw new Error(`Invalid signature suite version: ${suiteVersion}`);
  }
  if (!Array.isArray(suite.acceptedVersions) || !suite.acceptedVersions.includes(suiteVersion)) {
    throw new Error(`Unregistered signature suite version: ${suiteVersion}`);
  }
  if (compareVersions(suiteVersion, registry.defaultAcceptancePolicy.minimumSuiteVersion) < 0) {
    throw new Error(`Signature suite version is below the accepted minimum: ${suiteVersion}`);
  }
  return suite;
}

export function getNodeKeyType(algorithm) {
  const keyType = nodeKeyTypes[algorithm];
  if (!keyType) throw new Error(`No local implementation for signature suite: ${algorithm}`);
  return keyType;
}

export function getRegistry() {
  return structuredClone(registry);
}

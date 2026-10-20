#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { fetchValidatorSet } from "../src/rpc.mjs";
import { loadSignerRegistry, verifyCheckpointQuorum } from "../src/quorum.mjs";

const { values } = parseArgs({
  options: {
    rpc: { type: "string", default: "http://127.0.0.1:26657" },
    height: { type: "string" },
    "checkpoints-dir": { type: "string" },
    "registry-file": { type: "string" },
  },
});

if (!values.height) throw new Error("--height is required");
if (!values["checkpoints-dir"]) throw new Error("--checkpoints-dir is required");
if (!values["registry-file"]) throw new Error("--registry-file is required");

const height = Number(values.height);
const registryRaw = JSON.parse(await readFile(values["registry-file"], "utf8"));
const signerRegistry = loadSignerRegistry(registryRaw);

const files = (await readdir(values["checkpoints-dir"])).filter((f) => f.startsWith(`${height}.`));
const signedCheckpoints = await Promise.all(
  files.map(async (f) => JSON.parse(await readFile(`${values["checkpoints-dir"]}/${f}`, "utf8"))),
);

if (signedCheckpoints.length === 0) {
  throw new Error(`No signed checkpoints found for height ${height} in ${values["checkpoints-dir"]}`);
}

const blockHash = signedCheckpoints[0].blockHash;
const validatorSet = await fetchValidatorSet(values.rpc, height);

const result = verifyCheckpointQuorum(signedCheckpoints, { signerRegistry, validatorSet, height, blockHash });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit(result.hasQuorum ? 0 : 1);

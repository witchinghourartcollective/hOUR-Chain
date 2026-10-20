#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { buildCheckpointEnvelope, signCheckpoint } from "../src/checkpoint.mjs";
import { loadOrCreateKeyFile } from "../src/keys.mjs";
import { fetchBlockHeader, fetchLatestHeight } from "../src/rpc.mjs";

const { values } = parseArgs({
  options: {
    rpc: { type: "string", default: "http://127.0.0.1:26657" },
    height: { type: "string" },
    "key-file": { type: "string" },
    signer: { type: "string" },
    "out-dir": { type: "string" },
  },
});

if (!values["key-file"]) throw new Error("--key-file is required");
if (!values["out-dir"]) throw new Error("--out-dir is required");

const height = values.height ? Number(values.height) : await fetchLatestHeight(values.rpc);
const header = await fetchBlockHeader(values.rpc, height);

const keyFile = await loadOrCreateKeyFile(values["key-file"], { signer: values.signer });
const signer = values.signer ?? keyFile.signer;
if (!signer) throw new Error("--signer is required on first run (to create the key file)");

const envelope = buildCheckpointEnvelope({
  chainId: header.chainId,
  height: header.height,
  blockHash: header.blockHash,
  appHash: header.appHash,
  time: header.time,
});
const signed = signCheckpoint(envelope, keyFile.privateKey, { signer });

const outPath = `${values["out-dir"]}/${header.height}.${signer}.json`;
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(signed, null, 2)}\n`);

process.stdout.write(
  `${JSON.stringify({ signed: true, height: header.height, blockHash: header.blockHash, signer, outPath })}\n`,
);

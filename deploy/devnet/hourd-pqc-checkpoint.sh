#!/usr/bin/env bash
set -u -o pipefail

export PATH="/opt/nodejs/bin:$PATH"
rpc="http://100.76.58.84:26657"
key_file="/var/lib/hourd-data/pqc/checkpoint-signer.key.json"
out_dir="/var/lib/hourd-data/pqc/checkpoints"
signer="hour-devnet-validator-1"

exec node /opt/hour-chain-pqc/packages/pqc-checkpoint/bin/sign-checkpoint.mjs \
  --rpc "$rpc" \
  --key-file "$key_file" \
  --signer "$signer" \
  --out-dir "$out_dir"

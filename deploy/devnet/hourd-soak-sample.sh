#!/usr/bin/env bash
set -u -o pipefail

rpc="http://100.76.58.84:26657"
evm="http://100.76.58.84:8545"
timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
unit_state="$(systemctl show hourd.service -p ActiveState --value 2>/dev/null || printf unknown)"
restarts="$(systemctl show hourd.service -p NRestarts --value 2>/dev/null || printf unknown)"
memory_peak="$(systemctl show hourd.service -p MemoryPeak --value 2>/dev/null || printf unknown)"
height="unavailable"
peers="unavailable"
chain_id="unavailable"

status_json="$(curl -fsS --max-time 5 "$rpc/status" 2>/dev/null || true)"
if [[ -n "$status_json" ]]; then
  height="$(jq -r '.result.sync_info.latest_block_height // "unavailable"' <<<"$status_json" 2>/dev/null || printf unavailable)"
fi
peers_json="$(curl -fsS --max-time 5 "$rpc/net_info" 2>/dev/null || true)"
if [[ -n "$peers_json" ]]; then
  peers="$(jq -r '.result.n_peers // "unavailable"' <<<"$peers_json" 2>/dev/null || printf unavailable)"
fi
chain_json="$(curl -fsS --max-time 5 "$evm" -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' 2>/dev/null || true)"
if [[ -n "$chain_json" ]]; then
  chain_id="$(jq -r '.result // "unavailable"' <<<"$chain_json" 2>/dev/null || printf unavailable)"
fi

printf 'timestamp=%s unit=%s restarts=%s memory_peak_bytes=%s height=%s peers=%s evm_chain_id=%s\n' \
  "$timestamp" "$unit_state" "$restarts" "$memory_peak" "$height" "$peers" "$chain_id"

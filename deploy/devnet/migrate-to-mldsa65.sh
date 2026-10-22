#!/bin/bash
set -e

MIGRATE_DIR=/root/hourd-mldsa65-migration
NEW_BINARY=/root/pqc-genesis-test/chain/build/hourd
DATA_DIR=/var/lib/hourd-data

echo "--- Backing up current binary ---"
cp /usr/local/bin/hourd "$MIGRATE_DIR/hourd-old-ed25519-binary"

echo "--- Installing new ML-DSA-65 binary ---"
cp "$NEW_BINARY" /usr/local/bin/hourd
chmod 755 /usr/local/bin/hourd

echo "--- Swapping in new genesis + validator key ---"
cp "$MIGRATE_DIR/new-genesis.json" "$DATA_DIR/config/genesis.json"
cp "$MIGRATE_DIR/priv_validator_key.json" "$DATA_DIR/config/priv_validator_key.json"
echo '{"height":"0","round":0,"step":0}' > "$DATA_DIR/data/priv_validator_state.json"

echo "--- Wiping old chain history (balances/contracts preserved via genesis, not this) ---"
rm -rf "$DATA_DIR/data/application.db" "$DATA_DIR/data/blockstore.db" "$DATA_DIR/data/state.db" "$DATA_DIR/data/tx_index.db" "$DATA_DIR/data/snapshots" "$DATA_DIR/data/cs.wal"

echo "--- Fixing ownership ---"
chown -R hourd:hourd "$DATA_DIR"

echo "--- Starting hourd.service ---"
systemctl start hourd.service
sleep 10

echo "--- Status ---"
systemctl status hourd.service --no-pager -l | head -15

echo "--- RPC check (height / signature size) ---"
curl -s http://100.76.58.84:26657/status | python3 -m json.tool 2>/dev/null | grep -A3 "latest_block_height\|catching_up"
curl -s http://100.76.58.84:26657/commit | python3 -c "
import json,sys,base64
d=json.load(sys.stdin)
sigs = d['result']['signed_header']['commit']['signatures']
for s in sigs:
    sig = s.get('signature')
    print('signature bytes:', len(base64.b64decode(sig)) if sig else 0)
"

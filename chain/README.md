# hOUR Chain node (devnet scaffold)

Based on the `cosmos/evm` v0.7.0 `evmd` example (SDK v0.54.3, CometBFT v0.39.3, ibc-go v11). See docs/ADR-0005.

    go build -o build/hourd ./cmd/evmd   # Go 1.25.9+
    PATH=$PWD/build:$PATH ./devnet.sh --no-install -y

chain-id `hour_9000-1`, EVM chain id 9000, denom `ahbc`; JSON-RPC on :8545.

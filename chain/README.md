# hOUR Chain node (devnet scaffold)

Based on the `cosmos/evm` v0.7.0 `evmd` example (SDK v0.54.3, CometBFT v0.39.3, ibc-go v11). See docs/ADR-0005.

    ./scripts/build.sh   # Downloads Go 1.25.9 and verifies dependencies
    PATH=$PWD/build:$PATH ./devnet.sh --no-install -y

chain-id `hour_9000-1`, EVM chain id 9000, denom `ahbc`; JSON-RPC on :8545.

The build script uses one compiler job and two Go runtime threads by default to
limit memory pressure. Override `GO_BUILD_PARALLELISM`, `GOMAXPROCS`, or
`GOMEMLIMIT` if needed. Dependencies remain pinned in `go.mod` and `go.sum`.
VCS stamping is disabled because an enclosing home-directory Mercurial repository
can conflict with this project's Git repository.

If a build reports missing packages that are already required in `go.mod`, run
`go mod verify` to check for damaged cached sources. Restore only the affected
module cache directories, then run `go clean -cache` to discard stale package
indexes before rebuilding. Do not add arbitrary newer dependencies with `go get`.

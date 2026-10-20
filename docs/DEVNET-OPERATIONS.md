# hOUR Chain devnet operations

## Current node and access boundary

The DigitalOcean node is a one-validator development network, not a public
testnet. It had no connected peers or configured seeds when audited on
2026-10-19. Keep its CometBFT RPC (`26657`), P2P (`26656`), and EVM JSON-RPC
(`8545`) on the node's Tailscale address (`100.76.58.84`) while it remains a
single-node devnet. The public testnet must use a separately reviewed
multi-validator topology, public P2P, and a rate-limited RPC gateway.

## Memory and restart guardrails

`deploy/devnet/hourd.service` is the source unit. It sets Go's soft memory
limit to 512 MiB, keeps the existing 768 MiB cgroup ceiling, and restarts a
failed process after 60 seconds with a maximum of two starts per hour. This
prevents an unlimited restart loop; it does not establish the cause of the
memory growth or prove long-term stability. Require a sustained 24-hour
memory/height/peer/RPC soak before calling the devnet reliable.

The 2026-10-19 incident ended in an OOM kill at height 69,787 after about nine
hours of empty-block production. The process was left stopped (`Restart=no`)
and the host had about 979 MiB available with roughly 953 MiB swap in use.
The saved application state was not reinitialized. Empty blocks were being
committed about once per second with no peers or transactions, so the devnet
was consuming resources without useful test activity.

`hourd-soak-sample.timer` now records a read-only sample every five minutes
in the system journal: service state, restart count, peak memory, CometBFT
height and peer count, and EVM chain ID. Inspect samples with
`journalctl -u hourd-soak-sample.service --since '24 hours ago'`. The first
sample after the 2026-10-19 21:34 UTC restart was recorded at 2026-10-20
01:09 UTC: active, zero restarts, 494026752-byte memory peak, height 72351,
zero peers, and chain ID `0x2328`. This is an initial observation, not a
completed 24-hour soak; the first full window ends no earlier than 2026-10-20
21:34 UTC if the service remains continuously active.

## IBC and public-testnet readiness

`go test ./... -run TestICS20TransferAndTimeoutRefund` exercises the hOUR app
against IBC-Go's Cosmos test app. It proves outbound voucher minting and
success acknowledgement, timeout with source refund, and a return transfer
that releases hOUR escrow. This is local module-level IBC proof, not yet a
two-hOUR-node test. The current EVM module initializes process-global chain
configuration per app, so two hOUR EVM apps in one test process panic on
duplicate activation. A separate-process/two-node transfer remains necessary
to verify hOUR-to-hOUR interoperability before connecting a relayer to a
multi-node hOUR network. For a public testnet, also add independent
validators, genesis distribution, peer discovery, upgrade coordination,
snapshots, metrics, alerts, and recovery instructions. Do not promote the
current one-validator node by simply opening its RPC port to the internet.

The `hourd testnet init-files` generator now writes CometBFT RPC, REST, gRPC,
and EVM JSON-RPC listeners to loopback; JSON-RPC exposes only `eth`, `net`,
and `web3`, and telemetry is disabled by default. CometBFT P2P remains
peer-facing, and genesis transaction memos populate each node's persistent
peer list. Generated wallet seed files use mode `0600`. Published demo-key
accounts are absent unless the explicitly unsafe
`--unsafe-include-published-demo-accounts` flag is given. The in-process
`hourd testnet start` command also defaults its RPC, REST, and gRPC listeners
to loopback. A generated four-validator local configuration was inspected on
2026-10-20: every node had loopback RPC/REST/gRPC/JSON-RPC on distinct local
ports, the least-privilege JSON-RPC namespace set, and a three-peer list.
This proves config generation only; operators still need to run the network,
validate consensus and recovery, and place any public RPC behind a rate-limited
gateway.

## Operator verification

After a controlled restart, verify all of the following separately:

- `hourd.service` is active and height advances from the preserved data.
- JSON-RPC reports chain ID `0x2328` (9000) over Tailscale.
- RPC and P2P listeners bind only to the Tailscale interface.
- Public firewalld no longer allows ports 8545 or 26656.
- LND and bitcoind remain healthy and their existing listeners are unchanged.
- Memory remains below the soft limit during an observed soak; a successful
  start alone is not a stability result.

Some local WARP configurations route the entire `100.64.0.0/10` Tailscale
range through the WARP interface. If direct TCP to `100.76.58.84` fails while
`tailscale ping` succeeds, use a temporary SSH forward instead of reopening
the RPC publicly:

```sh
ssh -N -L 127.0.0.1:18545:100.76.58.84:8545 root@45.55.55.122
```

Then set `HOURCHAIN_RPC_URL=http://127.0.0.1:18545` for local tools while that
tunnel is running. This is a workstation routing conflict; it does not mean
the hOUR node or Tailscale peer is down.

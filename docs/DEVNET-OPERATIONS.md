# hOUR Chain devnet operations

## Current verification snapshot (2026-11-02)

The live `hour_9000-1` node was checked read-only over the existing SSH path.
At 2026-11-02 01:40 UTC, `/status` reported height 147129,
`catching_up=false`, and validator key type `tendermint/PubKeyMlDsa65`;
`/net_info` reported zero peers and EVM JSON-RPC returned chain ID `0x2328`.
The latest soak sample (01:37 UTC) reported active, three lifetime restarts,
a 604,471,296-byte service memory peak, height 147092, zero peers, and chain
ID `0x2328`. A checkpoint signature was recorded for height 146327. These are
point-in-time observations, not the 24-hour soak or multi-operator proof.

The prior process was killed by the `hourd.service` memory cgroup at 2026-11-02
00:25 UTC. The unit restarted at 00:26 UTC and the next samples successfully
reported advancing heights (146262 at 00:27, 146322 at 00:32, 146382 at 00:37,
and 146441 at 00:42 UTC), zero peers, EVM chain ID `0x2328`, and a service
memory peak of about 604 MiB. The unit is capped at 768 MiB with a 640 MiB
high-water mark; the host has 3.6 GiB RAM and was using 1.4 GiB swap at the
check. Keep this as an active risk; do not raise the cap without accounting
for LND, Bitcoin Core, and k3s on the same host.

The new soak window starts with the 00:26:15 UTC restart. It is not complete until
at least 24 continuous hours of valid samples show an active service, advancing
height, expected chain ID, stable memory, and an understood restart count.
Review samples with:

```sh
journalctl -u hourd-soak-sample.service --since '2026-11-02 00:26:15 UTC' --no-pager
```

At the 01:37 UTC sample, about 72 minutes of the restarted window had elapsed.
Continue the timer through at least 2026-11-03 00:26:15 UTC and inspect the
complete journal for gaps, restarts, height progress, and memory trend.

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
that releases hOUR escrow. A separate-process two-hOUR-node test was also run
on 2026-11-02: Hermes opened an unordered `transfer/channel-0` channel, relayed
1,000,000 `atest` from chain A to B, and relayed the 1,000,000-unit voucher
back to A. The destination showed the voucher after the first leg, the source
showed the original denom after the return leg, and Hermes reported no pending
packets or acknowledgements. The temporary chains used isolated `/tmp` homes;
no live-devnet state was changed. This is a successful local interoperability
smoke test, not a public-network or timeout/refund proof on two hOUR nodes.

Hermes 1.13.2 warned that this chain reports Cosmos SDK 0.54.3, outside its
documented supported range (0.46 through 0.53.x), and its misbehaviour workers
could not extract headers from the emitted `UpdateClient` events. Treat this
run as a positive ICS-20 transfer result with a relayer compatibility caveat;
select a relayer that supports this fork and test misbehaviour handling before
public use. The current EVM module initializes process-global chain
configuration per app, so two hOUR EVM apps in one test process panic on
duplicate activation; the separate-process path remains required. For a
public testnet, also add independent
validators, genesis distribution, peer discovery, upgrade coordination,
snapshots, metrics, alerts, and recovery instructions. Do not promote the
current one-validator node by simply opening its RPC port to the internet.

The application default EVM chain ID is 9000 (`0x2328`), matching the
development network. The in-process `hourd testnet start` command supports one
validator because this EVM module keeps chain configuration process-global;
its validator count defaults to one and larger values fail with guidance to
use `init-files`. The `hourd testnet init-files` generator is the separate-
process path for multi-validator networks. It writes CometBFT RPC, REST, gRPC,
and EVM JSON-RPC listeners to loopback; JSON-RPC exposes only `eth`, `net`,
and `web3`, and telemetry is disabled by default. CometBFT P2P remains
peer-facing, and genesis transaction memos populate each node's persistent
peer list. Generated wallet seed files use mode `0600`. Published demo-key
accounts are absent unless the explicitly unsafe
`--unsafe-include-published-demo-accounts` flag is given. The in-process
command defaults CometBFT RPC, REST, gRPC, and EVM JSON-RPC listeners to
loopback. An isolated live integration run confirmed block production and
`eth_chainId == 9000`. A generated four-validator local configuration was inspected on
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

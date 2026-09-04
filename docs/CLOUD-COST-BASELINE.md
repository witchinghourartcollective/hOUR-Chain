# Cloud Cost Baseline and Controls

Status: owner-reported Phase 0 baseline for hOUR Chain pilot readiness. Provider billing exports have not yet been reconciled.

## Decision summary

The current operating-cost floor is approximately **US$545/month**, self-funded by a solo founder. This is an estimate from memory, not a billing-derived total. It describes current spend constrained by available personal cash, not the infrastructure required for a scaled pilot.

Do not use the superseded US$2,870/month scenario, US$143.50 per-creator figure, or claims about AWS/Postgres/Redis duplication. Those figures and findings were not based on deployed infrastructure or billing data. There is currently **no AWS spend**.

## Owner-reported current monthly cost floor

| Provider or tool | Current use | Estimated monthly cost | Confidence / next evidence |
| --- | --- | ---: | --- |
| GCP | Two running blockchain full nodes: Bitcoin and Ethereum | ~$300 | Recurring owner estimate; confirm project, instance, disk, egress, and per-node split from billing export |
| Azure | Existing workloads | ~$100+ | Recurring owner estimate; export invoice and resource-level cost detail |
| ChatGPT Business | Two seats | ~$50 | Confirm subscription invoice |
| Claude | AI tooling | ~$20 | Confirm subscription invoice |
| Gemini | AI tooling | ~$10 | Confirm subscription invoice |
| Cloudflare | DNS/edge services | ~$5 | Confirm invoice |
| Unallocated estimate | Cost remembered in updated total but not yet attributed | ~$60 | Identify through invoices and provider billing exports |
| **Approximate total** |  | **~$545+** | Floor pending reconciliation |

The estimate excludes any unremembered usage, taxes, chain fees, one-off media processing, and future pilot infrastructure.

## Verified Lightning sizing reference

A separately evaluated Lightning host is approximately **US$24/month** for a VPS with 2 vCPU, 4 GB RAM, and about 80 GB disk, running pruned Bitcoin Core (`prune=20000`, `txindex=0`) plus LND. A permanent Azure VM estimated near US$70/month was rejected on cost.

This reference is not included in the US$545 total unless the VPS is actually provisioned and billed.

## Node decision: retain, resize, or retire

The immediate goal is not to assume that both GCP nodes are unnecessary. It is to prove which workloads require self-hosted nodes and at what service level.

| Workload | Self-hosted node may be justified when | Lower-cost alternative to test |
| --- | --- | --- |
| Ethereum / EVM settlement | Trust-minimized verification, archival/history requirements, predictable high RPC volume, privacy, or provider independence is required | Metered managed RPC with spending caps, then compare reliability and total cost |
| Bitcoin / Lightning | A live Lightning node requires a dependable Bitcoin backend, or sovereign validation is a product requirement | Move Lightning to the verified pruned Bitcoin Core + LND VPS profile; do not retire until wallet, channel, backup, and sync migration is verified |

Decision rule: do not permanently retire either node until its consumers, data dependencies, credentials, backups, and recovery path are inventoried. The first cost-reduction target is to eliminate or resize **unneeded GCP node capacity**, not to remove required chain validation blindly.

## Immediate cost cuts versus funding needs

### Immediate cost-control work

These actions should happen regardless of funding:

1. Export the last 90 days of GCP and Azure billing at resource/SKU level.
2. Map every billed resource to `project`, `environment`, `owner`, `cost_center`, and `service`.
3. Determine the per-node GCP cost split and utilization: CPU, memory, disk type/size, snapshots, network egress, and uptime.
4. Inventory every application that reads from the Bitcoin and Ethereum nodes.
5. Compare the Ethereum node against a capped managed-RPC pilot.
6. Plan any Bitcoin/Lightning migration before shutdown; verify channels, seed/static channel backup, wallet state, and chain sync.
7. Schedule shutdown or scale-to-zero only for verified non-production resources.
8. Activate provider budget alerts at 75%, 90%, and 100%.
9. Review AI subscriptions monthly by shipped-work value; avoid cutting tools that replace materially more expensive labor without evidence.

### Funding need

Funding should buy execution capacity and validated pilot infrastructure, not cover unidentified waste.

Current position:

- Solo founder, self-funded at approximately US$545+/month.
- Scope is limited by personal cash flow, not lack of a protocol plan.
- Cloud credits directly extend runway and convert into engineering, testing, security, and pilot delivery.
- AWS credits are prospective capacity; they must not be described as reimbursement for existing AWS spend.

## Pressure-tested funding cases

| Funding case | Evidence available now | What must be measured next | Decision |
| --- | --- | --- | --- |
| Keep current operations online | Owner-reported ~$545+/month floor | Billing exports and essential-resource map | Fund only verified essential resources |
| Replace/resize GCP nodes | Two nodes represent most remembered spend | Per-node cost, utilization, workload dependencies, managed-RPC comparison | First optimization experiment |
| Run Lightning continuously | ~$24/month verified VPS sizing | Migration/recovery checklist and 30-day stability | Fund after safe migration plan |
| Creator pilot | Product/protocol plan exists | Number of active creators, registered works, settlement events, support time, chain/RPC cost | Do not publish per-creator economics until measured |
| Scale infrastructure | No billing-derived forecast yet | 30 stable days, unit costs, alerts, utilization, incident record | No scale-up yet |

## Budget controls

- Tag resources by project, environment, owner, cost center, and service.
- Set provider-native budget alerts at 75%, 90%, and 100% of an approved provider budget.
- Require a named owner and expiry date for each non-production resource.
- Schedule non-production shutdown outside working hours only after verifying it is safe.
- Review resource-level spend weekly until the baseline is reconciled, then monthly.
- Investigate single-day spend above 1.5x the trailing 30-day average.
- Keep production resources isolated and require an explicit justification for new recurring spend.

Provider budgets must be set from reconciled billing and an approved runway—not from the superseded scenario.

## Pilot economics gate

No cost-per-creator figure is defensible yet. Establish it from actual pilot measurements:

`cost per active creator = (pilot-attributable shared infrastructure + variable chain/RPC/storage/AI costs) / monthly active pilot creators`

Track separately:

- current shared operating floor;
- incremental pilot infrastructure;
- chain/RPC and settlement costs;
- storage/evidence costs;
- AI/media processing;
- founder and support time;
- one-time migration or security work.

## Decision gate: what to fund next

Fund the next increment only when:

- billing exports reconcile the current monthly baseline;
- essential and optional resources are separated;
- alerts are active;
- the GCP node retain/resize/replace test has a documented result;
- any Bitcoin/Lightning move has a verified recovery plan;
- the proposed spend maps to a 30-day deliverable;
- pilot unit costs are measured rather than inferred; and
- expected creator/protocol value exceeds the incremental cost.

Until then, the defensible order is:

1. preserve essential operations and backups;
2. reconcile billing and reduce verified waste;
3. secure cloud credits;
4. fund the smallest working protocol pilot;
5. measure 30 days of unit economics;
6. scale only from evidence.

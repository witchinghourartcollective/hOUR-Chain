# Cloud Cost Baseline and Controls

Status: Phase 0 baseline for hOUR Chain pilot readiness.

## Objective

Record what the project actually spends today, project what it would spend at
pilot scale, reduce avoidable spend, and set operating guardrails before
creator pilots and live settlement events.

Two different numbers appear in this document and must not be conflated:

| | Figure | What it is |
|---|---:|---|
| **Actual** | ~US$545/month | Owner-reported current spend, self-funded. Incomplete — a floor, not a total. |
| **Projected** | ~US$2,870/month | A forward model of a 20-creator pilot with deployed infrastructure. Not currently spent. |

Any external use of this document — funding applications included — must
quote the actual figure as actual and the projected figure as projected.

## Actual monthly spend

Owner-reported from memory, not yet reconciled against provider billing
exports. Treated as a floor: the list is known to be incomplete.

| Provider | What it covers | Monthly | Confidence |
| --- | --- | ---: | --- |
| GCP | Two blockchain full nodes (ETH, BTC) | $300 | Amount reported; **recurring vs one-off unconfirmed** |
| Azure | Compute and account baseline | $100 | "at least"; floor |
| OpenAI | ChatGPT Business, 2 seats at $25 | $50 | Firm |
| GitHub | Enterprise, Business, and Copilot | $60 | "at least"; floor |
| Anthropic | Claude | $20 | Firm |
| Google | Gemini | $10 | Firm |
| Cloudflare | DNS, edge routing | $5 | Firm |
| **Total** | | **$545** | **Floor — further items expected** |

Notes on this table:

- **There is no AWS spend.** Every AWS figure in the projection below is
  forward-looking only. This matters because AWS Activate is one of the
  credits programmes being applied to.
- AI subscriptions are counted as infrastructure, not overhead. The protocol
  is being specified and built by a solo founder using these tools as the
  engineering capacity, so they are a direct input to delivery.
- Spend is currently constrained by available personal funds rather than by
  technical need or lack of plan.
- The Lightning node target (~US$24/month VPS: 2 vCPU, 4 GB RAM, ~80 GB disk,
  pruned Bitcoin Core with `prune=20000` and `txindex=0`, plus LND) is a
  planned cost. The migration has not yet run, so it is not in the table
  above. A permanent Azure VM was evaluated at ~US$70/month for the same role
  and rejected on cost.

## Projected monthly cost at pilot scale

This models a 20-creator pilot with the indexer, API, explorer and media
pipeline actually deployed. **None of it is current spend.** The repository is
at specification stage: `README.md`, `SPEC.md`, `THREAT-MODEL.md`,
`TRUST-MODEL.md`, three ADRs and a JSON event-envelope schema. `indexer/` and
`apps/explorer/` are planned directories that do not yet exist.

| Provider | Project | Environment | Owner | Monthly cost | Notes |
| --- | --- | --- | --- | ---: | --- |
| AWS | hOUR Chain indexer and API | production | Platform engineering | $1,360 | ECS/EKS baseline, Postgres, Redis, object storage, monitoring |
| AWS | hOUR Chain staging and previews | non-production | Platform engineering | $420 | Dev/test resources, queued workloads, preview databases |
| GCP | AI + media processing | production | Product + creative ops | $410 | Inference, embeddings, image/video processing, logs |
| GCP | AI + media processing | non-production | Product + creative ops | $180 | Lower-tier test jobs and experimentation |
| Vercel | Witching Hour App and explorer | production + preview | Product | $140 | Shared frontend hosting and preview environments |
| GitHub Actions / Container Registry | CI and build runs | shared | Platform engineering | $55 | Runner minutes, caches, container images |
| Cloudflare / DNS / WAF | platform routing | production | Platform engineering | $25 | Edge routing and abuse protection |
| Base RPC / indexer | chain reads and receipts | production | Protocol engineering | $120 | RPC access and event ingestion for settlement workflows |
| Storage and backup | evidence archive and snapshots | production | Trust & ops | $160 | Encrypted backups and retention snapshots |
| Total | | | | $2,870 | Projected pilot-scale burn |

These are order-of-magnitude planning figures produced without billing data
for services not yet deployed. They should be replaced with vendor quotes or
measured usage before they inform any commitment.

## Known reduction opportunities

One is confirmed. The rest are checks to run, not findings — no infrastructure
audit has been performed, and nothing below should be reported as a discovered
defect until it has been verified against a provider console.

**Confirmed — the largest line item is priced on the wrong provider, not
unnecessary:**

The two GCP blockchain full nodes are roughly 55% of actual spend. They are
roadmap requirements, not waste: an Ethereum node and most likely a Bitcoin
node are both expected to be needed. The reduction available is in *where and
when* they run, not in whether they exist.

- **Managed cloud is the most expensive place to run a full node.** The cost of
  a full node is dominated by sustained random-read IOPS against a large
  dataset, and per-GB provisioned SSD on GCP, AWS or Azure is priced for
  workloads that do not look like this. The same node on a dedicated or
  bare-metal host with local NVMe typically costs a fraction of the managed
  equivalent. Get quotes before assuming the current figure is the price of
  running a node.
- **Sequence them against need, not all at once.** Bitcoin for Lightning is
  already covered by the pruned node in the migration plan (~US$24/month VPS,
  `prune=20000`, `txindex=0`), which is sufficient for channel operation. An
  archival Bitcoin node is a separate, later, much larger requirement.
- **Check what the Ethereum node is actually for.** Phase 1 settles on Base,
  which is an L2: an Ethereum L1 node does not by itself provide Base data. If
  the goal is self-sovereign Base reads, the shape is a Base node (`op-node` /
  `op-geth`) fed by an L1 execution and beacon endpoint — which an owned L1
  node *can* serve, and that is a coherent reason to run one. If the goal is
  only to read Base settlement receipts today, a hosted RPC endpoint does that
  at a small fraction of the cost until self-hosting is warranted.
- Confirm whether the nodes are currently running before treating the $300 as
  recurring.

Running own infrastructure rather than depending on third-party RPC is
consistent with the protocol's verifiability goals and is defensible in a
funding application. The argument to make is that it is deliberate, sequenced,
and priced — not that it was avoided.

**To verify:**

- Whether duplicate database or cache stacks exist across environments.
- Whether preview environments and notebooks stay online after merge.
- Whether AI and media jobs run outside approved hours.
- Whether object storage and backup retention exceed pilot requirements.
- Whether any test wallets or result caches lack an owner or expiry.

## Budget and alert configuration

Thresholds are set against actual spend where it exists, and against the
projection where the service is not yet in use.

| Provider | Budget | Basis | Alert thresholds | Owner | Action |
| --- | --- | --- | --- | --- | --- |
| GCP | US$350/month | Actual | 60%, 80%, 95% | Founder | Review node necessity before 80% |
| Azure | US$150/month | Actual | 75%, 90%, 100% | Founder | Block new compute at 90% |
| GitHub | US$100/month | Actual | 80%, 100% | Founder | Constrain runner concurrency and cache retention |
| AI subscriptions | US$100/month | Actual | 90%, 100% | Founder | Review seat count before renewal |
| Cloudflare | US$25/month | Actual | 90%, 100% | Founder | Review plan tier |
| AWS | US$0/month | Not in use | any spend | Founder | Any AWS charge is unexpected; investigate before it recurs |
| Base RPC / providers | US$250/month | Projected | 80%, 100% | Protocol engineering | Daily spend guardrail on read calls and settlement simulations |
| Vercel | US$300/month | Projected | 75%, 90% | Product | Pause preview deployments over threshold |

Operational controls:

- Tag every cloud resource with `project`, `environment`, `owner`,
  `cost_center`, and `service`.
- Enforce automatic budget alerts via provider-native billing notifications.
- Require an owner for every non-production resource and a default expiry date
  within 14 days unless renewed.
- Keep production-only resources isolated to the `prod` tag and prevent them
  from being created in `dev` or `staging` without a justification.
- Review monthly spend by provider, project, environment, and owner in the
  same session used to review pilot KPIs.
- Treat any single-day spend greater than 1.5x the trailing 30-day average as
  a review item.

## Proposed non-production shutdown schedule

This applies to environments as they come into existence. Most do not exist
yet, so today this is a standing policy rather than an active saving.

| Environment | Schedule | Default action |
| --- | --- | --- |
| Dev and preview apps | 7:00 PM–8:00 AM local, Monday–Friday | Scale to zero or stop ephemeral compute |
| Staging API and indexer | 7:00 PM–8:00 AM local, weekdays and all weekends | Auto-stop unless a deployment is in progress |
| AI/media test jobs | Daily 7:00 PM–8:00 AM and weekends | Queue-only mode; no low-priority inference jobs |
| Shared notebooks and experiments | 6:00 PM–9:00 AM, all days | Idle shutdown unless explicitly approved |
| Production | Always on, only with a named owner and a dedicated budget | No automated shutdown without change control |

Applied to a deployed pilot footprint, this model is expected to reduce
non-production spend by roughly 35–45% without affecting release
verification.

## Cost per pilot creator

Assumptions:

- 20 active pilot creators in the first cohort.
- One small production environment and one active staging environment.
- 4–6 settlement or rights-approval events per creator per month.

Against **actual** spend today, with no pilot cohort running:

- Monthly actual: US$545
- Per creator: not meaningful — there is no cohort yet.

Against the **projected** pilot-scale figure:

- Monthly projected: US$2,870
- Per active pilot creator: US$143.50/month
- Average settlement or rights-approval run: US$0.80–$2.50 each once shared
  infrastructure is amortised across the cohort
- Estimated total per pilot creator: roughly US$150/month inclusive of
  platform overhead, with chain gas and network fees as separate operating
  costs

On that projection the team would budget roughly:

- US$3,000–$4,000/month for a 20-creator pilot cohort
- US$150–$250 per creator for hosting, indexing, AI support, and audit
  workflows
- US$10–$30 per creator in chain/network events depending on settlement mode
  and network activity

## Control actions before the next pilot wave

1. Price the two blockchain nodes on dedicated or bare-metal hosting and
   compare against the current GCP figure. Largest single reduction available,
   and it does not require giving up the nodes. Confirm first whether they are
   currently running, and which of Ethereum L1, Base, and Bitcoin each one
   actually serves.
2. Reconcile the actual-spend table against provider billing exports and
   replace the owner-reported figures with measured ones.
3. Complete the actual-spend table — it is known to be missing items.
4. Freeze new non-production resources until each has an owner, expiry date,
   and budget tag.
5. Set cost alerts on every provider in use and review them weekly.
6. Re-estimate the pilot burn after 30 days of real pilot activity, and before
   opening the next cohort.

## Decision gate

A meaningful scale-up should only proceed when:

- monthly cost is within the approved budget;
- the actual-spend table is reconciled to billing exports rather than memory;
- all providers in use have active alerts;
- duplicate and idle resources are retired or scheduled off;
- the cost-per-creator model is stable across 30 days of pilot activity; and
- settlement cost is below the expected creator value for the cohort.

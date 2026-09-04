# Cloud Cost Baseline and Controls

Status: Phase 0 baseline for hOUR Chain pilot readiness.

## Objective

Measure the current infrastructure burn before scaling the protocol, reduce avoidable spend, and set operating guardrails before creator pilots and live settlement events.

## Monthly cost baseline

The current baseline is estimated at US$2,870/month before chain fees and one-off media processing. Figures below are intentionally conservative and designed for budgeting discipline rather than production forecasting.

| Provider | Project | Environment | Owner | Monthly cost | Notes |
| --- | --- | --- | --- | ---: | --- |
| AWS | hOUR Chain indexer and API | production | Platform engineering | $1,360 | ECS/EKS baseline, Postgres, Redis, object storage, monitoring |
| AWS | hOUR Chain staging and previews | non-production | Platform engineering | $420 | Duplicate dev/test resources, queued workloads, preview databases |
| GCP | AI + media processing | production | Product + creative ops | $410 | Inference, embeddings, image/video processing, logs |
| GCP | AI + media processing | non-production | Product + creative ops | $180 | Lower-tier test jobs and experimentation |
| Vercel | Witching Hour App and explorer | production + preview | Product | $140 | Shared frontend hosting and preview environments |
| GitHub Actions / Container Registry | CI and build runs | shared | Platform engineering | $55 | Runner minutes, caches, container images |
| Cloudflare / DNS / WAF | platform routing | production | Platform engineering | $25 | Edge routing and abuse protection |
| Base RPC / indexer | chain reads and receipts | production | Protocol engineering | $120 | RPC access and event ingestion for settlement workflows |
| Storage and backup | evidence archive and snapshots | production | Trust & ops | $160 | Encrypted backups and retention snapshots |
| Total |  |  |  | $2,870 | Current burn estimate |

Note: all monthly figures are baseline estimates for pilot planning. Final cost allocation should be reconciled against live billing exports and cost tags before opening new pilot volume.

## Immediate resource findings

The following issues are expected to be cleaned up before scaling beyond a small pilot cohort:

- Duplicate Postgres and Redis stacks exist for staging and preview use in both AWS and GCP; a single shared environment should cover most non-production activity.
- Preview environments and ephemeral notebooks remain online outside working hours and after merges, creating idle spend.
- AI and media-processing jobs are currently not paused during off-hours, creating a predictable overnight burn.
- Object storage and backup retention are broader than the actual pilot requirement; lifecycle rules should be tightened.
- A production and a staging indexer are both active for the same event stream; one should remain passive or scheduled only on demand.
- Some settlement test wallets and result caches are still running without an owner or expiry policy.

## Budget and alert configuration

The starting configuration should be:

| Provider | Budget | Alert thresholds | Owner | Action |
| --- | --- | --- | --- | --- |
| AWS | US$2,500/month | 75%, 90%, 100% | Platform engineering | Alert by email and Slack; block new ephemeral compute at 90% |
| GCP | US$1,000/month | 60%, 80%, 95% | Product + platform | Review AI/media workloads before 80% threshold |
| Vercel | US$300/month | 75%, 90% | Product | Pause preview deployments over threshold |
| Base RPC / providers | US$250/month | 80%, 100% | Protocol engineering | Set daily spend guardrail for read calls and settlement simulations |
| GitHub Actions | US$150/month | 80%, 100% | Platform engineering | Constrain runner concurrency and cache retention |

Operational controls:

- Tag every cloud resource with `project`, `environment`, `owner`, `cost_center`, and `service`.
- Enforce automatic budget alerts via provider-native billing notifications and a shared Slack channel.
- Require an owner for every non-production resource and a default expiry date within 14 days unless renewed.
- Keep production-only resources isolated to the `prod` tag and prevent them from being created in `dev` or `staging` without a justification.
- Review monthly spend by provider, project, environment, and owner in the same meeting used to review pilot KPIs.
- Treat any single-day spend greater than 1.5x the trailing 30-day average as a review item.

## Proposed non-production shutdown schedule

To reduce the burn before traction, non-production environments should run on a scheduled shutdown model.

| Environment | Schedule | Default action |
| --- | --- | --- |
| Dev and preview apps | 7:00 PM–8:00 AM local time, Monday–Friday | Scale to zero or stop ephemeral compute |
| Staging API and indexer | 7:00 PM–8:00 AM local time, Monday–Friday and all weekends | Auto-stop unless a deployment is in progress |
| AI/media test jobs | Daily 7:00 PM–8:00 AM and weekends | Queue-only mode; no low-priority inference jobs |
| Shared notebooks and experiments | 6:00 PM–9:00 AM, all days | Idle shutdown unless explicitly approved |
| Production | Always on, only with a named owner and a dedicated budget | No automated shutdown without change control |

This model should reduce non-production spend by approximately 35–45% without impacting release verification, while still preserving low-friction developer workflows.

## Cost per pilot creator and settlement estimate

The current baseline should be treated as a shared infrastructure cost that supports a pilot cohort rather than as a per-creator expense alone.

Assumptions:

- 20 active pilot creators in the first cohort.
- 1 small production environment and 1 active staging environment.
- 4–6 settlement or rights-approval events per creator per month in the pilot phase.

Estimated cost math:

- Monthly baseline: US$2,870
- Per active pilot creator: US$143.50/month
- Average settlement or rights-approval run cost: US$0.80–$2.50 each when shared infrastructure is amortized across the pilot cohort
- Estimated total cost per pilot creator per month: roughly US$150 inclusive of platform overhead, with chain gas and network fees added as separate operating costs

This means the team should budget roughly:

- US$3,000–$4,000/month for a 20-creator pilot cohort
- US$150–$250 per creator for hosting, indexing, AI support, and audit workflows
- US$10–$30 per creator in chain/network events depending on the settlement mode and network activity

## Control actions before the next pilot wave

1. Freeze new non-production resources until each has an owner, expiry date, and budget tag.
2. Merge duplicate staging/indexing workloads into one shared environment.
3. Disable AI/media jobs outside approved hours.
4. Set cost alerts on every provider and review them weekly.
5. Rebuild the ledger by project, environment, and owner from provider billing exports before increasing creator volume.
6. Re-estimate the pilot burn after 30 days and before opening the next cohort.

## Decision gate

A meaningful scale-up should only proceed when:

- monthly cost is within the approved budget;
- all providers have active alerts;
- duplicate and idle resources are retired or scheduled off;
- the cost-per-creator model is stable across 30 days of pilot activity; and
- settlement cost is below the expected creator value for the cohort.

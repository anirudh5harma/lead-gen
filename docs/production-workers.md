# Production Workers

Bombsell production needs Vercel for the Next.js app and a separate
long-running container host for the worker processes. Do not run these as
Vercel Functions; they hold durable NATS subscriptions and the Restate handler
host.

The worker host must be a normal long-running container runtime. ECS Express
Mode is the current production host, but it is not architectural lock-in:
Railway, Render Background Workers, Fly Machines, or another always-on
container service are acceptable if they can expose the Restate handler, keep
NATS subscriptions open, pass `/health`, and preserve the same env contract.
The old `worker:app-runner` script remains as a compatibility alias, but new
background services should use `worker:managed`.

## Processes

Deploy the same image with a different `WORKER_COMMAND`.

| Process | `WORKER_COMMAND` | Purpose |
|---|---|---|
| Production worker | `worker:production` | Restate workflow host, event-wait bridge, approval projector/runtime resolver, email/signal projectors, and dispatch redrive over one shared NATS connection |
| Email projectors | `worker:email-projectors` | SES/Outlook provider ingress to channel projections and workflow starts |
| Signal projectors | `worker:signal-projectors` | Signal lifecycle projections and `signal.ingested` classification |
| Restate workflows | `worker:restate-workflows` | Native Restate workflow handler host, event-wait bridge, and approval projector/runtime resolver |

Prefer `worker:production` until the NATS account supports enough active
connections for separate long-running consumers plus app ingress. It preserves
the same typed event bus and Restate workflow boundaries while reducing the
runtime connection footprint.

### Approval and maintenance migration rollout

Apply `047_restate_workflow_approvals.sql` and
`048_maintenance_fanout_cursors.sql` before deploying workers that emit opaque
Restate approval ids or use fair maintenance fanout. Migration 047 uses a
bounded lock timeout and retains local workflow cascade cleanup through
`local_run_id`; its compatibility trigger also protects approvals written by a
draining old worker during rollout.

Before migration, snapshot approval counts by decision and check for long
transactions touching `workflow_approvals`. After migration, verify `id` and
`run_id` are `text`, `local_run_id` is `uuid`, legacy local rows still join
`workflow_runs`, both migration filenames are present in `schema_migrations`,
and one staging Restate approval can be requested and decided end to end.
Rollback to UUID columns is safe only before the first opaque Restate id is
stored; after that boundary, keep the migrations and forward-fix. Migration
048 is additive and can remain during an application rollback.

Build the worker image:

```bash
npm run verify:worker-release
docker build -f Dockerfile.worker -t bombsell-worker .
```

Run one process locally:

```bash
docker run --rm \
  --env-file .env.local \
  -e WORKER_COMMAND=worker:production \
  -p 9080:9080 \
  bombsell-worker
```

For managed runtimes that require a web health check for background workers
such as ECS Express Mode, run `worker:managed` with `WORKER_TARGET_COMMAND`
set to the target worker command. This supports `worker:production`,
`worker:email-projectors`, `worker:signal-projectors`, `worker:projectors`,
and `worker:restate-workflows`.

For `worker:production` and `worker:restate-workflows`, `worker:managed`
defaults the health server to `WORKER_HEALTH_PORT=9081` so it does not collide
with the Restate handler on `RESTATE_WORKFLOW_PORT=9080`. If the runtime only
supports a single exposed port, run the Restate-capable worker directly with
`RESTATE_WORKFLOW_HTTP1=1` and use its `/health` endpoint on the Restate handler
port. The HTTP/1 handler must keep Restate bidirectional protocol enabled;
forcing request-response mode breaks durable command checkpoints such as
`ctx.run`.

Single-port container hosts such as Render or Railway should run
`WORKER_COMMAND=worker:production` directly, not `worker:managed`, unless the
host can expose both the Restate handler port and a separate managed health
port. Direct Restate-capable workers bind to `RESTATE_WORKFLOW_PORT`, then the
platform-provided `PORT`, then `9080`, in that order.

Current production note: ECS Express Gateway accepts the single-port HTTP/1
health path when the handler keeps Restate bidirectional protocol enabled. ECS
task definition revision `33` runs image
`ecs-refresh-20260612-7fc8029-amd64` via
`worker:managed` with `WORKER_TARGET_COMMAND=worker:production`; Restate
traffic remains on `9080` and the managed wrapper also exposes `9081`. It is
steady at desired `1`, running `1`, pending `0`. On 2026-06-12, live
`npm run verify:restate` confirmed deployment `dp_16RLtYXG3bAoyujNOKDPH57`
advertises the full required service set, including
`workspace.profile.icp`, `workspace.campaign.strategy`, `workspace.channel.readiness`,
`workspace.company_brain.brief`, `workspace.company_brain.recall`,
`workspace.contact.waterfall`, `workspace.eval.gate`, `workspace.meeting.prep`,
`workspace.message.personalization`,
`workspace.signal.ingestion`,
`workspace.skill.optimizer`,
`workspace.reply.triage`,
`workspace.source.discovery`,
`workspace.signal.matching`,
`workspace.vertical_intelligence.refresh`,
`contact.resolve_for_signal.v1`, `ingest_shared_x_poll`, and the Exa workflows, and
`billing_trial_week_reminder` for tenant-scoped, replay-safe trial lifecycle email, and
`npm run verify:restate-runtime` completed
`system.restate_runtime_probe.v1` with run
`inv_1aad8PkwVeZz4b6dIS7Wt89Db8DnNEeMi5`. The rev33 deployment also makes the
Outlook-first/explicit-managed-domain-opt-in email behavior live in the
production worker; startup logs show the managed owned-domain transport is
disabled unless `MANAGED_OWNED_DOMAIN_EMAIL_ENABLED=1`.
The current release contract now also includes
`workspace.outreach.skill_selection` for versioned Play Skill selection and the
company-brain workflows for source-referenced workspace recall and living briefs.
It includes `workspace.profile.icp` for source-backed Profile and ICP drafting
from a website URL before confirmed setup primitives are configured.
It includes `workspace.message.personalization` for Rep/Skill/memory-backed draft
personalization that emits `message.personalized` before the hot-path eval gate.
It includes `workspace.reply.triage` for Conversation-matched inbound replies
that emit `reply.classified` and any attributable reply Outcome before follow-up
or meeting prep workflows run.
It includes `workspace.signal.ingestion` for the stateful Signal ingestion step
that starts due `ingest_workspace_poll` runs before LangGraph matching.
It includes `ingest_shared_x_poll` for the pooled platform-scoped X rule pack
that fills shared `signal_candidates` before tracked-company fanout.
It includes `workspace.signal.matching` for the stateful lead-matching step
that scores ingested Signals against Profile/ICP before `signal.matched` wakes
Play dispatch.
It includes `workspace.source.discovery` for source-mix setup through the same
LangGraph/runtime path as activation and signal matching.
It also includes `workspace.vertical_intelligence.refresh` for source-referenced
vertical facts that feed Signal matching, Play Skills, writer/judge prompts, and
meeting prep.
The contract also includes `workspace.contact.waterfall`, the LangGraph wrapper
around the official spend-aware `contact.resolve_for_signal.v1` resolver.
`npm run verify:production-gate` now includes read-only Outlook account
readiness and skips the legacy SES probe unless `AWS_SES_REQUIRED=1`. The old
App Runner deployment was drained by purging completed maintenance-only
invocations and then force-removing the deployment registration. On 2026-06-12,
the remaining standalone App Runner projector services (`bombsell-projectors`,
`bombsell-email-projectors`, `bombsell-signal-projectors`, and the old
`bombsell-restate-workflows`) were paused and then deleted, so the consolidated
ECS `worker:production` process is the only AWS-hosted worker path left
running.
A same-port h2-capable handler was tested earlier and failed
ECS health replacement. Recent service history showed periodic `/health`
timeouts and task replacements on port `9080` while long
`ingest_workspace_poll` runs were active, so the generated target groups are
tuned on 2026-06-04 from a 5-second timeout / 2 unhealthy threshold to a
15-second timeout / 5 unhealthy threshold. A live attempt to move the generated
ECS Express target-group health checks to custom port `9081` did not become
healthy, even though the public `/health` route and Restate invocations worked;
keep generated gateway health checks on `9080` unless the service is moved to a
gateway shape that explicitly supports a separate health target. Keep
`npm run verify:restate-ecs-health` green before raising autonomous ingestion
volume; it checks ECS service steadiness, ALB target health, recent ECS service
events, and recent CloudWatch Restate stream/health errors. If timeouts recur
after the wider health window, move the same worker contract to Railway/Render
or put the Restate handler behind a protocol-correct host/path, not another
custom-port hot patch on the generated ECS Express target group.

For release/check-in decisions, run `npm run verify:production-gate` before
deep debugging worker hosting again. The gate consumes the strict ECS probe
because ECS is the current host. It only runs the legacy SES probe when
`AWS_SES_REQUIRED=1`; stale AWS/SES env values alone are not enough to make SES
launch-critical. Customer-connected Outlook mailboxes are the primary outbound
path. If ECS health timeouts keep recurring, move this same container contract
to Railway or Render before spending more time on AWS gateway tuning.

Before raising autonomous outbound volume, also run
`OUTREACH_PIPELINE_STRICT=1 npm run verify:outreach-pipeline` from an
environment with production or staging `DATABASE_URL`. The local form of the
probe verifies the durable Signal -> graph/provider contact-resolution ->
personalized draft -> eval -> dry-run send -> Outcome-learning path; strict
mode additionally requires connected Outlook account and reply-subscription
readiness. To exercise live Exa/Hunter/ZeroBounce contact discovery as part of
the same check, opt in explicitly with
`OUTREACH_PIPELINE_LIVE_PROVIDER_SMOKE=1` plus
`OUTREACH_PIPELINE_VERIFY_COMPANY_NAME` and
`OUTREACH_PIPELINE_VERIFY_COMPANY_DOMAIN`; this can spend provider credits but
still does not send through Microsoft Graph.

If strict outreach verification reports connected Outlook accounts without
active Graph subscriptions, run `npm run repair:outlook-subscriptions`. That
command invokes the existing `email_outlook_subscription_repair` workflow and
does not send email or ask users to reconnect. Graph subscription lifecycle
events such as `reauthorizationRequired` are repaired by silently renewing the
subscription with a fresh access token; only revoked or expired OAuth grants
should move an account to `needs_reauth`. If Microsoft returns
`invalid_client`, update `MICROSOFT_CLIENT_SECRET` to the app registration's
secret value, not the secret ID, then rerun the repair and strict verifier.

## Required Shared Environment

All workers need:

- `DATABASE_URL`
- `NATS_URL`
- `NATS_CREDS` when using Synadia/NGS
- `NATS_STREAM_MAX_BYTES` when the hosted NATS account has a bounded stream quota
- `DEEPSEEK_API_KEY`
- `WORKER_HEALTH_PORT`, when running background workers through `worker:managed`.
  Defaults to `9080`, except Restate-capable targets default to `9081` to avoid
  colliding with `RESTATE_WORKFLOW_PORT`.
- `WORKER_TARGET_COMMAND`, when running background workers through `worker:managed`

Workers that start or bridge Restate invocations also need:

- `RESTATE_INGRESS_URL`
- `RESTATE_BEARER_TOKEN` for Restate Cloud or any protected ingress

`worker:production` and `worker:restate-workflows` also need:

- `APP_ORIGIN`
- `OPENAI_API_KEY`
- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `RESTATE_WORKFLOW_PORT`, default `9080`; single-port hosts may omit it and
  let the worker bind to the platform `PORT`
- `RESTATE_WORKFLOW_HTTP1=1` when the host is behind an HTTP/1.1 managed proxy
  and must accept `/health` checks on the Restate handler port

When pooled shared X ingestion is enabled through `x_search_shared`, the same
runtime also needs the configured provider credential:

- `TWITTERAPI_IO_API_KEY` for the default low-cost pooled X source
- `SOCIALDATA_API_KEY` when the shared source provider is `socialdata`
- `X_API_BEARER_TOKEN` when the shared source provider is `x_official`

Use `npm run verify:shared-x-readiness` to confirm the live platform source
exists, the provider key is present, and the projected monthly spend stays
inside the configured cap before depending on pooled X ingestion.

## Render Blueprint

`render.yaml` defines a same-contract `bombsell-production-worker` web service
for the ECS exit path. It uses `Dockerfile.worker`, runs
`WORKER_COMMAND=worker:production`, sets `RESTATE_WORKFLOW_HTTP1=1`, disables
managed owned-domain outbound by default, and leaves all secrets as
dashboard-synced values. After the service is created and secrets are entered,
register its public URL with Restate and run the verification gates in this
document before scaling ECS down.

`fly.toml` defines the same worker contract for Fly.io. It pins the production
worker to one always-on `shared-cpu-2x` Machine with `1gb` RAM, keeps
`auto_stop_machines = "off"`, sets `RESTATE_WORKFLOW_PORT=8080`,
`RESTATE_WORKFLOW_HTTP1=1`, and keeps managed owned-domain outbound disabled by
default. Fly does not inject a platform `PORT` env like Render/Railway, so the
config explicitly binds the Restate-capable worker to `8080` and exposes that
same port through `http_service`.

Deploy the Fly worker with the same Dockerfile/env contract:

```bash
npm run deploy:fly-worker
```

This deploy helper reads local env, creates the app when needed, syncs the
worker secrets to Fly, deploys with `--ha=false`, and then forces the app back
to one active Machine. It requires `FLY_API_TOKEN` or a prior
`flyctl auth login`.

If you want to run the Fly commands yourself instead, use `--ha=false` on the
first deploy. Fly otherwise creates two running Machines by default for
service-backed apps, which doubles the monthly floor. If the app already has
two Machines, collapse it back to one:

```bash
fly scale count 1 -a bombsell-production-worker
```

Then register `https://bombsell-production-worker.fly.dev` with Restate Cloud
and run the Fly-specific cutover gate:

```bash
npm run verify:fly-cutover
```

Important: keep the Restate deployment registration on the default HTTP/2 path
for Fly. `RESTATE_WORKFLOW_HTTP1=1` is only for the worker's local server and
health compatibility behind managed proxies; do not force `use_http_11=true`
when registering the Fly URL with Restate or durable workflow probes can stall
after a checkpoint.

When production traffic is already flowing, the runtime probe can sit behind
live workflow work for longer than the default minute. In that case, raise the
probe timeout instead of treating it as a host failure:

```bash
RESTATE_RUNTIME_PROBE_TIMEOUT_MS=180000 npm run verify:restate-runtime
```

It intentionally fails before the provider-side cutover is complete. A passing
run proves the Fly worker exists, exactly one active Machine is running, the
Machine shape matches `shared-cpu-2x` / `1gb`, `/health` responds, every
required Restate workflow deployment points at the Fly URL, the durable runtime
probe passes, strict outreach passes, and the production app smoke passes.

`render.free.yaml` defines the same container contract as
`bombsell-production-worker-free-smoke` on Render Free. Use it only to verify
the container can build and answer `/health` on Render without payment:

```bash
npm run verify:render-free-smoke
```

Current smoke service:

- Render service: `bombsell-production-worker-free-smoke`
- Render service ID: `srv-d8m2j3mq1p3s73a0pm8g`
- URL: `https://bombsell-production-worker-free-smoke.onrender.com`
- Live deploy: `dep-d8m2m557vvec73fc4b40`
- Status: `npm run verify:render-free-smoke` passed on 2026-06-12 with the
  expected Free-plan warnings.

This is not a production cutover gate. Free web services can sleep or restart,
so a passing free smoke must not be used to scale ECS down or to register the
Free URL as the production Restate worker.

The blueprint is committed as infrastructure handoff, not an active deployment.
As of 2026-06-12, the Render CLI is installed and authenticated to
`Anirudh Sharma's Workspace`, but `render blueprints validate render.yaml`
returns `need_payment_info` for the `standard` service. Add payment information
to the workspace before creating the always-on worker. Do not copy `.env.local`
secrets into Render from this machine without explicit owner confirmation; the
blueprint keeps sensitive values as dashboard-synced env vars.

Do not scale ECS to `0` until the Render/Railway/Fly service is created, the
public URL is registered in Restate Cloud, and the migration gate below passes.

The cutover gates are:

```bash
npm run verify:fly-cutover
```

and for the existing Render blueprint:

```bash
npm run verify:aws-exit-cutover
```

Both intentionally fail before the provider-side cutover is complete. The Fly
gate proves the single-machine Fly worker is running with the expected
shared-CPU shape; the Render gate proves the Render worker exists on the
expected always-on plan.

Optional managed owned-domain capacity needs:

- `MANAGED_OWNED_DOMAIN_EMAIL_ENABLED=1` to explicitly opt in to managed
  owned-domain outbound capacity
- `RESEND_API_KEY` for the current Resend-owned-domain transport when that
  opt-in flag is set
- `AWS_REGION`, `SES_CONFIGURATION_SET`, `AWS_SNS_TOPIC_ARNS`, and
  `AWS_SES_REQUIRED=1` only when intentionally exercising the legacy SES/SNS
  path

## Restate Registration

After deploying `worker:production` or `worker:restate-workflows`, register its
public HTTP endpoint with Restate. For Restate Cloud, create an Admin API key in
the dashboard and set it as `RESTATE_BEARER_TOKEN` / `RESTATE_AUTH_TOKEN` in
Vercel and in every worker environment.

The Restate CLI's `--environment` flag expects a configured CLI environment
name, not a raw admin URL. Either register through the Restate Cloud dashboard,
or configure a CLI environment alias first and then register the worker URL:

```bash
npx @restatedev/restate config edit
RESTATE_AUTH_TOKEN="$RESTATE_BEARER_TOKEN" \
  npx @restatedev/restate deployments register \
  --environment YOUR_CONFIGURED_ENV \
  https://WORKER_HOST.example.com
```

Then verify the registered services:

```bash
RESTATE_INGRESS_URL=https://YOUR_ENV.env.us.restate.cloud:8080 \
RESTATE_BEARER_TOKEN=... \
npm run verify:restate
```

Then verify that Restate can complete at least one durable command checkpoint
through the production worker path:

```bash
RESTATE_INGRESS_URL=https://YOUR_ENV.env.us.restate.cloud:8080 \
RESTATE_BEARER_TOKEN=... \
npm run verify:restate-runtime
```

When a stale worker is still registered, both `npm run verify:restate` and
production readiness (`/api/health`, `/dashboard/health`, and
`product.readiness.get`) report the registered deployment URI and advertised
service list. Treat either of these as a failed deployment gate before enabling
real sends:

- Any required service is missing from the union of registered deployments.
- Any deployment that advertises a required workflow service is missing another
  required workflow service. This catches old partial workers that would
  otherwise be hidden by a newer full worker.

The verifier expects these services:

- `system.restate_runtime_probe.v1`
- `workspace.activation.setup`
- `workspace.profile.icp`
- `workspace.campaign.strategy`
- `workspace.channel.readiness`
- `workspace.company_brain.brief`
- `workspace.company_brain.recall`
- `workspace.contact.waterfall`
- `workspace.eval.gate`
- `workspace.meeting.prep`
- `workspace.message.personalization`
- `workspace.outreach.skill_selection`
- `workspace.reply.triage`
- `workspace.signal.ingestion`
- `workspace.skill.optimizer`
- `workspace.source.discovery`
- `workspace.vertical_intelligence.refresh`
- `workspace.signal.matching`
- `series_a_cold_open`
- `play.signal_to_email.v1`
- `play.signal_to_linkedin.v1`
- `play.reply_to_email.v1`
- `contact.resolve_for_signal.v1`
- `contact.enrichment.retry.v1`
- `ingest_catalog_poll`
- `ingest_workspace_poll`
- `ingest_expire_sweep`
- `channel.email_domain_provision.v1`
- `channel.email_domain_warmup.v1`
- `email_domain_warmup_sweep`
- `email_outlook_subscription_repair`
- `profile.bootstrap.exa`
- `rep.brief.refresh.exa`
- `rep.research.exa`
- `draft.grounding.exa`
- `content.opportunity.exa`
- `aeo.audit.exa`
- `signal.discover.open_web.exa`

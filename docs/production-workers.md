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
| Production worker | `worker:production` | Restate workflow host, event-wait bridge, email projectors, signal projectors, and dispatch redrive over one shared NATS connection |
| Email projectors | `worker:email-projectors` | SES/Outlook provider ingress to channel projections and workflow starts |
| Signal projectors | `worker:signal-projectors` | Signal lifecycle projections and `signal.ingested` classification |
| Restate workflows | `worker:restate-workflows` | Native Restate workflow handler host and event-wait bridge |

Prefer `worker:production` until the NATS account supports enough active
connections for separate long-running consumers plus app ingress. It preserves
the same typed event bus and Restate workflow boundaries while reducing the
runtime connection footprint.

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

Current production note: ECS Express Gateway accepts the single-port HTTP/1
health path when the handler keeps Restate bidirectional protocol enabled. ECS
task definition revision `32` runs image
`ecs-express-production-20260605-outlook-gate-cdf81d2-amd64` via
`worker:managed` with `WORKER_TARGET_COMMAND=worker:production`; Restate
traffic remains on `9080` and the managed wrapper also exposes `9081`. It is
steady at desired `1`, running `1`, pending `0`. On 2026-06-05, live
`npm run verify:restate` confirmed deployment `dp_16RLtYXG3bAoyujNOKDPH57`
advertises the full required service set, including the Exa workflows, and
`npm run verify:restate-runtime` completed
`system.restate_runtime_probe.v1` with run
`inv_14KhxrxkkvX02cbawHGK4cHof7i7Khj5vw`. The rev32 deployment also makes the
Outlook-first/explicit-managed-domain-opt-in email behavior live in the
production worker; startup logs show the managed owned-domain transport is
disabled unless `MANAGED_OWNED_DOMAIN_EMAIL_ENABLED=1`.
`npm run verify:production-gate` now includes read-only Outlook account
readiness and skips the legacy SES probe unless `AWS_SES_REQUIRED=1`. The old App Runner deployment was
drained by purging completed maintenance-only invocations and then
force-removing the deployment registration; the unused App Runner service
itself is paused. A same-port h2-capable handler was tested earlier and failed
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
does not send email. If Microsoft returns `invalid_client`, update
`MICROSOFT_CLIENT_SECRET` to the app registration's secret value, not the
secret ID, then rerun the repair and strict verifier.

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
- `RESTATE_WORKFLOW_PORT`, default `9080`
- `RESTATE_WORKFLOW_HTTP1=1` when the host is behind an HTTP/1.1 managed proxy
  and must accept `/health` checks on the Restate handler port

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
- `series_a_cold_open`
- `play.signal_to_email.v1`
- `play.signal_to_linkedin.v1`
- `play.reply_to_email.v1`
- `contact.resolve_for_signal.v1`
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

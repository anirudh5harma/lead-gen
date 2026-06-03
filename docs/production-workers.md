# Production Workers

Bombsell production needs Vercel for the Next.js app and a separate
long-running container host for the worker processes. Do not run these as
Vercel Functions; they hold durable NATS subscriptions and the Restate handler
host.

AWS now recommends moving App Runner-style workloads to **Amazon ECS Express
Mode** ([AWS App Runner availability change](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html)).
Treat ECS Express Mode (or an equivalent long-running container runtime) as the
production target for these workers. The old `worker:app-runner` script remains
as a compatibility alias, but new background services should use
`worker:managed`.

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
task definition revision `18` with image
`ecs-express-production-202606022235-probe-amd64` is steady, advertises
`system.restate_runtime_probe.v1`, passes `npm run verify:restate-runtime`, and
has completed one fresh `ingest_workspace_poll` invocation plus an eight-source
controlled batch. The old App Runner deployment was drained by purging completed
maintenance-only invocations and then force-removing the deployment
registration; `npm run verify:restate` now passes with the ECS deployment as the
only registered worker. The unused App Runner service itself is paused. A
same-port h2-capable handler was tested earlier and failed ECS health
replacement. Keep monitoring the HTTP/1 path under higher ingestion load; if
`Connection closed` warnings recur, move the Restate handler behind a
protocol-correct host/path or split health checks onto a separate port.

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
- `AWS_REGION`
- `SES_CONFIGURATION_SET`
- `RESTATE_WORKFLOW_PORT`, default `9080`
- `RESTATE_WORKFLOW_HTTP1=1` when the host is behind an HTTP/1.1 managed proxy
  and must accept `/health` checks on the Restate handler port

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
production readiness (`/api/health`, `/dashboard/ops`, and
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
- `ingest_catalog_poll`
- `ingest_workspace_poll`
- `ingest_expire_sweep`
- `channel.email_domain_provision.v1`
- `channel.email_domain_warmup.v1`
- `email_domain_warmup_sweep`
- `email_outlook_subscription_repair`
- `profile.bootstrap.exa`
- `rep.research.exa`
- `draft.grounding.exa`
- `content.opportunity.exa`
- `aeo.audit.exa`
- `signal.discover.open_web.exa`

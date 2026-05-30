# Production Workers

Bombsell production needs Vercel for the Next.js app and a separate
long-running container host for the worker processes. Do not run these as
Vercel Functions; they hold durable NATS subscriptions and the Restate handler
host.

AWS now recommends moving App Runner-style workloads to **Amazon ECS Express
Mode** ([AWS App Runner availability change](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html)).
Treat ECS Express Mode (or an equivalent long-running container runtime) as the
production target for these workers. The old `worker:app-runner` script remains
as a compatibility alias, but new services should use `worker:managed`.

## Processes

Deploy the same image three times with a different `WORKER_COMMAND`.

| Process | `WORKER_COMMAND` | Purpose |
|---|---|---|
| Email projectors | `worker:email-projectors` | SES/Outlook provider ingress to channel projections and workflow starts |
| Signal projectors | `worker:signal-projectors` | Signal lifecycle projections and `signal.ingested` classification |
| Restate workflows | `worker:restate-workflows` | Native Restate workflow handler host and event-wait bridge |

Build the worker image:

```bash
docker build -f Dockerfile.worker -t bombsell-worker .
```

Run one process locally:

```bash
docker run --rm \
  --env-file .env.local \
  -e WORKER_COMMAND=worker:restate-workflows \
  -p 9080:9080 \
  bombsell-worker
```

For managed runtimes that require a web health check for background workers
such as ECS Express Mode, run `worker:managed` with `WORKER_TARGET_COMMAND`
set to either `worker:email-projectors` or `worker:signal-projectors`.

## Required Shared Environment

All workers need:

- `DATABASE_URL`
- `NATS_URL`
- `NATS_CREDS` when using Synadia/NGS
- `NATS_STREAM_MAX_BYTES` when the hosted NATS account has a bounded stream quota
- `DEEPSEEK_API_KEY`
- `WORKER_HEALTH_PORT`, when running background workers through `worker:managed`
- `WORKER_TARGET_COMMAND`, when running background workers through `worker:managed`

Workers that start or bridge Restate invocations also need:

- `RESTATE_INGRESS_URL`
- `RESTATE_BEARER_TOKEN` for Restate Cloud or any protected ingress

`worker:restate-workflows` also needs:

- `APP_ORIGIN`
- `OPENAI_API_KEY`
- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `AWS_REGION`
- `SES_CONFIGURATION_SET`
- `RESTATE_WORKFLOW_PORT`, default `9080`
- `RESTATE_WORKFLOW_HTTP1=1` when the host is behind an HTTP/1.1 managed proxy

## Restate Registration

After deploying `worker:restate-workflows`, register its public HTTP endpoint
with Restate. For Restate Cloud, create an Admin API key in the dashboard and
set it as `RESTATE_BEARER_TOKEN` in Vercel and in every worker environment.

```bash
npx @restatedev/restate deployments register https://WORKER_HOST.example.com \
  --environment https://YOUR_ENV.env.us.restate.cloud:9070 \
  --auth-token "$RESTATE_BEARER_TOKEN"
```

Then verify the registered services:

```bash
RESTATE_INGRESS_URL=https://YOUR_ENV.env.us.restate.cloud:8080 \
RESTATE_BEARER_TOKEN=... \
npm run verify:restate
```

The verifier expects these services:

- `series_a_cold_open`
- `ingest_catalog_poll`
- `ingest_workspace_poll`
- `ingest_expire_sweep`
- `email_domain_warmup_sweep`
- `email_outlook_subscription_repair`

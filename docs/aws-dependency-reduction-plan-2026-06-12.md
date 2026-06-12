# AWS Dependency Reduction Plan

Date: 2026-06-12

## Goal

Cut AWS spend and operational drag without bypassing the pivot-v2 architecture. The durable workflow runtime, typed event bus, channel gates, and Outlook-first outbound path stay intact. This plan changes hosting and optional adapters; it does not replace Restate, NATS, the event journal, hot-path eval, or the channel trust layer.

## Current AWS Footprint

- **ECS Express Mode worker host**: runs the production worker contract through `worker:managed` with `WORKER_TARGET_COMMAND=worker:production`. This hosts the Restate workflow handler, event-wait bridge, email projectors, signal projectors, and dispatch redrive.
- **ECR image/build path**: stores and serves the worker container image used by ECS.
- **ALB/target groups/public endpoint**: exposes the Restate handler and `/health`; this has already created tuning churn around port `9080` health checks.
- **CloudWatch logs and health scanning**: `verify:restate-ecs-health` reads ECS service state, ALB target health, service events, and CloudWatch log events.
- **Legacy SES/SNS adapter**: optional owned-domain capacity only. Customer-connected Outlook/Microsoft Graph is the launch outbound path. `AWS_SES_REQUIRED=1` should only be set when intentionally exercising this legacy path.
- **App Runner**: documented as paused after the old Restate deployment was drained. It should be deleted once billing confirms no remaining dependency.

## Cost Signals From Current Providers

- AWS Fargate bills per requested vCPU, memory, storage, and runtime, with additional charges for related services such as CloudWatch logs and public IPv4 addresses. Source: https://aws.amazon.com/fargate/pricing/
- AWS Application Load Balancers bill per running hour plus LCU usage, with public IPv4 and transfer charges separate. Source: https://aws.amazon.com/elasticloadbalancing/pricing/
- CloudWatch includes only a small logs free tier before ingestion, archive storage, and Logs Insights scanned data become billable. Source: https://aws.amazon.com/cloudwatch/pricing/
- Render supports Docker web services and background workers with predictable instance prices; a Standard worker is listed at 1 CPU / 2 GB for $25/month plus workspace plan if needed. Source: https://render.com/pricing
- Railway Pro has a $20 minimum monthly usage credit model and supports production app services. Source: https://railway.com/pricing
- Restate Cloud can continue to own durable execution while our code runs as containers or functions; paid tiers start at Starter and Business levels. Source: https://www.restate.dev/cloud

## Recommended Target State

Keep:

- Vercel for the Next.js app.
- Supabase/Postgres for product storage.
- Restate Cloud for durable execution registration and admin visibility.
- NATS/Synadia for the typed event bus, unless its bill separately becomes the top cost center.
- Outlook/Microsoft Graph as the primary customer outbound channel.

Move first:

- Move the same `Dockerfile.worker` and `worker:production` contract from ECS Express Mode to Render or Railway.
- Register the new public worker endpoint in Restate.
- Keep ECS running for a short overlap window, then scale it down after the new worker passes runtime and outreach verification.

Avoid for the first migration:

- Vercel Functions for workers. The worker must keep NATS subscriptions open and expose the Restate handler as a long-running process.
- Cloudflare Workers as the first replacement for this worker. Workers pricing is attractive, but this code currently expects a Node container, open NATS connections, and Restate handler hosting. Use Cloudflare later only after a deliberate adapter/runtime design.
- Reopening SES as a launch-critical dependency. Outlook is the channel spine; SES/SNS is a legacy optional adapter.

## Waterfall

### Phase 0: Stop The Bleeding, 0-48 Hours

1. Confirm `AWS_SES_REQUIRED` is unset or `0` in Vercel and worker environments.
2. Confirm `MANAGED_OWNED_DOMAIN_EMAIL_ENABLED` is unset unless a paying customer explicitly needs managed owned-domain capacity.
3. Confirm the old App Runner service is paused or deleted.
4. Set CloudWatch log retention on worker log groups to 7 days while migration is in progress.
5. Keep ECS desired count at `1`, with no preview/staging copies running unintentionally.
6. Create AWS Budgets and Cost Explorer views split by ECS/Fargate, ELB, CloudWatch, ECR, Route53, SES/SNS, and public IPv4.

### Phase 1: Same-Contract Worker Migration, 2-7 Days

1. Choose Render first if we want the least platform experimentation: Docker image, web service endpoint, background worker support, health checks, logs, and predictable fixed instance tiers.
2. Choose Railway first if we want faster iteration and are comfortable with usage-credit billing.
3. Deploy one production worker using the existing contract:
   - `WORKER_COMMAND=worker:managed`
   - `WORKER_TARGET_COMMAND=worker:production`
   - `RESTATE_WORKFLOW_HTTP1=1`
   - `RESTATE_WORKFLOW_PORT=9080`
   - shared env from `docs/production-workers.md`
4. Expose a stable HTTPS endpoint and verify `/health`.
5. Register the new endpoint with Restate Cloud.
6. Run:
   - `npm run verify:worker-release`
   - `npm run verify:restate`
   - `npm run verify:restate-runtime`
   - `OUTREACH_PIPELINE_STRICT=1 npm run verify:outreach-pipeline`
   - `APP_ORIGIN=https://www.bombsell.com npm run verify:production-app`
7. Observe for 24 hours with autonomous volume capped.
8. Scale ECS desired count to `0`, then unregister and delete AWS resources once the Restate deployment registry and logs show no traffic to the ECS URL.

### Phase 2: Remove Legacy AWS Email, 1-2 Weeks

1. Keep `AWS_SES_REQUIRED=0`.
2. Keep `/api/webhooks/ses` and SES verification scripts as legacy until no customer data depends on historical feedback events.
3. If managed capacity is needed, add a non-AWS provider behind the existing channel adapter/event contract:
   - MailerSend/Mailgun/Azure Communication Services for customer-owned domains.
   - Smartlead/Instantly for mailbox rotation if the product decides to support that operational model.
4. Only delete SES/SNS resources after bounce/complaint history has been exported or confirmed disposable.

### Phase 3: Consolidate Observability And Artifact Storage, 2-4 Weeks

1. Move worker logs from CloudWatch to the new host's logs plus OpenTelemetry export.
2. Keep only user-facing trust traces in Postgres/graph; avoid long raw log retention.
3. Use Cloudflare R2 for raw artifacts if S3-class storage becomes material.
4. Revisit NATS/Restate spend only after ECS/ALB/CloudWatch are removed and the bill has normalized.

## Migration Gate

Do not scale down ECS until all are true:

- Restate admin shows the new worker deployment advertises every required workflow service.
- `verify:restate-runtime` completes a durable checkpoint through the new worker.
- NATS projectors are consuming without dead-letter growth.
- Strict outreach verification only fails for expected external readiness, such as no connected Outlook account.
- The production app smoke passes after the worker endpoint switch.
- No Play can send through managed owned-domain email unless `MANAGED_OWNED_DOMAIN_EMAIL_ENABLED=1`.

## Unknowns Blocked By AWS Login

The code/docs identify likely cost centers, but exact savings need live billing data. Once AWS auth is available, pull:

- Cost Explorer last 7 and 30 days by service and usage type.
- ECS desired/running count and stale services.
- ALB count, LCU usage, and public IPv4 charges.
- CloudWatch ingestion, storage, and Logs Insights scanned bytes.
- ECR image storage and stale tags.
- Route53 hosted zone/query charges.
- Any still-running App Runner or NAT Gateway resources.

## Decision

Move the worker off ECS Express Mode first, preferably to Render Standard or Railway Pro using the existing Docker/health/env contract. This removes the highest-friction AWS layer while preserving the architecture. Defer deeper rewrites until after the bill proves which remaining dependency is actually expensive.

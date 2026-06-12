# AWS Reduction Execution Status

Date: 2026-06-12

## Completed

- Refreshed AWS auth and pulled a 2026-05-13 to 2026-06-12 service cost breakdown.
- Paused, then deleted, all known App Runner services:
  - `bombsell-projectors`
  - `bombsell-email-projectors`
  - `bombsell-signal-projectors`
  - `bombsell-restate-workflows`
- Set 7-day retention on all known worker/App Runner CloudWatch log groups.
- Removed static `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from Vercel production and preview environments.
- Verified the worker release contract with `npm run verify:worker-release`.
- Built the portable worker image locally with `docker build -f Dockerfile.worker -t bombsell-worker:aws-exit-ready .`.
- Verified `aws apprunner list-services --region us-east-1` now returns no services.
- Added provider-port support for direct Restate-capable workers.
- Added `render.yaml` for the first non-AWS worker target.

## Current Cost Drivers

For 2026-06-01 through 2026-06-12, the largest AWS charges were:

- Amazon Virtual Private Cloud: about `$10.06`
- AWS App Runner: about `$8.07`
- Amazon Elastic Container Service: about `$6.71`
- Amazon Elastic Load Balancing: about `$5.97`
- Tax: about `$5.76`

Deleting App Runner should stop the App Runner portion going forward. ECS, ELB,
and VPC costs remain until the Restate/NATS worker moves to the non-AWS host and
the ECS gateway stack is scaled down.

## Verification Notes

- `npm run verify:worker-release` passed.
- `node --test --experimental-strip-types test/worker-port.test.ts test/managed-worker-config.test.ts test/verify-worker-release.test.ts` passed.
- `docker build -f Dockerfile.worker -t bombsell-worker:aws-exit-ready .` passed.
- `APP_ORIGIN=https://www.bombsell.com npm run verify:production-app` passed with the known LinkedIn provider env warning.
- `RESTATE_ECS_LOG_LOOKBACK_MINUTES=3 npm run verify:restate-ecs-health` passed against the current ECS worker.
- `npm run verify:restate-runtime` completed a durable checkpoint through the current ECS worker.
- `npm run verify:restate` failed because the registered ECS deployment does not yet advertise `contact.resolve_for_signal.v1`; the current repo release contract includes it, so the worker host must be refreshed during the provider cutover or by an interim ECS deploy.
- `OUTREACH_PIPELINE_STRICT=1 npm run verify:outreach-pipeline` failed only on Outlook readiness because there are no connected Outlook accounts; the local signal-to-contact-to-personalized-draft-to-eval-to-dry-run-send-to-outcome path passed.

## Still Required

- Create the Render service from `render.yaml` and enter the dashboard-synced secrets.
- Register the Render service URL with Restate Cloud.
- Run the migration gate:
  - `npm run verify:restate`
  - `npm run verify:restate-runtime`
  - `OUTREACH_PIPELINE_STRICT=1 npm run verify:outreach-pipeline`
  - `APP_ORIGIN=https://www.bombsell.com npm run verify:production-app`
- Observe the new worker for at least 24 hours with autonomous volume capped.
- Scale ECS desired count to `0`.
- Delete or retire the ECS service/gateway, target groups, stale ECR images, and legacy SES/SNS resources after confirming no traffic points at them.

## Blocker

The actual non-AWS worker deployment cannot be completed from this machine yet
because no Render/Fly CLI is available and the Railway CLI is not authenticated.
The repo is now ready for the provider-side create-and-register step.

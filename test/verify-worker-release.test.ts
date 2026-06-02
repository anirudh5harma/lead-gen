import { test } from "node:test";
import assert from "node:assert/strict";
import { checkWorkerReleaseContract } from "../scripts/verify-worker-release.ts";

test("worker release verifier catches missing Restate service factories", () => {
  const checks = checkWorkerReleaseContract((path) => {
    if (path === "scripts/production-worker.ts") {
      return "createSeriesAColdOpenPlay createSignalToEmailPlayWorkflow";
    }
    if (path === "scripts/restate-workflows-worker.ts") {
      return "createSeriesAColdOpenPlay createSignalToEmailPlayWorkflow";
    }
    return [
      "series_a_cold_open",
      "play.signal_to_email.v1",
      "play.signal_to_linkedin.v1",
      "play.reply_to_email.v1",
      "ingest_catalog_poll",
      "ingest_workspace_poll",
      "ingest_expire_sweep",
      "channel.email_domain_provision.v1",
      "channel.email_domain_warmup.v1",
      "email_domain_warmup_sweep",
      "email_outlook_subscription_repair",
    ].join("\n");
  });

  assert.ok(
    checks.some(
      (check) =>
        !check.ok &&
        check.name ===
          "scripts/production-worker.ts registers play.signal_to_linkedin.v1",
    ),
  );
});

test("worker release verifier passes against the current repo contract", () => {
  const checks = checkWorkerReleaseContract();
  assert.deepEqual(checks.filter((check) => !check.ok), []);
});

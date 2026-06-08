import assert from "node:assert/strict";
import { test } from "node:test";
import {
  runOutlookReadinessProbe,
  summarizeOutlookError,
} from "../scripts/verify-outlook-readiness.ts";

test("outlook readiness: missing DATABASE_URL fails without sending", async () => {
  const result = await runOutlookReadinessProbe({ env: {} });

  assert.equal(result.ok, false);
  assert.equal(result.connectedAccounts, 0);
  assert.equal(result.steps[0]?.label, "outlook: database configured");
});

test("outlook readiness: connected account with active subscription passes", async () => {
  const result = await runOutlookReadinessProbe({
    env: {
      DATABASE_URL: "postgresql://example",
      MANAGED_OWNED_DOMAIN_EMAIL_ENABLED: "0",
    },
    pool: {
      query: async () => ({
        rows: [
          {
            total_outlook: "1",
            connected_outlook: "1",
            active_subscriptions: "1",
            errored_connected: "0",
            connected_managed_domains: "7",
          },
        ],
      }),
      end: async () => undefined,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.connectedAccounts, 1);
  assert.equal(result.activeSubscriptions, 1);
  assert.match(
    result.steps.find((step) => step.label === "managed-domain fallback")?.detail ?? "",
    /legacy managed-domain account\(s\) ignored/,
  );
});

test("outlook readiness: no connected account fails explicitly", async () => {
  const result = await runOutlookReadinessProbe({
    env: { DATABASE_URL: "postgresql://example" },
    pool: {
      query: async () => ({
        rows: [
          {
            total_outlook: "0",
            connected_outlook: "0",
            active_subscriptions: "0",
            errored_connected: "0",
            connected_managed_domains: "7",
          },
        ],
      }),
      end: async () => undefined,
    },
  });

  assert.equal(result.ok, false);
  const connected = result.steps.find((step) => step.label === "outlook: connected mailbox");
  assert.equal(connected?.status, "fail");
  assert.match(connected?.detail ?? "", /No connected Outlook accounts/);
});

test("outlook readiness: reports actionable Microsoft client secret errors", async () => {
  let queries = 0;
  const result = await runOutlookReadinessProbe({
    env: { DATABASE_URL: "postgresql://example" },
    pool: {
      query: async () => {
        queries += 1;
        if (queries === 1) {
          return {
            rows: [
              {
                total_outlook: "1",
                connected_outlook: "1",
                active_subscriptions: "0",
                errored_connected: "1",
                connected_managed_domains: "0",
              },
            ],
          };
        }
        return {
          rows: [{
            last_error:
              "{\"message\":\"Outlook token refresh failed (401): {\\\"error\\\":\\\"invalid_client\\\",\\\"error_description\\\":\\\"AADSTS7000215: Invalid client secret provided.\\\"}\"}",
          }],
        };
      },
      end: async () => undefined,
    },
  });

  assert.equal(result.ok, false);
  const errors = result.steps.find((step) => step.label === "outlook: account errors");
  assert.equal(errors?.status, "fail");
  assert.match(errors?.detail ?? "", /MICROSOFT_CLIENT_SECRET/);
  assert.match(errors?.detail ?? "", /secret value/);
});

test("summarizeOutlookError recognizes Microsoft invalid_client secret-id mistakes", () => {
  assert.match(
    summarizeOutlookError(
      "{\"error\":\"invalid_client\",\"error_description\":\"AADSTS7000215: Invalid client secret provided.\"}",
    ) ?? "",
    /current client secret value/,
  );
});

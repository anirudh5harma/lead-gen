import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatChannelReadiness,
  formatEmailDeliverability,
} from "../core/product/context.ts";

test("workspace context redacts user-connected channel account names", () => {
  const readiness = formatChannelReadiness([
    {
      display_name: "owner@example.com",
      kind: "oauth_outlook",
      status: "connected",
      daily_cap: 5,
      daily_used: 1,
      provider_status: null,
      domain: null,
      warmup_state: null,
      current_daily_cap: null,
      bounce_rate_24h: null,
    },
    {
      display_name: "Founder LinkedIn",
      kind: "linkedin_oauth",
      status: "connected",
      daily_cap: 20,
      daily_used: 2,
      provider_status: "healthy",
      domain: null,
      warmup_state: null,
      current_daily_cap: null,
      bounce_rate_24h: null,
    },
  ]);
  const deliverability = formatEmailDeliverability([
    {
      display_name: "owner@example.com",
      kind: "oauth_outlook",
      status: "connected",
      daily_cap: 5,
      daily_used: 1,
      provider_status: null,
      domain: null,
      warmup_state: null,
      current_daily_cap: null,
      bounce_rate_24h: null,
    },
  ]);

  assert.match(readiness, /Outlook account/);
  assert.match(readiness, /LinkedIn account/);
  assert.doesNotMatch(readiness, /owner@example\.com/);
  assert.doesNotMatch(readiness, /Founder LinkedIn/);
  assert.match(deliverability, /Outlook account/);
  assert.doesNotMatch(deliverability, /owner@example\.com/);
});

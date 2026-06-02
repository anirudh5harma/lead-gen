import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatChannelReadiness,
  formatEmailDeliverability,
} from "../core/product/context.ts";

const accounts = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    display_name: "maya@go.example.com",
    kind: "email_domain",
    daily_cap: 25,
    daily_used: 7,
    daily_window_start: null,
    status: "connected",
    domain: "go.example.com",
    sending_domain_id: "22222222-2222-4222-8222-222222222222",
    warmup_state: "warming",
    current_daily_cap: 12,
    spf_verified: true,
    dkim_verified: true,
    dmarc_verified: true,
    provider_status: "verified",
    provider_domain_id: "domain-1",
    dns_records: [],
    bounce_rate_24h: 0.01,
    complaint_rate_24h: 0,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    display_name: "Founder LinkedIn",
    kind: "linkedin_oauth",
    daily_cap: 15,
    daily_used: 2,
    daily_window_start: null,
    status: "needs_reauth",
    domain: null,
    sending_domain_id: null,
    warmup_state: null,
    current_daily_cap: null,
    spf_verified: null,
    dkim_verified: null,
    dmarc_verified: null,
    provider_status: null,
    provider_domain_id: null,
    dns_records: [],
    bounce_rate_24h: null,
    complaint_rate_24h: null,
  },
] as const;

test("product context: channel readiness includes native LinkedIn account state", () => {
  const readiness = formatChannelReadiness(accounts);

  assert.match(readiness, /maya@go\.example\.com kind=email_domain status=connected/);
  assert.match(
    readiness,
    /Founder LinkedIn kind=linkedin_oauth status=needs_reauth used=2\/15/,
  );
});

test("product context: email deliverability excludes LinkedIn account noise", () => {
  const deliverability = formatEmailDeliverability(accounts);

  assert.match(deliverability, /go\.example\.com/);
  assert.doesNotMatch(deliverability, /LinkedIn/);
});

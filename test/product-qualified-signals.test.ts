import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import {
  loadQualifiedSignalEmailReadiness,
  loadQualifiedSignalWorkbench,
  normalizeContactCandidates,
} from "../core/product/qualified-signals.ts";

test("qualified signals workbench maps verified contacts and email drafts", async () => {
  const now = new Date("2026-06-12T10:00:00Z");
  const pool = fakePool([
    {
      id: "00000000-0000-4000-8000-000000000101",
      kind: "funding",
      status: "matched",
      title: "Acme raised a Series A",
      content: "Acme raised a Series A to expand finance workflows.",
      url: "https://example.com/acme",
      match_score: "0.9100",
      match_reason: "Fresh funding signal for the finance workflow ICP.",
      freshness_at: now,
      ingested_at: now,
      matched_at: now,
      company_id: "00000000-0000-4000-8000-000000000201",
      company_name: "Acme Payroll",
      company_domain: "acmepayroll.example",
      company_industry: "Fintech",
      company_description: "Payroll automation for distributed teams.",
      contact_candidates: [
        {
          rank: 1,
          person_id: "00000000-0000-4000-8000-000000000301",
          full_name: "Nisha Rao",
          title: "Founder and CEO",
          score: 1.1,
          reasons: ["executive_or_founder", "verified_email"],
          emails: ["nisha@acmepayroll.example"],
          linkedin_url: "https://linkedin.com/in/nisha",
          verification: { email_verified: true, email_status: "valid" },
          provenance: { source: "hunter" },
        },
      ],
      graph_candidates: [
        {
          rank: 1,
          person_id: "00000000-0000-4000-8000-000000000302",
          full_name: "Fallback Person",
          title: "VP Revenue",
          score: 0.8,
          reasons: ["gtm_leader"],
          emails: ["fallback@acmepayroll.example"],
          linkedin_url: null,
          verification: { email_verified: true, email_status: "valid" },
          provenance: { source: "graph" },
        },
      ],
      contact_channel: "email",
      contact_defer_reason: null,
      draft_conversation_id: "00000000-0000-4000-8000-000000000401",
      draft_message_id: "00000000-0000-4000-8000-000000000501",
      draft_channel: "email",
      draft_status: "draft",
      draft_subject: "Congrats on the Series A",
      draft_body: "Nisha, saw the Series A. Worth comparing notes?",
      draft_eval_score: "0.8700",
      draft_eval_passed: true,
      draft_external_id: "graph-message-1",
      draft_scheduled_at: now,
      draft_sent_at: now,
      draft_delivered_at: null,
      draft_channel_event_type: "message.sent",
      draft_channel_event_at: now,
      draft_defer_reason: null,
      draft_defer_detail: null,
      draft_created_at: now,
      pending_approval_id: "00000000-0000-4000-8000-000000000601",
    },
  ]);

  const workbench = await loadQualifiedSignalWorkbench(
    pool,
    "00000000-0000-4000-8000-000000000001",
  );

  assert.equal(workbench.stats.qualified, 1);
  assert.equal(workbench.stats.with_verified_contacts, 1);
  assert.equal(workbench.stats.with_email_draft, 1);
  assert.equal(workbench.stats.ready_for_review, 1);
  assert.equal(workbench.signals[0]?.contact_source, "resolution");
  assert.equal(workbench.signals[0]?.contacts[0]?.full_name, "Nisha Rao");
  assert.equal(workbench.signals[0]?.email_draft?.subject, "Congrats on the Series A");
  assert.equal(workbench.signals[0]?.email_draft?.eval_score, 0.87);
  assert.equal(workbench.signals[0]?.email_draft?.external_id, "graph-message-1");
  assert.equal(workbench.signals[0]?.email_draft?.latest_channel_event_type, "message.sent");
  assert.equal(workbench.signals[0]?.email_draft?.sent_at, now);
});

test("qualified signals workbench falls back to graph contacts when resolution has not run", async () => {
  const now = new Date("2026-06-12T10:00:00Z");
  const pool = fakePool([
    {
      id: "00000000-0000-4000-8000-000000000102",
      kind: "hiring",
      status: "matched",
      title: "Beta opened GTM roles",
      content: null,
      url: null,
      match_score: "0.7500",
      match_reason: null,
      freshness_at: now,
      ingested_at: now,
      matched_at: null,
      company_id: "00000000-0000-4000-8000-000000000202",
      company_name: "Beta Finance",
      company_domain: "betafinance.example",
      company_industry: null,
      company_description: null,
      contact_candidates: null,
      graph_candidates: JSON.stringify([
        {
          rank: 1,
          person_id: "00000000-0000-4000-8000-000000000303",
          full_name: "Mira Shah",
          title: "Founder",
          score: 0.95,
          reasons: ["executive_or_founder", "has_email"],
          emails: ["mira@betafinance.example"],
          linkedin_url: null,
          verification: { email_verified: true, email_status: "valid" },
          provenance: { source: "graph_cache" },
        },
      ]),
      contact_channel: null,
      contact_defer_reason: null,
      draft_conversation_id: null,
      draft_message_id: null,
      draft_channel: null,
      draft_status: null,
      draft_subject: null,
      draft_body: null,
      draft_eval_score: null,
      draft_eval_passed: null,
      draft_external_id: null,
      draft_scheduled_at: null,
      draft_sent_at: null,
      draft_delivered_at: null,
      draft_channel_event_type: null,
      draft_channel_event_at: null,
      draft_defer_reason: null,
      draft_defer_detail: null,
      draft_created_at: null,
      pending_approval_id: null,
    },
  ]);

  const workbench = await loadQualifiedSignalWorkbench(
    pool,
    "00000000-0000-4000-8000-000000000001",
  );

  assert.equal(workbench.stats.with_verified_contacts, 1);
  assert.equal(workbench.stats.with_email_draft, 0);
  assert.equal(workbench.signals[0]?.contact_source, "graph");
  assert.equal(workbench.signals[0]?.contacts[0]?.verification.email_verified, true);
});

test("qualified signals query only surfaces actionable company-backed verified-contact work", async () => {
  let sql = "";
  const pool = {
    async query<T>(query: string) {
      sql = query;
      return { rows: [] as T[] };
    },
  } as unknown as Pool;

  await loadQualifiedSignalWorkbench(pool, "00000000-0000-4000-8000-000000000001");

  assert.match(sql, /s\.related_company_id is not null/);
  assert.match(sql, /e\.event_type in \(/);
  assert.match(sql, /'message\.deferred'/);
  assert.match(sql, /e\.payload->>'message_id' = m\.id::text/);
  assert.match(sql, /cardinality\(gp\.emails\) > 0/);
  assert.match(sql, /meta->>'verified' = 'true'/);
  assert.match(sql, /array_prepend\(ev\.email::citext, array_remove\(gp\.emails, ev\.email::citext\)\)/);
});

test("qualified signal email readiness requires connected Outlook reply sync", async () => {
  const ready = await loadQualifiedSignalEmailReadiness(fakePool([{
    connected_outlook: "1",
    active_subscriptions: "1",
    errored_connected: "0",
    connected_managed_domains: "0",
  }]), "00000000-0000-4000-8000-000000000001");

  assert.equal(ready.ready, true);
  assert.equal(ready.status_label, "Ready");

  const missingInbox = await loadQualifiedSignalEmailReadiness(fakePool([{
    connected_outlook: "0",
    active_subscriptions: "0",
    errored_connected: "0",
    connected_managed_domains: "7",
  }]), "00000000-0000-4000-8000-000000000001");

  assert.equal(missingInbox.ready, false);
  assert.equal(missingInbox.status_label, "Connect inbox");
  assert.match(missingInbox.detail, /No connected Outlook inbox/);

  const missingSync = await loadQualifiedSignalEmailReadiness(fakePool([{
    connected_outlook: "2",
    active_subscriptions: "0",
    errored_connected: "0",
    connected_managed_domains: "0",
  }]), "00000000-0000-4000-8000-000000000001");

  assert.equal(missingSync.ready, false);
  assert.equal(missingSync.status_label, "Needs sync");
  assert.match(missingSync.detail, /0\/2 Outlook inboxes/);
});

test("normalizeContactCandidates tolerates malformed provider payloads", () => {
  assert.deepEqual(normalizeContactCandidates(null), []);
  assert.deepEqual(normalizeContactCandidates("not-json"), []);

  const contacts = normalizeContactCandidates(JSON.stringify([
    {
      full_name: "Ava Founder",
      emails: ["ava@example.com", ""],
      verification: { email_verified: "true", linkedin_ready: "false" },
    },
  ]));

  assert.equal(contacts[0]?.full_name, "Ava Founder");
  assert.deepEqual(contacts[0]?.emails, ["ava@example.com"]);
  assert.equal(contacts[0]?.verification.email_verified, true);
  assert.equal(contacts[0]?.verification.linkedin_ready, false);
});

function fakePool(rows: unknown[]): Pool {
  return {
    async query<T>() {
      return { rows: rows as T[] };
    },
  } as unknown as Pool;
}

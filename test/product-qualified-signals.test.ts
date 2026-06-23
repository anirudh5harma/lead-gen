import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import {
  loadQualifiedSignalEmailReadiness,
  loadQualifiedSignalWorkbench,
  normalizeContactCandidates,
} from "../core/product/qualified-signals.ts";

test("qualified signals workbench maps verified contacts and outreach drafts", async () => {
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
  assert.equal(workbench.stats.with_outreach_draft, 1);
  assert.equal(workbench.stats.with_email_draft, 1);
  assert.equal(workbench.stats.ready_for_review, 1);
  assert.equal(workbench.signals[0]?.contact_source, "resolution");
  assert.equal(workbench.signals[0]?.contacts[0]?.full_name, "Nisha Rao");
  assert.equal(workbench.signals[0]?.outreach_draft?.subject, "Congrats on the Series A");
  assert.equal(workbench.signals[0]?.outreach_draft?.eval_score, 0.87);
  assert.equal(workbench.signals[0]?.outreach_draft?.external_id, "graph-message-1");
  assert.equal(workbench.signals[0]?.outreach_draft?.latest_channel_event_type, "message.sent");
  assert.equal(workbench.signals[0]?.outreach_draft?.sent_at, now);
  assert.equal(workbench.signals[0]?.email_draft, workbench.signals[0]?.outreach_draft);
});

test("qualified signals workbench does not count judge-blocked drafts as review-ready", async () => {
  const now = new Date("2026-06-12T10:00:00Z");
  const pool = fakePool([
    {
      id: "00000000-0000-4000-8000-000000000111",
      kind: "launch",
      status: "matched",
      title: "Acme launched an AI workflow product",
      content: "Acme launched new AI capabilities for revenue teams.",
      url: "https://example.com/acme-ai",
      match_score: "0.8800",
      match_reason: "Fresh launch signal for the revenue workflow ICP.",
      freshness_at: now,
      ingested_at: now,
      matched_at: now,
      company_id: "00000000-0000-4000-8000-000000000211",
      company_name: "Acme AI",
      company_domain: "acmeai.example",
      company_industry: "Software",
      company_description: "AI workflow automation for GTM teams.",
      contact_candidates: [
        {
          rank: 1,
          person_id: "00000000-0000-4000-8000-000000000311",
          full_name: "Ira Shah",
          title: "Founder",
          score: 1,
          reasons: ["executive_or_founder", "verified_email"],
          emails: ["ira@acmeai.example"],
          linkedin_url: null,
          verification: { email_verified: true, email_status: "valid" },
          provenance: { source: "hunter" },
        },
      ],
      graph_candidates: [],
      contact_channel: "email",
      contact_defer_reason: null,
      draft_conversation_id: "00000000-0000-4000-8000-000000000411",
      draft_message_id: "00000000-0000-4000-8000-000000000511",
      draft_channel: "email",
      draft_status: "draft",
      draft_subject: "Congrats on the launch",
      draft_body: "Ira, saw the launch. Worth comparing notes?",
      draft_eval_score: "0.0000",
      draft_eval_passed: false,
      draft_external_id: null,
      draft_scheduled_at: null,
      draft_sent_at: null,
      draft_delivered_at: null,
      draft_channel_event_type: "message.deferred",
      draft_channel_event_at: now,
      draft_defer_reason: "eval_rejected",
      draft_defer_detail: "judge blocked this draft",
      draft_created_at: now,
      pending_approval_id: null,
    },
  ]);

  const workbench = await loadQualifiedSignalWorkbench(
    pool,
    "00000000-0000-4000-8000-000000000001",
  );

  assert.equal(workbench.stats.with_verified_contacts, 1);
  assert.equal(workbench.stats.with_outreach_draft, 1);
  assert.equal(workbench.stats.with_email_draft, 1);
  assert.equal(workbench.stats.ready_for_review, 0);
  assert.equal(workbench.signals[0]?.outreach_draft?.eval_passed, false);
  assert.equal(workbench.signals[0]?.outreach_draft?.defer_reason, "eval_rejected");
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
  assert.equal(workbench.stats.with_outreach_draft, 0);
  assert.equal(workbench.stats.with_email_draft, 0);
  assert.equal(workbench.signals[0]?.contact_source, "graph");
  assert.equal(workbench.signals[0]?.contacts[0]?.verification.email_verified, true);
});

test("qualified signals workbench treats LinkedIn profiles as outreach-ready contacts", async () => {
  const now = new Date("2026-06-12T10:00:00Z");
  const pool = fakePool([
    {
      id: "00000000-0000-4000-8000-000000000104",
      kind: "competitor_move",
      status: "in_play",
      title: "Buyer asked about an Apollo alternative",
      content: "A VP Sales asked for cleaner LinkedIn prospecting workflows.",
      url: "https://example.com/thread",
      match_score: "0.8200",
      match_reason: "Competitor-switching language with a GTM buyer.",
      freshness_at: now,
      ingested_at: now,
      matched_at: now,
      company_id: "00000000-0000-4000-8000-000000000204",
      company_name: "Gamma GTM",
      company_domain: "gammagtm.example",
      company_industry: "Software",
      company_description: "GTM analytics.",
      contact_candidates: null,
      graph_candidates: JSON.stringify([
        {
          rank: 1,
          person_id: "00000000-0000-4000-8000-000000000304",
          full_name: "Lina Park",
          title: "VP Sales",
          score: 0.82,
          reasons: ["gtm_leader", "linkedin_ready"],
          emails: [],
          linkedin_url: "https://linkedin.com/in/lina-park",
          verification: { linkedin_ready: true },
          provenance: { source: "graph_cache" },
        },
      ]),
      contact_channel: "linkedin",
      contact_defer_reason: null,
      draft_conversation_id: "00000000-0000-4000-8000-000000000404",
      draft_message_id: "00000000-0000-4000-8000-000000000504",
      draft_channel: "linkedin_dm",
      draft_status: "draft",
      draft_subject: null,
      draft_body: "Saw your Apollo thread. Worth comparing notes?",
      draft_eval_score: "0.7900",
      draft_eval_passed: true,
      draft_external_id: null,
      draft_scheduled_at: null,
      draft_sent_at: null,
      draft_delivered_at: null,
      draft_channel_event_type: null,
      draft_channel_event_at: null,
      draft_defer_reason: null,
      draft_defer_detail: null,
      draft_created_at: now,
      pending_approval_id: null,
    },
  ]);

  const workbench = await loadQualifiedSignalWorkbench(
    pool,
    "00000000-0000-4000-8000-000000000001",
  );

  assert.equal(workbench.stats.with_verified_contacts, 1);
  assert.equal(workbench.stats.with_outreach_draft, 1);
  assert.equal(workbench.stats.with_email_draft, 1);
  assert.equal(workbench.signals[0]?.contacts[0]?.emails.length, 0);
  assert.equal(workbench.signals[0]?.contacts[0]?.verification.linkedin_ready, true);
  assert.equal(workbench.signals[0]?.outreach_draft?.channel, "linkedin_dm");
  assert.equal(workbench.signals[0]?.outreach_draft?.body, "Saw your Apollo thread. Worth comparing notes?");
});

test("qualified signals workbench dedupes repeated contacts inside one signal", async () => {
  const now = new Date("2026-06-12T10:00:00Z");
  const pool = fakePool([
    {
      id: "00000000-0000-4000-8000-000000000120",
      kind: "funding",
      status: "matched",
      title: "Acme raised a round",
      content: null,
      url: null,
      match_score: "0.9100",
      match_reason: "Funding signal.",
      freshness_at: now,
      ingested_at: now,
      matched_at: now,
      company_id: "00000000-0000-4000-8000-000000000220",
      company_name: "Acme",
      company_domain: "acme.example",
      company_industry: null,
      company_description: null,
      contact_candidates: [
        {
          rank: 1,
          person_id: "00000000-0000-4000-8000-000000000320",
          full_name: "Nisha Rao",
          title: "Founder",
          score: 0.95,
          reasons: ["executive_or_founder", "verified_email"],
          emails: ["nisha@acme.example"],
          linkedin_url: "https://linkedin.com/in/nisha-rao",
          verification: { email_verified: true, email_status: "valid" },
          provenance: { source: "hunter" },
        },
        {
          rank: 2,
          person_id: "00000000-0000-4000-8000-000000000321",
          full_name: "Nisha Rao",
          title: "Founder",
          score: 0.95,
          reasons: ["executive_or_founder", "verified_email"],
          emails: ["nisha@acme.example"],
          linkedin_url: "https://linkedin.com/in/nisha-rao",
          verification: { email_verified: true, email_status: "valid" },
          provenance: { source: "graph" },
        },
      ],
      graph_candidates: [],
      contact_channel: "email",
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

  assert.equal(workbench.signals[0]?.contacts.length, 1);
  assert.equal(workbench.signals[0]?.contacts[0]?.full_name, "Nisha Rao");
});

test("qualified signals workbench keeps only the strongest repeated person/company lead", async () => {
  const older = new Date("2026-06-10T10:00:00Z");
  const newer = new Date("2026-06-12T10:00:00Z");
  const pool = fakePool([
    {
      id: "00000000-0000-4000-8000-000000000130",
      kind: "funding",
      status: "matched",
      title: "Older signal",
      content: null,
      url: null,
      match_score: "0.7400",
      match_reason: "Earlier signal.",
      freshness_at: older,
      ingested_at: older,
      matched_at: older,
      company_id: "00000000-0000-4000-8000-000000000230",
      company_name: "Acme",
      company_domain: "acme.example",
      company_industry: null,
      company_description: null,
      account_intent_score: "0.6000",
      account_signal_count: 2,
      contact_candidates: [
        {
          rank: 1,
          person_id: "00000000-0000-4000-8000-000000000330",
          full_name: "Nisha Rao",
          title: "Founder",
          score: 0.8,
          contact_fit_decision: "unsure",
          reasons: ["executive_or_founder"],
          emails: ["nisha@acme.example"],
          linkedin_url: "https://linkedin.com/in/nisha-rao",
          verification: { email_verified: true, email_status: "valid" },
          provenance: { source: "hunter" },
        },
      ],
      graph_candidates: [],
      contact_channel: "email",
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
    {
      id: "00000000-0000-4000-8000-000000000131",
      kind: "funding",
      status: "matched",
      title: "Newer stronger signal",
      content: null,
      url: null,
      match_score: "0.9200",
      match_reason: "Better signal.",
      freshness_at: newer,
      ingested_at: newer,
      matched_at: newer,
      company_id: "00000000-0000-4000-8000-000000000230",
      company_name: "Acme",
      company_domain: "acme.example",
      company_industry: null,
      company_description: null,
      account_intent_score: "0.8500",
      account_signal_count: 2,
      contact_candidates: [
        {
          rank: 1,
          person_id: "00000000-0000-4000-8000-000000000331",
          full_name: "Nisha Rao",
          title: "Founder",
          score: 0.96,
          contact_fit_decision: "fit",
          reasons: ["executive_or_founder", "verified_email"],
          emails: ["nisha@acme.example"],
          linkedin_url: "https://linkedin.com/in/nisha-rao",
          verification: { email_verified: true, email_status: "valid" },
          provenance: { source: "graph" },
        },
      ],
      graph_candidates: [],
      contact_channel: "email",
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

  assert.equal(workbench.stats.qualified, 1);
  assert.equal(workbench.signals[0]?.title, "Newer stronger signal");
  assert.equal(workbench.signals[0]?.contacts[0]?.contact_fit_decision, "fit");
});

test("qualified signals workbench decodes HTML entities in displayed signal text", async () => {
  const now = new Date("2026-06-12T10:00:00Z");
  const pool = fakePool([
    {
      id: "00000000-0000-4000-8000-000000000103",
      kind: "hiring",
      status: "matched",
      title: "Weave opened roles at https:&#x2F;&#x2F;weave.bio&#x2F;careers",
      content: "Careers page: https:&#x2F;&#x2F;weave.bio&#x2F;careers &amp; hiring.",
      url: "https:&#x2F;&#x2F;weave.bio&#x2F;careers?team=gtm&amp;role=sales",
      match_score: "0.7300",
      match_reason: "Hiring signal from https:&#47;&#47;weave.bio&#47;careers",
      freshness_at: now,
      ingested_at: now,
      matched_at: null,
      company_id: "00000000-0000-4000-8000-000000000203",
      company_name: "Weave Bio",
      company_domain: "weave.bio",
      company_industry: null,
      company_description: "AI &amp; bio workflows.",
      contact_candidates: null,
      graph_candidates: [],
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
  const signal = workbench.signals[0];

  assert.equal(signal?.title, "Weave opened roles at https://weave.bio/careers");
  assert.equal(signal?.content, "Careers page: https://weave.bio/careers & hiring.");
  assert.equal(signal?.url, "https://weave.bio/careers?team=gtm&role=sales");
  assert.equal(signal?.match_reason, "Hiring signal from https://weave.bio/careers");
  assert.equal(signal?.company.description, "AI & bio workflows.");
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
  assert.match(sql, /e\.payload->>'channel' in \('email','linkedin'\)/);
  assert.match(sql, /gp\.linkedin_url is not null/);
  assert.match(sql, /m\.channel in \('email','linkedin_dm','linkedin_inmail','linkedin_connection','linkedin_comment'\)/);
  assert.match(sql, /meta->>'verified' = 'true'/);
  assert.match(sql, /array_prepend\(ev\.email::citext, array_remove\(gp\.emails, ev\.email::citext\)\)/);
  assert.match(sql, /limit greatest\(\$2::int \* 5, 250\)/);
  assert.match(sql, /when draft\.message_id is not null/);
  assert.match(sql, /e\.event_type = 'draft\.judged'/);
  assert.match(sql, /e\.event_type = 'draft\.rejected'/);
  assert.match(sql, /coalesce\(m\.eval_score, \(judged\.payload->>'eval_score'\)::numeric\)/);
  assert.match(sql, /limit greatest\(\$2::int \* 5, 250\)/);
});

test("qualified signal email readiness coalesces duplicate Outlook rows by mailbox", async () => {
  let sql = "";
  const pool = {
    async query<T>(query: string) {
      sql = query;
      return {
        rows: [{
          connected_outlook: "1",
          active_subscriptions: "1",
          needs_reauth_outlook: "0",
          errored_connected: "0",
          connected_managed_domains: "0",
        }] as T[],
      };
    },
  } as unknown as Pool;

  const ready = await loadQualifiedSignalEmailReadiness(
    pool,
    "00000000-0000-4000-8000-000000000001",
  );

  assert.equal(ready.ready, true);
  assert.match(sql, /outlook_mailboxes/);
  assert.match(sql, /properties ->> 'mailbox_email'/);
  assert.match(sql, /group by outlook_mailbox_key/);
  assert.match(sql, /has_needs_reauth and not has_connected/);
});

test("qualified signal email readiness requires connected Outlook reply sync", async () => {
  const ready = await loadQualifiedSignalEmailReadiness(fakePool([{
    connected_outlook: "1",
    active_subscriptions: "1",
    needs_reauth_outlook: "0",
    errored_connected: "0",
    connected_managed_domains: "0",
  }]), "00000000-0000-4000-8000-000000000001");

  assert.equal(ready.ready, true);
  assert.equal(ready.status_label, "Ready");

  const missingInbox = await loadQualifiedSignalEmailReadiness(fakePool([{
    connected_outlook: "0",
    active_subscriptions: "0",
    needs_reauth_outlook: "0",
    errored_connected: "0",
    connected_managed_domains: "7",
  }]), "00000000-0000-4000-8000-000000000001");

  assert.equal(missingInbox.ready, false);
  assert.equal(missingInbox.status_label, "Connect inbox");
  assert.match(missingInbox.detail, /No connected Outlook inbox/);

  const missingSync = await loadQualifiedSignalEmailReadiness(fakePool([{
    connected_outlook: "2",
    active_subscriptions: "0",
    needs_reauth_outlook: "0",
    errored_connected: "0",
    connected_managed_domains: "0",
  }]), "00000000-0000-4000-8000-000000000001");

  assert.equal(missingSync.ready, false);
  assert.equal(missingSync.status_label, "Repairing sync");
  assert.match(missingSync.detail, /0\/2 Outlook inboxes/);
  assert.match(missingSync.detail, /no reconnect is needed unless Microsoft revoked the grant/);

  const needsReconnect = await loadQualifiedSignalEmailReadiness(fakePool([{
    connected_outlook: "0",
    active_subscriptions: "0",
    needs_reauth_outlook: "2",
    errored_connected: "0",
    connected_managed_domains: "0",
  }]), "00000000-0000-4000-8000-000000000001");

  assert.equal(needsReconnect.ready, false);
  assert.equal(needsReconnect.needs_reauth_outlook_accounts, 2);
  assert.equal(needsReconnect.status_label, "Reconnect inbox");
  assert.match(needsReconnect.detail, /2 Outlook inboxes need Microsoft reauthorization/);
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

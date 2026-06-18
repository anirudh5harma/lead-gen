import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCompanyBrainBrief,
  formatCompanyBrainMarkdown,
} from "../core/product/company-brain.ts";

test("company brain builds source-referenced shared memory cards", () => {
  const brief = buildCompanyBrainBrief({
    workspace_id: "00000000-0000-4000-8000-000000000001",
    generated_at: "2026-06-15T00:00:00.000Z",
    connectorEnv: {},
    profile: {
      company_id: "00000000-0000-4000-8000-000000000101",
      company_name: "Acme GTM",
      domain: "acme.example",
      website_url: "https://acme.example",
      industry: "AI GTM",
      description: "Turns market movement into outbound timing.",
      exa_summary: "Buyers compare Acme with AI GTM workspaces.",
      updated_at: "2026-06-14T10:00:00.000Z",
    },
    signals: [{
      id: "00000000-0000-4000-8000-000000000201",
      kind: "hiring",
      title: "Target account is hiring RevOps",
      status: "matched",
      match_score: "0.91",
      match_reason: "Hiring suggests a GTM workflow change.",
      freshness_at: "2026-06-15T08:00:00.000Z",
      url: "https://example.com/jobs/revops",
    }],
    outcomes: [{
      id: "00000000-0000-4000-8000-000000000301",
      kind: "positive_reply",
      score: "0.8",
      occurred_at: "2026-06-15T09:00:00.000Z",
      attributed_signal_id: "00000000-0000-4000-8000-000000000201",
      attributed_rep_id: "00000000-0000-4000-8000-000000000401",
      subject_company_id: null,
      subject_person_id: null,
      properties: { summary: "Founder replied with meeting interest." },
    }],
    playbooks: [{
      id: "00000000-0000-4000-8000-000000000501",
      rep_id: "00000000-0000-4000-8000-000000000401",
      rep_name: "Outbound agent",
      pattern_key: "icp:ai-gtm|signal:hiring|stage:cold_open",
      exemplar: { body: "Saw the RevOps hire. Usually that means the motion is changing." },
      score: "0.87",
      win_count: 3,
      loss_count: 1,
      last_used_at: "2026-06-15T07:00:00.000Z",
      created_at: "2026-06-01T07:00:00.000Z",
    }],
    semantic: [{
      id: "00000000-0000-4000-8000-000000000601",
      rep_id: "00000000-0000-4000-8000-000000000401",
      rep_name: "Outbound agent",
      subject_type: "company",
      subject_id: "00000000-0000-4000-8000-000000000701",
      facts: { buying_trigger: "RevOps hiring", objection: "already has sequencing" },
      confidence: "0.7",
      last_observed_at: "2026-06-15T06:00:00.000Z",
    }],
    meeting_prep: [{
      event_id: "00000000-0000-4000-8000-000000000801",
      meeting_prep_id: "00000000-0000-4000-8000-000000000802",
      conversation_id: "00000000-0000-4000-8000-000000000803",
      generated_at: "2026-06-15T09:30:00.000Z",
      status: "ready",
      next_action: "ask_for_times",
      summary: "Maya at Acme is ready for a focused follow-up on the RevOps hiring signal.",
      agenda: ["Open with the RevOps hiring Signal"],
      suggested_questions: ["What changed around RevOps hiring?"],
      profile_context: {
        prospect: {
          person_id: "00000000-0000-4000-8000-000000000804",
          name: "Maya",
          title: "VP Sales",
          linkedin_url: "https://linkedin.com/in/maya",
        },
        company: {
          company_id: "00000000-0000-4000-8000-000000000701",
          name: "Acme",
          domain: "acme.example",
          industry: "B2B SaaS",
          description: "Acme sells workflow tools.",
        },
        rep: {
          rep_id: "00000000-0000-4000-8000-000000000401",
          name: "Outbound agent",
          role: "sdr",
        },
      },
      source_refs: [{
        type: "conversation",
        id: "00000000-0000-4000-8000-000000000803",
        label: "Conversation",
      }, {
        type: "message",
        id: "00000000-0000-4000-8000-000000000805",
        label: "Latest inbound reply",
      }, {
        type: "signal",
        id: "00000000-0000-4000-8000-000000000201",
        label: "Target account is hiring RevOps",
        url: "https://example.com/jobs/revops",
      }, {
        type: "outcome",
        id: "00000000-0000-4000-8000-000000000301",
        label: "positive reply",
      }],
    }],
  });

  assert.equal(brief.connector.memory_store.enabled, false);
  assert.equal(brief.connector.memory_store.status, "disabled");
  assert.equal(brief.cards.length, 6);
  assert.ok(
    brief.cards.every((card) => card.source_refs.length > 0),
    "every company brain card must carry source refs",
  );
  assert.equal(brief.cards[0]?.kind, "signal");
  assert.equal(brief.cards[0]?.primitive_refs.signal_id, "00000000-0000-4000-8000-000000000201");
  const meetingPrep = brief.cards.find((card) => card.kind === "meeting_prep");
  assert.ok(meetingPrep, "expected meeting prep to become shared company memory");
  assert.equal(meetingPrep.primitive_refs.conversation_id, "00000000-0000-4000-8000-000000000803");
  assert.equal(meetingPrep.primitive_refs.message_id, "00000000-0000-4000-8000-000000000805");
  assert.equal(meetingPrep.primitive_refs.outcome_id, "00000000-0000-4000-8000-000000000301");
  assert.equal(meetingPrep.primitive_refs.person_id, "00000000-0000-4000-8000-000000000804");

  const markdown = formatCompanyBrainMarkdown(brief);
  assert.match(markdown, /Memory Store connector disabled/);
  assert.match(markdown, /Target account is hiring RevOps/);
  assert.match(markdown, /Founder replied with meeting interest/);
  assert.match(markdown, /focused follow-up on the RevOps hiring signal/);
  assert.match(markdown, /icp:ai-gtm\|signal:hiring\|stage:cold_open/);
});

test("company brain treats Memory Store as optional connector", () => {
  const brief = buildCompanyBrainBrief({
    workspace_id: "00000000-0000-4000-8000-000000000001",
    generated_at: "2026-06-15T00:00:00.000Z",
    connectorEnv: {
      MEMORY_STORE_MCP_URL: "https://memory.example/mcp",
    },
    signals: [{
      id: "00000000-0000-4000-8000-000000000201",
      kind: "press_mention",
      title: "Fresh customer proof",
      status: "matched",
      match_score: 0.76,
      match_reason: "Proof point can ground outreach.",
      freshness_at: "2026-06-15T08:00:00.000Z",
      url: null,
    }],
  });

  assert.equal(brief.connector.memory_store.enabled, true);
  assert.equal(brief.connector.memory_store.status, "configured");
  assert.equal(brief.cards.length, 1);
});

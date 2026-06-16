import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  buildVerticalIntelligencePack,
  formatVerticalIntelligenceMarkdown,
  parseVerticalIntelligencePack,
} from "../core/product/vertical-intelligence.ts";

test("vertical intelligence builds source-referenced prompt context with confidence gating", () => {
  const workspace_id = randomUUID();
  const company_id = randomUUID();
  const evidenceSourceA = randomUUID();
  const evidenceSourceB = randomUUID();
  const icp_id = randomUUID();
  const rep_id = randomUUID();
  const pack = buildVerticalIntelligencePack({
    workspace_id,
    generated_at: "2026-06-15T10:00:00.000Z",
    run_id: "vertical-test-run",
    profile: {
      company_id,
      company_name: "Acme GTM",
      website_url: "https://acmegtm.example",
      industry: "AI GTM",
      description: "Helps lean GTM teams turn market signals into conversations.",
      evidence_source_ids: [evidenceSourceA, evidenceSourceB],
      intelligence: {
        market_terms: ["agentic outbound", "signal-led GTM"],
        positioning_notes: ["Acme is positioned around signal-led pipeline work."],
        competitor_mentions: ["Buyers compare Acme with outbound automation tools."],
        audience_terms: ["lean GTM teams"],
        proof_points: ["Customers use Acme to catch hiring and funding timing signals."],
      },
      updated_at: "2026-06-14T09:00:00.000Z",
    },
    icps: [{
      id: icp_id,
      name: "Series A revenue leaders",
      description: "Revenue leaders at companies that just raised funding.",
      must_haves: [{ field: "signal.kind", op: "eq", value: "funding" }],
      nice_to_haves: ["Hiring RevOps or growth roles"],
      match_threshold: 0.7,
      enabled: true,
      updated_at: "2026-06-14T11:00:00.000Z",
    }],
    semantic: [{
      id: randomUUID(),
      rep_id,
      subject_type: "workspace",
      subject_id: workspace_id,
      facts: {
        objection: "Procurement worries about another outbound tool.",
        pain: "Lean teams miss buying windows when signal review is manual.",
      },
      confidence: 0.42,
      last_observed_at: "2026-06-13T10:00:00.000Z",
    }],
    playbooks: [{
      id: randomUUID(),
      rep_id,
      pattern_key: "icp:series-a|signal:funding|skill:signal_problem_probe@v1",
      score: 0.81,
      win_count: 5,
      loss_count: 2,
      last_used_at: "2026-06-12T10:00:00.000Z",
      created_at: "2026-06-10T10:00:00.000Z",
    }],
  });

  assert.equal(pack.workspace_id, workspace_id);
  assert.equal(pack.company_id, company_id);
  assert.equal(pack.vertical, "AI GTM");
  assert.equal(pack.redaction_status, "source_refs_only");
  assert.deepEqual(pack.evidence_source_ids, [evidenceSourceA, evidenceSourceB]);

  const lowConfidenceObjection = pack.facts.find((fact) =>
    fact.category === "objection" && fact.statement.includes("Procurement worries")
  );
  assert.ok(lowConfidenceObjection, "expected low-confidence objection to be retained");
  assert.equal(lowConfidenceObjection.included_in_prompt, false);
  assert.equal(lowConfidenceObjection.primitive_refs.rep_id, rep_id);

  assert.ok(
    pack.facts.some((fact) =>
      fact.category === "proof" &&
      fact.statement.includes("Customers use Acme") &&
      fact.source_refs.some((ref) => ref.id === evidenceSourceA)
    ),
    "expected profile proof to keep evidence source refs",
  );
  assert.match(pack.prompt_context, /signal-led pipeline work/);
  assert.match(pack.prompt_context, /Customers use Acme/);
  assert.doesNotMatch(pack.prompt_context, /Procurement worries/);

  const rendered = formatVerticalIntelligenceMarkdown(pack, { limit: 3 });
  assert.match(rendered, /Vertical: AI GTM/);
  assert.doesNotMatch(rendered, /Procurement worries/);

  const parsed = parseVerticalIntelligencePack(JSON.parse(JSON.stringify(pack)));
  assert.ok(parsed, "expected parser to round-trip stored graph memory");
  assert.equal(parsed.company_id, company_id);
  assert.equal(parsed.facts.length, pack.facts.length);
});

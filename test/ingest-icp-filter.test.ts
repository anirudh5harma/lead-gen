import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allMatchingIcps,
  evaluateMustHaves,
  evaluateRule,
  firstMatchingIcp,
} from "../core/ingest/icp-filter.ts";
import type { IcpRow } from "../core/ingest/icps.ts";

function makeIcp(name: string, must_haves: IcpRow["must_haves"], enabled = true): IcpRow {
  return {
    id: name,
    workspace_id: "ws",
    name,
    description: "",
    must_haves,
    nice_to_haves: [],
    match_threshold: 0.6,
    enabled,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

test("evaluateRule: `in` matches array of allowed values", () => {
  const rule = { field: "kind", op: "in" as const, value: ["hiring", "funding"] };
  assert.equal(evaluateRule(rule, { kind: "hiring" }).passed, true);
  assert.equal(evaluateRule(rule, { kind: "press_mention" }).passed, false);
});

test("evaluateRule: `eq` is case-insensitive for strings", () => {
  const rule = { field: "company.industry", op: "eq" as const, value: "Fintech" };
  assert.equal(
    evaluateRule(rule, { company: { industry: "fintech" } }).passed,
    true,
  );
});

test("evaluateRule: `not_in` inverts the membership check", () => {
  const rule = { field: "structured.seniority", op: "not_in" as const, value: ["junior", "intern"] };
  assert.equal(
    evaluateRule(rule, { structured: { seniority: "staff" } }).passed,
    true,
  );
  assert.equal(
    evaluateRule(rule, { structured: { seniority: "junior" } }).passed,
    false,
  );
});

test("evaluateRule: `gte` / `lte` work on numbers + ISO dates", () => {
  const numRule = { field: "structured.amount", op: "gte" as const, value: 1_000_000 };
  assert.equal(
    evaluateRule(numRule, { structured: { amount: 5_000_000 } }).passed,
    true,
  );
  assert.equal(
    evaluateRule(numRule, { structured: { amount: 500_000 } }).passed,
    false,
  );

  const dateRule = {
    field: "freshness_at",
    op: "gte" as const,
    value: "2026-01-01T00:00:00Z",
  };
  assert.equal(
    evaluateRule(dateRule, { freshness_at: "2026-06-01T00:00:00Z" }).passed,
    true,
  );
  assert.equal(
    evaluateRule(dateRule, { freshness_at: "2025-06-01T00:00:00Z" }).passed,
    false,
  );
});

test("evaluateRule: `contains` on string substring + array element", () => {
  const stringRule = { field: "title", op: "contains" as const, value: "platform" };
  assert.equal(
    evaluateRule(stringRule, { title: "Staff Platform Engineer" }).passed,
    true,
  );
  assert.equal(
    evaluateRule(stringRule, { title: "Sales Lead" }).passed,
    false,
  );

  const arrRule = { field: "structured.tags", op: "contains" as const, value: "infra" };
  assert.equal(
    evaluateRule(arrRule, { structured: { tags: ["infra", "backend"] } }).passed,
    true,
  );
});

test("evaluateRule: `matches` runs a case-insensitive regex", () => {
  const rule = { field: "title", op: "matches" as const, value: "^(staff|senior)\\b" };
  assert.equal(
    evaluateRule(rule, { title: "Staff Engineer" }).passed,
    true,
  );
  assert.equal(
    evaluateRule(rule, { title: "Junior Engineer" }).passed,
    false,
  );
});

test("evaluateRule: missing field path resolves to undefined and fails most ops", () => {
  const rule = { field: "company.industry", op: "in" as const, value: ["fintech"] };
  assert.equal(evaluateRule(rule, {}).passed, false);
});

test("evaluateMustHaves: all rules must pass", () => {
  const icp = makeIcp("fintech-founders", [
    { field: "kind", op: "in", value: ["hiring", "funding"] },
    { field: "company.industry", op: "eq", value: "fintech" },
  ]);
  const ctx = {
    candidate: { kind: "hiring", company: { industry: "fintech" } },
  };
  assert.equal(evaluateMustHaves(icp, ctx).passed, true);

  const fails = evaluateMustHaves(icp, {
    candidate: { kind: "hiring", company: { industry: "healthcare" } },
  });
  assert.equal(fails.passed, false);
  assert.equal(fails.failed_rule?.field, "company.industry");
});

test("firstMatchingIcp / allMatchingIcps: skip disabled ICPs", () => {
  const a = makeIcp("a", [{ field: "kind", op: "eq", value: "hiring" }], false);
  const b = makeIcp("b", [{ field: "kind", op: "eq", value: "hiring" }], true);
  const ctx = { candidate: { kind: "hiring" } };
  assert.equal(firstMatchingIcp([a, b], ctx)?.id, "b");
  assert.deepEqual(allMatchingIcps([a, b], ctx).map((i) => i.id), ["b"]);
});

test("allMatchingIcps: returns every ICP whose must_haves pass", () => {
  const a = makeIcp("a", [{ field: "kind", op: "in", value: ["hiring"] }]);
  const b = makeIcp("b", [{ field: "company.industry", op: "eq", value: "fintech" }]);
  const c = makeIcp("c", [{ field: "kind", op: "eq", value: "funding" }]);
  const ctx = {
    candidate: { kind: "hiring", company: { industry: "fintech" } },
  };
  const matches = allMatchingIcps([a, b, c], ctx);
  assert.deepEqual(matches.map((i) => i.id).sort(), ["a", "b"]);
});

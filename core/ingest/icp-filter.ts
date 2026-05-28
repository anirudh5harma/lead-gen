import type { IcpPredicateRule, IcpRow } from "./icps.ts";

/**
 * Structured ICP predicate evaluator. Runs before any LLM matching call;
 * if a candidate fails an ICP's must_haves, we skip the LLM entirely.
 * This is the cheapest possible filter — it's what keeps the bill low.
 *
 * Supported ops (intentionally minimal):
 *   in        — value ∈ rule.value (array)
 *   not_in    — value ∉ rule.value (array)
 *   eq        — value === rule.value
 *   gte / lte — numeric or ISO-date comparison
 *   contains  — string contains substring; array contains element
 *   matches   — regex match
 *
 * Field paths are dotted, evaluated against the supplied object. The
 * caller is responsible for shaping the object — typically:
 *
 *   { kind, freshness_at, company: { industry, size_bucket, ... },
 *     structured: { ... adapter-extracted fields ... }, ... }
 */

export interface PredicateContext {
  /** The candidate object the rule paths resolve against. */
  candidate: Record<string, unknown>;
}

export interface PredicateResult {
  passed: boolean;
  /** When not passed, the rule that failed. */
  failed_rule?: IcpPredicateRule;
  /** The resolved value at the rule's field path. */
  failed_value?: unknown;
}

export function evaluateRule(
  rule: IcpPredicateRule,
  candidate: Record<string, unknown>,
): PredicateResult {
  const value = getByPath(candidate, rule.field);
  if (!opMatches(rule.op, value, rule.value)) {
    return { passed: false, failed_rule: rule, failed_value: value };
  }
  return { passed: true };
}

/**
 * Evaluate every must_have rule for an ICP. ALL must pass.
 */
export function evaluateMustHaves(
  icp: Pick<IcpRow, "must_haves">,
  ctx: PredicateContext,
): PredicateResult {
  for (const rule of icp.must_haves) {
    const r = evaluateRule(rule, ctx.candidate);
    if (!r.passed) return r;
  }
  return { passed: true };
}

/**
 * Try every ICP segment in order; return the first segment whose
 * must_haves pass (so the LLM scoring step only has to run for those).
 * Returns null if none pass.
 */
export function firstMatchingIcp(
  icps: ReadonlyArray<IcpRow>,
  ctx: PredicateContext,
): IcpRow | null {
  for (const icp of icps) {
    if (!icp.enabled) continue;
    if (evaluateMustHaves(icp, ctx).passed) return icp;
  }
  return null;
}

/**
 * Return EVERY ICP whose must_haves pass — the fanout step uses this so
 * a candidate can match multiple segments (workspaces with several
 * overlapping ICPs).
 */
export function allMatchingIcps(
  icps: ReadonlyArray<IcpRow>,
  ctx: PredicateContext,
): IcpRow[] {
  return icps.filter(
    (icp) => icp.enabled && evaluateMustHaves(icp, ctx).passed,
  );
}

// ─── internals ────────────────────────────────────────────────────────────

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj;
  for (const segment of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[segment];
  }
  return cur;
}

function opMatches(op: string, value: unknown, ruleValue: unknown): boolean {
  switch (op) {
    case "in":
      return Array.isArray(ruleValue) && ruleValue.some((v) => sameValue(v, value));
    case "not_in":
      return !(Array.isArray(ruleValue) && ruleValue.some((v) => sameValue(v, value)));
    case "eq":
      return sameValue(ruleValue, value);
    case "gte":
      return compare(value, ruleValue) >= 0;
    case "lte":
      return compare(value, ruleValue) <= 0;
    case "contains":
      if (Array.isArray(value)) {
        return value.some((v) => sameValue(v, ruleValue));
      }
      if (typeof value === "string" && typeof ruleValue === "string") {
        return value.toLowerCase().includes(ruleValue.toLowerCase());
      }
      return false;
    case "matches":
      if (typeof value !== "string" || typeof ruleValue !== "string") return false;
      try {
        return new RegExp(ruleValue, "i").test(value);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a === b;
  if (typeof a === "string" && typeof b === "string") {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

function compare(a: unknown, b: unknown): number {
  // Try numeric first.
  const an = Number(a);
  const bn = Number(b);
  if (!Number.isNaN(an) && !Number.isNaN(bn)) {
    return an === bn ? 0 : an < bn ? -1 : 1;
  }
  // ISO-date strings.
  if (typeof a === "string" && typeof b === "string") {
    const ad = Date.parse(a);
    const bd = Date.parse(b);
    if (!Number.isNaN(ad) && !Number.isNaN(bd)) {
      return ad === bd ? 0 : ad < bd ? -1 : 1;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return 0;
}

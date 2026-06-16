import type { SignalKind } from "../primitives/signal.ts";
import type { RawCandidate } from "./types.ts";

export type SignalSourceTier =
  | "official"
  | "trusted"
  | "aggregator"
  | "community"
  | "provider"
  | "unknown";

export interface SignalQualityInput {
  adapter_id: string;
  source_name: string;
  source_config: Record<string, unknown>;
  source_properties?: Record<string, unknown> | null;
  item: RawCandidate;
  kind: SignalKind | null;
  now?: Date;
}

export interface SignalQualityMetadata {
  properties: Record<string, unknown>;
  provenance: Record<string, unknown>;
}

const BUYING_INTENT_VERSION = "buying_intent.v1";
const CREDIBILITY_VERSION = "source_credibility.v1";
const QUALITY_VERSION = "signal_quality.v1";

export function deriveSignalQualityMetadata(
  input: SignalQualityInput,
): SignalQualityMetadata {
  const tier = sourceTier(input);
  const authority = sourceAuthority(tier, input);
  const normalizedUrl = canonicalUrl(input.item.url);
  const originalUrl = stringValue(input.item.url);
  const credibilityReasons = credibilityReasonsFor(input, tier);
  const buying = buyingIntentFor(input);
  const timing = timingFor(input);
  const score = clamp01(
    authority * 0.25 + buying.score * 0.45 + timing.score * 0.3,
  );

  return {
    properties: {
      source_tier: tier,
      source_authority: authority,
      source_confidence: authority,
      canonical_url: normalizedUrl,
      original_url: originalUrl ?? normalizedUrl,
      source_credibility: {
        version: CREDIBILITY_VERSION,
        tier,
        score: authority,
        reasons: credibilityReasons,
      },
      buying_intent: buying,
      timing,
      signal_quality: {
        version: QUALITY_VERSION,
        score,
        level: qualityLevel(score),
        reasons: [
          ...credibilityReasons.slice(0, 2),
          ...buying.reasons.slice(0, 3),
          timing.reason,
        ].filter(Boolean),
      },
    },
    provenance: {
      source_tier: tier,
      source_authority: authority,
      canonical_url: normalizedUrl,
      original_url: originalUrl ?? normalizedUrl,
      quality_model: QUALITY_VERSION,
    },
  };
}

function sourceTier(input: SignalQualityInput): SignalSourceTier {
  const configured = stringValue(input.source_config.source_tier);
  if (isSignalSourceTier(configured)) return configured;
  const projected = stringValue(input.source_properties?.source_tier);
  if (isSignalSourceTier(projected)) return projected;

  const adapter = input.adapter_id.toLowerCase();
  if (
    adapter === "greenhouse" ||
    adapter === "lever" ||
    adapter === "ashby" ||
    adapter === "workable" ||
    adapter === "sec_edgar"
  ) {
    return "official";
  }
  if (adapter === "rss" && hasCompanyDomain(input.source_config, input.item.url)) {
    return "official";
  }
  if (adapter === "product_hunt" || adapter === "hn_whos_hiring") return "trusted";
  if (adapter === "hn_front") return "community";
  if (adapter === "google_news" || adapter === "exa") return "aggregator";
  if (adapter === "reddit" || adapter === "x_search") return "community";
  if (adapter === "webhook") return "provider";
  return "unknown";
}

function sourceAuthority(
  tier: SignalSourceTier,
  input: SignalQualityInput,
): number {
  const configured = numberValue(input.source_config.source_authority) ??
    numberValue(input.source_properties?.source_authority);
  if (configured !== null) return clamp01(configured);
  switch (tier) {
    case "official":
      return 0.95;
    case "trusted":
      return 0.82;
    case "provider":
      return 0.72;
    case "aggregator":
      return 0.66;
    case "community":
      return 0.58;
    case "unknown":
      return 0.45;
  }
}

function credibilityReasonsFor(
  input: SignalQualityInput,
  tier: SignalSourceTier,
): string[] {
  const adapter = input.adapter_id.toLowerCase();
  if (tier === "official") {
    if (adapter === "rss") return ["official company-owned feed"];
    if (adapter === "sec_edgar") return ["official regulatory filing source"];
    return ["official employer job-board source"];
  }
  if (adapter === "google_news") return ["news aggregator result; original source should corroborate"];
  if (adapter === "exa") return ["open-web search result with source URL provenance"];
  if (adapter === "product_hunt") return ["launch source with public product metadata"];
  if (adapter === "hn_whos_hiring") return ["public hiring thread with direct employer posts"];
  if (adapter === "reddit" || adapter === "hn_front" || adapter === "x_search") {
    return ["community/social source; useful for intent, lower standalone authority"];
  }
  return [`source adapter ${input.adapter_id}`];
}

function buyingIntentFor(input: SignalQualityInput): {
  version: string;
  score: number;
  level: "high" | "medium" | "low";
  reasons: string[];
} {
  const kind = input.kind;
  let score = baseIntentScore(kind);
  const reasons: string[] = kind ? [`${kind} signal`] : ["unclassified signal"];
  const text = signalText(input);
  const structured = input.item.structured ?? {};

  const highIntentPatterns: Array<[RegExp, string, number]> = [
    [/\b(alternative to|alternatives to|switching from|migrating from|replace(?:ing)?|rip out)\b/i, "replacement or competitor-switching language", 0.22],
    [/\b(looking for|recommend(?:ation)?s?|anyone using|evaluating|shortlist|rfp|procurement)\b/i, "active evaluation language", 0.18],
    [/\b(pricing|too expensive|contract renewal|renewal|budget approved|implementation partner)\b/i, "budget or implementation timing language", 0.14],
    [/\b(vp sales|chief revenue|cro|head of sales|revops|sales ops|gtm|growth lead|customer success)\b/i, "go-to-market hiring or leadership trigger", 0.14],
    [/\b(series a|series b|series c|raised|funding|financing|expansion|new office)\b/i, "capital or expansion trigger", 0.12],
    [/\b(hiring|job opening|open roles|founding ae|founding engineer|sales engineer)\b/i, "active hiring trigger", 0.12],
  ];
  for (const [pattern, reason, boost] of highIntentPatterns) {
    if (pattern.test(text)) {
      score += boost;
      reasons.push(reason);
    }
  }

  const fn = stringValue(structured.function);
  const seniority = stringValue(structured.seniority);
  if (fn && ["sales", "marketing", "customer_success", "operations"].includes(fn)) {
    score += 0.08;
    reasons.push(`${fn.replace(/_/g, " ")} function`);
  }
  if (
    seniority &&
    ["vp", "c_level", "director", "head", "founding", "lead"].includes(seniority)
  ) {
    score += 0.08;
    reasons.push(`${seniority.replace(/_/g, " ")} seniority`);
  }

  const tier = sourceTier(input);
  if (tier === "official" && kind === "hiring") score += 0.08;
  if (tier === "community" && /complain|frustrat|broken|doesn't work|too expensive/i.test(text)) {
    score += 0.12;
    reasons.push("pain-point language from community source");
  }

  const finalScore = clamp01(score);
  return {
    version: BUYING_INTENT_VERSION,
    score: finalScore,
    level: intentLevel(finalScore),
    reasons: unique(reasons).slice(0, 8),
  };
}

function timingFor(input: SignalQualityInput): {
  score: number;
  freshness_hours: number | null;
  conversion_window: "now" | "this_week" | "monitor" | "stale";
  reason: string;
} {
  const now = input.now ?? new Date();
  const eventMs = Date.parse(input.item.freshness_at);
  if (Number.isNaN(eventMs)) {
    return {
      score: 0.35,
      freshness_hours: null,
      conversion_window: "monitor",
      reason: "freshness timestamp unavailable",
    };
  }
  const hours = Math.max(0, (now.getTime() - eventMs) / 3_600_000);
  const kindBoost = input.kind === "competitor_move" || input.kind === "churn_risk"
    ? 0.08
    : input.kind === "hiring" || input.kind === "funding"
      ? 0.04
      : 0;
  const score = clamp01(freshnessScore(hours) + kindBoost);
  return {
    score,
    freshness_hours: Number(hours.toFixed(2)),
    conversion_window:
      hours <= 24 ? "now" : hours <= 168 ? "this_week" : hours <= 720 ? "monitor" : "stale",
    reason:
      hours <= 24
        ? "fresh event; timing is strong"
        : hours <= 168
          ? "recent event; act this week"
          : hours <= 720
            ? "older event; monitor or corroborate"
            : "stale event; avoid automated outreach unless corroborated",
  };
}

function baseIntentScore(kind: SignalKind | null): number {
  switch (kind) {
    case "competitor_move":
    case "churn_risk":
      return 0.82;
    case "hiring":
      return 0.78;
    case "funding":
    case "expansion":
      return 0.74;
    case "acquisition":
    case "leadership_change":
      return 0.7;
    case "product_launch":
      return 0.62;
    case "podcast_mention":
    case "regulation":
      return 0.52;
    case "press_mention":
      return 0.44;
    case "layoff":
      return 0.4;
    case "other":
    case null:
      return 0.32;
  }
}

function freshnessScore(hours: number): number {
  if (hours <= 6) return 1;
  if (hours <= 24) return 0.92;
  if (hours <= 72) return 0.8;
  if (hours <= 168) return 0.66;
  if (hours <= 720) return 0.45;
  return 0.2;
}

function signalText(input: SignalQualityInput): string {
  return [
    input.source_name,
    input.item.title,
    input.item.content,
    input.item.url,
    JSON.stringify(input.item.structured ?? {}),
  ].filter(Boolean).join("\n");
}

function hasCompanyDomain(config: Record<string, unknown>, itemUrl: string | undefined): boolean {
  const configured = firstString(
    config.company_domain,
    config.target_company_domain,
    config.novelty_domain,
    config.domain,
    config.website_url,
  );
  if (!configured) return false;
  const configuredDomain = domainFromUnknown(configured);
  const itemDomain = domainFromUnknown(itemUrl);
  if (!configuredDomain) return true;
  return itemDomain === null || itemDomain === configuredDomain ||
    itemDomain.endsWith(`.${configuredDomain}`);
}

function intentLevel(score: number): "high" | "medium" | "low" {
  if (score >= 0.72) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

function qualityLevel(score: number): "high" | "medium" | "low" {
  if (score >= 0.76) return "high";
  if (score >= 0.55) return "medium";
  return "low";
}

function isSignalSourceTier(value: unknown): value is SignalSourceTier {
  return value === "official" ||
    value === "trusted" ||
    value === "aggregator" ||
    value === "community" ||
    value === "provider" ||
    value === "unknown";
}

function canonicalUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|ref_)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value.trim();
  }
}

function domainFromUnknown(value: unknown): string | null {
  const text = stringValue(value);
  if (!text) return null;
  try {
    const url = text.includes("://") ? new URL(text) : new URL(`https://${text}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    const match = text.toLowerCase().match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/);
    return match?.[1]?.replace(/^www\./, "") ?? null;
  }
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | null {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(raw) ? raw : null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}

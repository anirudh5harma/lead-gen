import type { SignalKind } from "../primitives/signal.ts";

export const EXA_SOCIAL_PLATFORMS = ["x", "linkedin"] as const;
export type ExaSocialPlatform = typeof EXA_SOCIAL_PLATFORMS[number];

export const EXA_SOCIAL_SIGNAL_INTENTS = [
  "hiring",
  "funding",
  "product_launch",
  "feature_release",
  "leadership_change",
  "acquisition",
  "expansion",
  "regulation",
  "buyer_intent",
  "pain",
] as const;
export type ExaSocialSignalIntent = typeof EXA_SOCIAL_SIGNAL_INTENTS[number];

interface ExaSocialIntentPreset {
  label: string;
  signal_kind: SignalKind;
  description: string;
  phrases: readonly string[];
}

const EXA_SOCIAL_INTENT_PRESETS: Record<
  ExaSocialSignalIntent,
  ExaSocialIntentPreset
> = {
  hiring: {
    label: "hiring",
    signal_kind: "hiring",
    description: "hiring announcements, open roles, recruiting pushes, and team growth",
    phrases: [
      "we're hiring",
      "hiring now",
      "open roles",
      "hiring sales",
      "hiring growth",
      "hiring revops",
      "hiring partnerships",
      "headcount growth",
      "building the team",
      "recruiting",
    ],
  },
  funding: {
    label: "funding",
    signal_kind: "funding",
    description: "fundraising announcements across seed, Series A, and growth rounds",
    phrases: [
      "raised seed",
      "raised pre-seed",
      "series a",
      "series b",
      "funding round",
      "venture capital",
      "backed by",
      "announcing our round",
      "new investment",
    ],
  },
  product_launch: {
    label: "product launches",
    signal_kind: "product_launch",
    description: "new products, launches, releases, and public availability announcements",
    phrases: [
      "launching today",
      "now live",
      "new product",
      "product launch",
      "general availability",
      "public beta",
      "launch week",
      "just launched",
    ],
  },
  feature_release: {
    label: "feature releases",
    signal_kind: "product_launch",
    description: "new feature drops, shipping notes, integrations, and roadmap moments",
    phrases: [
      "new feature",
      "shipping today",
      "shipped",
      "product update",
      "feature release",
      "now supports",
      "new integration",
      "changelog",
    ],
  },
  leadership_change: {
    label: "leadership changes",
    signal_kind: "leadership_change",
    description: "executive hires, promotions, appointments, and leadership transitions",
    phrases: [
      "appointed ceo",
      "new cfo",
      "new cto",
      "new cro",
      "joined as vp",
      "leadership team",
      "executive hire",
      "welcome our",
    ],
  },
  acquisition: {
    label: "acquisitions",
    signal_kind: "acquisition",
    description: "M&A announcements, mergers, and acquisitions",
    phrases: [
      "acquired by",
      "acquisition",
      "merger",
      "joining forces",
      "strategic acquisition",
      "to acquire",
    ],
  },
  expansion: {
    label: "expansion",
    signal_kind: "expansion",
    description: "new markets, offices, geographies, and team expansion",
    phrases: [
      "expanding into",
      "new office",
      "new market",
      "opening in",
      "international expansion",
      "growing in",
    ],
  },
  regulation: {
    label: "regulation",
    signal_kind: "regulation",
    description: "compliance updates, regulatory changes, and enforcement announcements",
    phrases: [
      "regulation",
      "compliance update",
      "sec",
      "finra",
      "fda",
      "regulatory",
      "policy update",
      "enforcement",
    ],
  },
  buyer_intent: {
    label: "buyer intent",
    signal_kind: "competitor_move",
    description: "vendor searches, replacement discussions, and active evaluation language",
    phrases: [
      "looking for a tool",
      "recommendation for",
      "alternative to",
      "switching from",
      "evaluating vendors",
      "rfp",
      "vendor selection",
      "buying software",
    ],
  },
  pain: {
    label: "pain signals",
    signal_kind: "churn_risk",
    description: "urgent operational pain, incidents, migration pressure, and cost-cutting moves",
    phrases: [
      "data breach",
      "security incident",
      "cost cutting",
      "automation initiative",
      "migrating off",
      "platform migration",
      "lawsuit",
      "investigation",
    ],
  },
};

const PLATFORM_LABELS: Record<ExaSocialPlatform, string> = {
  x: "X/Twitter",
  linkedin: "LinkedIn",
};

const PLATFORM_DOMAINS: Record<ExaSocialPlatform, readonly string[]> = {
  x: [],
  linkedin: ["linkedin.com"],
};

export function normalizeExaSocialPlatforms(
  platforms?: readonly ExaSocialPlatform[] | null,
): ExaSocialPlatform[] {
  const normalized = dedupeStrings(platforms ?? []).filter(
    (value): value is ExaSocialPlatform => value === "x" || value === "linkedin",
  );
  return normalized.length ? normalized : [...EXA_SOCIAL_PLATFORMS];
}

export function normalizeExaSocialIntents(
  intents?: readonly ExaSocialSignalIntent[] | null,
): ExaSocialSignalIntent[] {
  return dedupeStrings(intents ?? []).flatMap((value) =>
    EXA_SOCIAL_SIGNAL_INTENTS.includes(value as ExaSocialSignalIntent)
      ? [value as ExaSocialSignalIntent]
      : []
  );
}

export function defaultExaSocialIntentsForSignalKind(
  signalKind?: string | null,
): ExaSocialSignalIntent[] {
  switch (signalKind) {
    case "hiring":
      return ["hiring"];
    case "funding":
      return ["funding"];
    case "product_launch":
      return ["product_launch", "feature_release"];
    case "leadership_change":
      return ["leadership_change"];
    case "acquisition":
      return ["acquisition"];
    case "expansion":
      return ["expansion"];
    case "regulation":
      return ["regulation"];
    case "competitor_move":
      return ["buyer_intent"];
    case "churn_risk":
      return ["pain"];
    case "press_mention":
      return ["funding", "product_launch", "leadership_change"];
    default:
      return ["hiring", "funding", "product_launch", "feature_release"];
  }
}

export function exaSocialPlatformDomains(
  platforms?: readonly ExaSocialPlatform[] | null,
): string[] {
  return dedupeStrings(
    normalizeExaSocialPlatforms(platforms).flatMap((platform) => PLATFORM_DOMAINS[platform]),
  );
}

export function exaSocialFreshnessStartDate(
  freshnessDays?: number | null,
  now = new Date(),
): string {
  const days = clampFreshnessDays(freshnessDays);
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function buildExaSocialSignalQuery(input: {
  company_name?: string | null;
  industry?: string | null;
  signal_keywords?: string | null;
  competitor_watchlist?: string | null;
  linkedin_signal_behaviors?: string | null;
  platforms?: readonly ExaSocialPlatform[] | null;
  intents?: readonly ExaSocialSignalIntent[] | null;
  signal_kind?: string | null;
  freshness_days?: number | null;
}): {
  query: string;
  intents: ExaSocialSignalIntent[];
  platforms: ExaSocialPlatform[];
  include_domains: string[];
  source_name: string;
} {
  const platforms = normalizeExaSocialPlatforms(input.platforms);
  const intents = normalizeExaSocialIntents(input.intents);
  const resolvedIntents = intents.length
    ? intents
    : defaultExaSocialIntentsForSignalKind(input.signal_kind);
  const include_domains = exaSocialPlatformDomains(platforms);
  const platformLabel = formatPlatformLabel(platforms);
  const marketLabel = cleanSentence(
    input.industry,
  ) ?? cleanSentence(input.company_name) ?? "B2B SaaS";
  const intentSummary = resolvedIntents
    .map((intent) => EXA_SOCIAL_INTENT_PRESETS[intent].description)
    .join("; ");
  const phrases = dedupeStrings([
    ...resolvedIntents.flatMap((intent) => EXA_SOCIAL_INTENT_PRESETS[intent].phrases.slice(0, 4)),
    ...splitTerms(input.signal_keywords),
  ]).slice(0, 20);
  const watchlist = dedupeStrings(splitTerms(input.competitor_watchlist)).slice(0, 8);
  const behaviors = dedupeStrings(splitTerms(input.linkedin_signal_behaviors)).slice(0, 6);
  const freshnessDays = clampFreshnessDays(input.freshness_days);
  const label = sourceLabelForIntents(resolvedIntents);

  const parts = [
    `Latest public posts on ${platformLabel} from the last ${freshnessDays} days about ${marketLabel}.`,
    `Focus on ${intentSummary}.`,
    "Prefer direct company-page posts, founder updates, executive updates, recruiter posts, product updates, and GTM team announcements.",
  ];

  if (phrases.length) {
    parts.push(`Keywords and phrases: ${phrases.map((phrase) => JSON.stringify(phrase)).join(", ")}.`);
  }
  if (watchlist.length) {
    parts.push(`Competitors or watchlist terms: ${watchlist.map((term) => JSON.stringify(term)).join(", ")}.`);
  }
  if (behaviors.length) {
    parts.push(`Engagement or behavior hints: ${behaviors.map((term) => JSON.stringify(term)).join(", ")}.`);
  }

  return {
    query: parts.join(" "),
    intents: resolvedIntents,
    platforms,
    include_domains,
    source_name: `Exa ${platformLabel} ${label}`,
  };
}

function formatPlatformLabel(platforms: readonly ExaSocialPlatform[]): string {
  const labels = platforms.map((platform) => PLATFORM_LABELS[platform]);
  if (labels.length <= 1) return labels[0] ?? "public web";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

function sourceLabelForIntents(intents: readonly ExaSocialSignalIntent[]): string {
  if (intents.length === 1) {
    return `${EXA_SOCIAL_INTENT_PRESETS[intents[0]].label} posts`;
  }
  if (intents.length === 2) {
    return `${EXA_SOCIAL_INTENT_PRESETS[intents[0]].label} + ${
      EXA_SOCIAL_INTENT_PRESETS[intents[1]].label
    } posts`;
  }
  return "signal posts";
}

function splitTerms(value?: string | null): string[] {
  return (value ?? "")
    .split(/[\n,]+/g)
    .map((term) => term.trim())
    .filter(Boolean);
}

function cleanSentence(value?: string | null): string | null {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned : null;
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = value.trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function clampFreshnessDays(value?: number | null): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 7;
  return Math.max(1, Math.min(Math.trunc(value), 30));
}

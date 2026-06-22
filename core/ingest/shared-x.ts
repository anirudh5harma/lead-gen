import { normalizeCompanyDomain } from "./company-domain.ts";
import type { TrackedCompany } from "./catalog.ts";
import type { RawCandidate } from "./types.ts";
import type { SignalKind } from "../primitives/signal.ts";
import type { XSearchProvider } from "./adapters/x-search.ts";

const TWITTERAPI_IO_ITEM_USD = 0.00015;
const SOCIALDATA_ITEM_USD = 0.0002;
const OFFICIAL_X_ITEM_USD = 0.005;

export const SHARED_X_SOURCE_ADAPTER = "x_search_shared";
export const SHARED_X_POLL_WORKFLOW = "ingest_shared_x_poll";

export interface SharedXRule {
  id: string;
  name: string;
  query: string;
  signal_kind: SignalKind;
  enabled?: boolean;
  limit?: number;
  cadence_hours?: number;
}

export interface SharedXRuleState {
  cursor?: Record<string, unknown>;
  last_polled_at?: string | null;
  last_error?: Record<string, unknown> | null;
  last_result_count?: number;
}

export interface SharedXSourceConfig {
  provider: XSearchProvider;
  monthly_budget_usd: number;
  rules: SharedXRule[];
  runtime_state?: {
    rules?: Record<string, SharedXRuleState>;
  };
}

export interface SharedTrackedCompanyMatch {
  company_id: string;
  company_name: string;
  company_domain: string | null;
  link_reason: "company_domain" | "company_name" | "author_name";
}

export const DEFAULT_SHARED_X_RULES: readonly SharedXRule[] = [
  {
    id: "hiring_core",
    name: "X hiring core",
    signal_kind: "hiring",
    cadence_hours: 6,
    limit: 15,
    query: `("we're hiring" OR "hiring now" OR "open roles") lang:en -is:retweet`,
  },
  {
    id: "hiring_gtm",
    name: "X hiring GTM",
    signal_kind: "hiring",
    cadence_hours: 6,
    limit: 15,
    query: `("hiring sales" OR "hiring ae" OR "hiring revops" OR "hiring growth") lang:en -is:retweet`,
  },
  {
    id: "funding_seed",
    name: "X funding seed",
    signal_kind: "funding",
    cadence_hours: 6,
    limit: 15,
    query: `("raised pre-seed" OR "raised seed" OR "seed round") lang:en -is:retweet`,
  },
  {
    id: "funding_growth",
    name: "X funding growth",
    signal_kind: "funding",
    cadence_hours: 6,
    limit: 15,
    query: `("series a" OR "series b" OR "announcing our round") lang:en -is:retweet`,
  },
  {
    id: "launch_core",
    name: "X launch core",
    signal_kind: "product_launch",
    cadence_hours: 6,
    limit: 15,
    query: `("launching today" OR "now live" OR "just launched") lang:en -is:retweet`,
  },
  {
    id: "feature_release",
    name: "X feature releases",
    signal_kind: "product_launch",
    cadence_hours: 6,
    limit: 15,
    query: `("new feature" OR "shipping today" OR "product update") lang:en -is:retweet`,
  },
  {
    id: "leadership",
    name: "X leadership changes",
    signal_kind: "leadership_change",
    cadence_hours: 6,
    limit: 12,
    query: `("new cro" OR "new cto" OR "joined as vp" OR "executive hire") lang:en -is:retweet`,
  },
  {
    id: "buyer_intent_alt",
    name: "X buyer intent alternatives",
    signal_kind: "competitor_move",
    cadence_hours: 6,
    limit: 12,
    query: `("alternative to" OR "alternatives to" OR "switching from") lang:en -is:retweet`,
  },
  {
    id: "buyer_intent_eval",
    name: "X buyer intent evaluation",
    signal_kind: "competitor_move",
    cadence_hours: 6,
    limit: 12,
    query: `("looking for recommendations" OR "evaluating vendors" OR "vendor selection" OR "rfp") lang:en -is:retweet`,
  },
  {
    id: "pain_cost",
    name: "X pain cost pressure",
    signal_kind: "churn_risk",
    cadence_hours: 6,
    limit: 12,
    query: `("too expensive" OR "cost cutting" OR "budget cut") lang:en -is:retweet`,
  },
  {
    id: "pain_incident",
    name: "X pain incidents",
    signal_kind: "churn_risk",
    cadence_hours: 6,
    limit: 12,
    query: `("data breach" OR "security incident" OR "major outage") lang:en -is:retweet`,
  },
  {
    id: "migration",
    name: "X migration pressure",
    signal_kind: "churn_risk",
    cadence_hours: 6,
    limit: 12,
    query: `("migrating off" OR "platform migration" OR "replacing our") lang:en -is:retweet`,
  },
] as const;

export function defaultSharedXSourceConfig(): SharedXSourceConfig {
  return {
    provider: "twitterapi_io",
    monthly_budget_usd: 10,
    rules: [...DEFAULT_SHARED_X_RULES],
    runtime_state: { rules: {} },
  };
}

export function sharedXMonthlyCostEstimateUsd(
  config: Pick<SharedXSourceConfig, "provider" | "rules">,
): number {
  const rate = providerItemCostUsd(config.provider);
  const monthlyItems = config.rules
    .filter((rule) => rule.enabled !== false)
    .reduce((sum, rule) => {
      const cadenceHours = clampCadenceHours(rule.cadence_hours);
      const limit = clampRuleLimit(rule.limit);
      return sum + limit * Math.floor((24 / cadenceHours) * 30);
    }, 0);
  return Number((monthlyItems * rate).toFixed(2));
}

export function sharedXRuleState(
  config: SharedXSourceConfig,
  ruleId: string,
): SharedXRuleState {
  return config.runtime_state?.rules?.[ruleId] ?? {};
}

export function nextSharedXRuntimeState(
  config: SharedXSourceConfig,
  ruleId: string,
  state: SharedXRuleState,
): Record<string, unknown> {
  const currentRules = config.runtime_state?.rules ?? {};
  return {
    rules: {
      ...currentRules,
      [ruleId]: state,
    },
  };
}

export function clampRuleLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 15;
  return Math.max(5, Math.min(Math.trunc(value), 25));
}

export function clampCadenceHours(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 6;
  return Math.max(4, Math.min(Math.trunc(value), 24));
}

export function createTrackedCompanyResolver(companies: readonly TrackedCompany[]) {
  const byDomain = new Map<string, TrackedCompany[]>();
  const byName = new Map<string, TrackedCompany[]>();
  const regexes = companies
    .map((company) => ({
      company,
      normalizedName: normalizeCompanyName(company.name),
      regex: companyNameRegex(company.name),
    }))
    .filter((candidate) => candidate.regex !== null)
    .sort((a, b) => b.company.name.length - a.company.name.length);

  for (const company of companies) {
    const domain = normalizeCompanyDomain(company.domain);
    if (domain) {
      const existing = byDomain.get(domain) ?? [];
      existing.push(company);
      byDomain.set(domain, existing);
    }
    const normalizedName = normalizeCompanyName(company.name);
    if (normalizedName) {
      const existing = byName.get(normalizedName) ?? [];
      existing.push(company);
      byName.set(normalizedName, existing);
    }
  }

  return {
    resolve(item: Pick<RawCandidate, "title" | "content" | "structured" | "url">): SharedTrackedCompanyMatch | null {
      const structured = recordValue(item.structured);
      const domainCandidate = firstDomain(
        structured?.company_domain,
        structured?.domain,
        structured?.linked_domain,
        item.url,
      );
      if (domainCandidate) {
        const matches = byDomain.get(domainCandidate) ?? [];
        if (matches.length === 1) {
          return {
            company_id: matches[0].id,
            company_name: matches[0].name,
            company_domain: matches[0].domain,
            link_reason: "company_domain",
          };
        }
      }

      const directNames = [
        cleanString(structured?.company_name),
        cleanString(structured?.author_name),
      ].filter(Boolean) as string[];
      for (const value of directNames) {
        const matches = byName.get(normalizeCompanyName(value)) ?? [];
        if (matches.length === 1) {
          return {
            company_id: matches[0].id,
            company_name: matches[0].name,
            company_domain: matches[0].domain,
            link_reason: value === cleanString(structured?.author_name)
              ? "author_name"
              : "company_name",
          };
        }
      }

      const text = [item.title, item.content, cleanString(structured?.author_name)]
        .filter(Boolean)
        .join("\n");
      const matched = new Map<string, TrackedCompany>();
      for (const candidate of regexes) {
        if (!candidate.regex?.test(text)) continue;
        matched.set(candidate.company.id, candidate.company);
        if (matched.size > 1) return null;
      }
      const company = matched.values().next().value as TrackedCompany | undefined;
      if (!company) return null;
      return {
        company_id: company.id,
        company_name: company.name,
        company_domain: company.domain,
        link_reason: "company_name",
      };
    },
  };
}

function providerItemCostUsd(provider: XSearchProvider): number {
  switch (provider) {
    case "socialdata":
      return SOCIALDATA_ITEM_USD;
    case "twitterapi_io":
      return TWITTERAPI_IO_ITEM_USD;
    case "x_official":
      return OFFICIAL_X_ITEM_USD;
  }
}

function firstDomain(...values: unknown[]): string | null {
  for (const value of values) {
    const domain = normalizeCompanyDomain(value);
    if (domain) return domain;
  }
  return null;
}

function normalizeCompanyName(value: string | null | undefined): string {
  return cleanString(value)?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? "";
}

function companyNameRegex(name: string): RegExp | null {
  const normalized = normalizeCompanyName(name);
  if (normalized.length < 4) return null;
  const escaped = normalized
    .split(" ")
    .filter(Boolean)
    .map((part) => escapeRegex(part))
    .join("\\s+");
  if (!escaped) return null;
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { EventBus } from "../substrate/events/index.ts";
import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../substrate/workflows/index.ts";
import type { EmbeddingClient } from "./embeddings.ts";
import { vectorToPgLiteral } from "./embeddings.ts";
import { dedupCheck, recordCollision } from "./novelty.ts";
import { fanoutCandidate } from "./fanout.ts";
import type { TrackedCompany } from "./catalog.ts";
import {
  getPlatformSourceByAdapter,
  updatePlatformSourceRuntimeState,
} from "./sources.ts";
import { pollXSearchSource, type XSearchProvider } from "./adapters/x-search.ts";
import {
  clampCadenceHours,
  clampRuleLimit,
  createTrackedCompanyResolver,
  defaultSharedXSourceConfig,
  nextSharedXRuntimeState,
  SHARED_X_POLL_WORKFLOW,
  SHARED_X_SOURCE_ADAPTER,
  sharedXMonthlyCostEstimateUsd,
  sharedXRuleState,
  type SharedXRule,
  type SharedXRuleState,
  type SharedXSourceConfig,
  type SharedTrackedCompanyMatch,
} from "./shared-x.ts";
import type { RawCandidate } from "./types.ts";

export interface SharedXPollWorkflowDeps {
  pool: Pool;
  bus: EventBus;
  embedder: EmbeddingClient;
  fetchImpl?: typeof fetch;
}

export interface SharedXPollInput {
  adapter_id?: string;
}

export interface SharedXPollSummary {
  adapter_id: string;
  source_id: string;
  executed_rules: number;
  skipped_budget_rules: number;
  inserted: number;
  duplicates: number;
  unresolved_company: number;
  matched_companies: number;
  fanned_out: number;
  errors: number;
  estimated_monthly_cost_usd: number;
}

interface PlatformSourceRow {
  id: string;
  config: Record<string, unknown>;
}

interface TrackedCompanyDbRow {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size_bucket: string | null;
  greenhouse_id: string | null;
  lever_id: string | null;
  ashby_id: string | null;
  workable_id: string | null;
  career_rss_url: string | null;
  sec_cik: string | null;
  properties: Record<string, unknown>;
  added_at: Date;
}

interface SharedCandidatePersistRow {
  id: string;
  inserted: boolean;
}

export function createSharedXPollWorkflow(
  deps: SharedXPollWorkflowDeps,
): WorkflowDefinition<SharedXPollInput, SharedXPollSummary> {
  return defineWorkflow<SharedXPollInput, SharedXPollSummary>({
    name: SHARED_X_POLL_WORKFLOW,
    version: "1",
    async run(input, ctx): Promise<SharedXPollSummary> {
      if (ctx.execution_scope !== "platform") {
        throw new Error("shared X poll requires a platform-scoped invocation");
      }

      const adapter_id = input.adapter_id ?? SHARED_X_SOURCE_ADAPTER;
      const source = await ctx.step("load_source", async () => {
        const loaded = await getPlatformSourceByAdapter(deps.pool, adapter_id);
        if (!loaded) {
          throw new Error(`platform_signal_sources missing row for adapter '${adapter_id}'`);
        }
        return loaded as PlatformSourceRow;
      });

      const config = parseSharedXSourceConfig(source.config);
      const companies = await ctx.step("load_tracked_companies", () => listTrackedCompanies(deps.pool));
      const resolver = createTrackedCompanyResolver(companies);
      const enabledRules = config.rules.filter((rule) => rule.enabled !== false);

      const summary: SharedXPollSummary = {
        adapter_id,
        source_id: source.id,
        executed_rules: 0,
        skipped_budget_rules: 0,
        inserted: 0,
        duplicates: 0,
        unresolved_company: 0,
        matched_companies: 0,
        fanned_out: 0,
        errors: 0,
        estimated_monthly_cost_usd: sharedXMonthlyCostEstimateUsd(config),
      };

      let runtimeState = config.runtime_state ?? { rules: {} };
      let remainingBudget = config.monthly_budget_usd;

      for (const rule of enabledRules) {
        const ruleState = sharedXRuleState(
          { ...config, runtime_state: runtimeState },
          rule.id,
        );
        if (!ruleIsDue(rule, ruleState, nowIsoString())) {
          continue;
        }

        const ruleBudget = sharedXMonthlyCostEstimateUsd({
          provider: config.provider,
          rules: [rule],
        });
        if (remainingBudget - ruleBudget < -0.001) {
          summary.skipped_budget_rules += 1;
          continue;
        }

        const outcome = await ctx.step(
          `poll_rule:${rule.id}`,
          async () => runSharedXRule({
            deps,
            source_id: source.id,
            provider: config.provider,
            rule,
            cursor: ruleState.cursor ?? {},
            resolver,
          }),
          {
            retry: { max_attempts: 2, backoff: "exponential", base_ms: 200 },
          },
        );

        runtimeState = nextSharedXRuntimeState(
          { ...config, runtime_state: runtimeState },
          rule.id,
          {
            cursor: outcome.cursor,
            last_polled_at: new Date().toISOString(),
            last_error: outcome.error ? { message: outcome.error } : null,
            last_result_count: outcome.result_count,
          },
        );
        await ctx.step(`save_rule_state:${rule.id}`, () =>
          updatePlatformSourceRuntimeState(deps.pool, source.id, runtimeState),
        );

        summary.executed_rules += 1;
        summary.inserted += outcome.inserted;
        summary.duplicates += outcome.duplicates;
        summary.unresolved_company += outcome.unresolved_company;
        summary.matched_companies += outcome.matched_companies;
        summary.fanned_out += outcome.fanned_out;
        if (outcome.error) summary.errors += 1;
        remainingBudget = Math.max(0, remainingBudget - ruleBudget);
      }

      return summary;
    },
  });
}

async function runSharedXRule(input: {
  deps: SharedXPollWorkflowDeps;
  source_id: string;
  provider: XSearchProvider;
  rule: SharedXRule;
  cursor: Record<string, unknown>;
  resolver: ReturnType<typeof createTrackedCompanyResolver>;
}): Promise<{
  cursor: Record<string, unknown>;
  inserted: number;
  duplicates: number;
  unresolved_company: number;
  matched_companies: number;
  fanned_out: number;
  result_count: number;
  error?: string;
}> {
  try {
    const result = await pollXSearchSource({
      provider: input.provider,
      query: input.rule.query,
      limit: clampRuleLimit(input.rule.limit),
      cursor: input.cursor,
      fetchImpl: input.deps.fetchImpl,
      sourceName: input.rule.name,
    });

    const outcome = {
      cursor: result.cursor,
      inserted: 0,
      duplicates: 0,
      unresolved_company: 0,
      matched_companies: 0,
      fanned_out: 0,
      result_count: result.items.length,
    };

    for (const item of result.items) {
      const leadText = `${item.title} ${(item.content ?? "").slice(0, 200)}`.trim();
      const [embedding] = await input.deps.embedder.embed([leadText]);
      const companyMatch = input.resolver.resolve(item);
      const candidate = withTrackedCompanyContext(item, companyMatch);
      const novelty_key = createHash("sha256")
        .update(`${SHARED_X_SOURCE_ADAPTER}|${candidate.external_id}`)
        .digest("hex");

      const dedup = await dedupCheck(input.deps.pool, {
        novelty_key,
        embedding,
        kind: input.rule.signal_kind,
      });
      let countedDuplicate = false;
      if (dedup.duplicate && dedup.matched_id) {
        await recordCollision(input.deps.pool, dedup.matched_id);
        outcome.duplicates += 1;
        countedDuplicate = true;
      }

      const persisted = await persistSharedXCandidate(input.deps.pool, {
        source_id: input.source_id,
        item: candidate,
        signal_kind: input.rule.signal_kind,
        company_id: companyMatch?.company_id ?? null,
        embedding,
        novelty_key,
      });
      if (persisted.inserted) outcome.inserted += 1;
      else if (!countedDuplicate) outcome.duplicates += 1;

      if (!companyMatch) {
        outcome.unresolved_company += 1;
        continue;
      }

      outcome.matched_companies += 1;
      const fanResults = await fanoutCandidate(
        { pool: input.deps.pool, bus: input.deps.bus },
        {
          id: persisted.id,
          source_id: input.source_id,
          kind: input.rule.signal_kind,
          company_id: companyMatch.company_id,
          title: candidate.title,
          content: candidate.content ?? null,
          url: candidate.url ?? null,
          structured: candidate.structured ?? {},
          novelty_count: 1,
          freshness_at: candidate.freshness_at,
          embedding,
        },
      );
      outcome.fanned_out += fanResults.filter((row) => row.outcome === "created").length;
    }

    return outcome;
  } catch (error) {
    return {
      cursor: input.cursor,
      inserted: 0,
      duplicates: 0,
      unresolved_company: 0,
      matched_companies: 0,
      fanned_out: 0,
      result_count: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function listTrackedCompanies(pool: Pool): Promise<TrackedCompany[]> {
  const { rows } = await pool.query<TrackedCompanyDbRow>(
    `select id, name, domain, industry, size_bucket,
            greenhouse_id, lever_id, ashby_id, workable_id, career_rss_url, sec_cik,
            properties, added_at
       from tracked_companies
      order by added_at desc`,
  );
  return rows.map((row) => ({
    ...row,
    added_at: row.added_at.toISOString(),
  }));
}

function parseSharedXSourceConfig(value: Record<string, unknown>): SharedXSourceConfig {
  const fallback = defaultSharedXSourceConfig();
  const configuredRules = Array.isArray(value.rules) ? value.rules : fallback.rules;
  return {
    provider: normalizeProvider(value.provider) ?? fallback.provider,
    monthly_budget_usd: positiveNumber(value.monthly_budget_usd) ?? fallback.monthly_budget_usd,
    rules: configuredRules.map(normalizeRule).filter(Boolean) as SharedXRule[],
    runtime_state: recordValue(value.runtime_state) as SharedXSourceConfig["runtime_state"] ?? fallback.runtime_state,
  };
}

function normalizeRule(value: unknown): SharedXRule | null {
  const record = recordValue(value);
  const id = cleanString(record?.id);
  const name = cleanString(record?.name);
  const query = cleanString(record?.query);
  const signal_kind = cleanString(record?.signal_kind);
  if (!id || !name || !query || !isSignalKind(signal_kind)) return null;
  return {
    id,
    name,
    query,
    signal_kind,
    enabled: record?.enabled === false ? false : true,
    limit: positiveNumber(record?.limit) ?? undefined,
    cadence_hours: positiveNumber(record?.cadence_hours) ?? undefined,
  };
}

function withTrackedCompanyContext(
  item: RawCandidate,
  match: SharedTrackedCompanyMatch | null,
): RawCandidate {
  if (!match) return item;
  const structured = recordValue(item.structured) ?? {};
  return {
    ...item,
    structured: {
      ...structured,
      company_name: match.company_name,
      company_domain: match.company_domain,
      link_reason: match.link_reason,
    },
  };
}

async function persistSharedXCandidate(
  pool: Pool,
  input: {
    source_id: string;
    item: RawCandidate;
    signal_kind: SharedXRule["signal_kind"];
    company_id: string | null;
    embedding: number[];
    novelty_key: string;
  },
): Promise<SharedCandidatePersistRow> {
  const { rows } = await pool.query<SharedCandidatePersistRow>(
    `insert into signal_candidates (
       source_id, external_id, external_thread_id,
       kind, company_id, title, content, url,
       structured, provenance, embedding,
       novelty_key, freshness_at, status, expired_at
     ) values (
       $1, $2, $3,
       $4, $5, $6, $7, $8,
       $9::jsonb, $10::jsonb, $11::vector,
       $12, $13, 'active', null
     )
     on conflict (source_id, external_id) do update set
       kind         = coalesce(signal_candidates.kind, excluded.kind),
       company_id   = coalesce(signal_candidates.company_id, excluded.company_id),
       title        = excluded.title,
       content      = excluded.content,
       url          = excluded.url,
       structured   = coalesce(signal_candidates.structured, '{}'::jsonb) || excluded.structured,
       provenance   = coalesce(signal_candidates.provenance, '{}'::jsonb) || excluded.provenance,
       embedding    = excluded.embedding,
       novelty_key  = excluded.novelty_key,
       freshness_at = excluded.freshness_at,
       status       = 'active',
       expired_at   = null
     returning id, (xmax = 0) as inserted`,
    [
      input.source_id,
      input.item.external_id,
      input.item.external_thread_id ?? null,
      input.signal_kind,
      input.company_id,
      input.item.title,
      input.item.content ?? null,
      input.item.url ?? null,
      JSON.stringify(input.item.structured ?? {}),
      JSON.stringify(input.item.provenance ?? {}),
      vectorToPgLiteral(input.embedding),
      input.novelty_key,
      normalizeFreshnessAt(input.item.freshness_at),
    ],
  );
  return rows[0]!;
}

function normalizeFreshnessAt(value: string): string {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? new Date().toISOString() : new Date(ms).toISOString();
}

function normalizeProvider(value: unknown): XSearchProvider | null {
  if (value === "twitterapi_io" || value === "socialdata" || value === "x_official") {
    return value;
  }
  return null;
}

function isSignalKind(value: string | null): value is SharedXRule["signal_kind"] {
  return value === "funding" ||
    value === "hiring" ||
    value === "leadership_change" ||
    value === "product_launch" ||
    value === "acquisition" ||
    value === "churn_risk" ||
    value === "competitor_move" ||
    value === "podcast_mention" ||
    value === "press_mention" ||
    value === "regulation" ||
    value === "expansion" ||
    value === "layoff" ||
    value === "other";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveNumber(value: unknown): number | null {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

function ruleIsDue(
  rule: SharedXRule,
  state: SharedXRuleState,
  nowIso: string,
): boolean {
  const lastPolledAt = cleanString(state.last_polled_at);
  if (!lastPolledAt) return true;
  const lastMs = Date.parse(lastPolledAt);
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(lastMs) || Number.isNaN(nowMs)) return true;
  const cadenceHours = clampCadenceHours(positiveNumber(rule.cadence_hours) ?? undefined);
  return nowMs - lastMs >= cadenceHours * 60 * 60 * 1000;
}

function nowIsoString(): string {
  return new Date().toISOString();
}

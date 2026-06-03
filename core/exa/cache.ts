import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type {
  ExaClient,
  ExaContentsInput,
  ExaContentsResponse,
  ExaResult,
  ExaSearchInput,
  ExaSearchResponse,
  ExaWebsetCreateInput,
  ExaWebsetResponse,
} from "./client.ts";

export interface ExaCachedSearchInput {
  pool: Pool;
  workspace_id: string;
  intent: string;
  client: Pick<ExaClient, "search">;
  search: ExaSearchInput;
  ttlMs?: number;
  play_id?: string | null;
}

export interface ExaCachedSearchResult {
  response: ExaSearchResponse;
  cache_hit: boolean;
  query_hash: string;
  usage_id: string | null;
}

export interface ExaBudgetedContentsInput {
  pool: Pool;
  workspace_id: string;
  intent: string;
  client: Pick<ExaClient, "getContents">;
  contents: ExaContentsInput;
  play_id?: string | null;
}

export interface ExaBudgetedContentsResult {
  response: ExaContentsResponse;
  content_hash: string;
  usage_id: string | null;
}

export interface ExaBudgetedWebsetCreateInput {
  pool: Pool;
  workspace_id: string;
  intent: string;
  client: Pick<ExaClient, "createWebset">;
  webset: ExaWebsetCreateInput;
  play_id?: string | null;
}

export interface ExaBudgetedWebsetCreateResult {
  response: ExaWebsetResponse;
  webset_hash: string;
  usage_id: string | null;
}

export interface ExaBudgetedWebsetListInput {
  pool: Pool;
  workspace_id: string;
  intent: string;
  client: Pick<ExaClient, "listWebsetItems">;
  webset_id: string;
  play_id?: string | null;
}

export interface ExaBudgetedWebsetListResult {
  response: Record<string, unknown>;
  webset_hash: string;
  usage_id: string | null;
}

export interface ExaBudgetSummary {
  configured: boolean;
  caps: {
    daily_query_cap: number;
    daily_contents_cap: number;
    monthly_unit_cap: number;
    per_play_research_cap: number;
  };
  used: {
    queries_24h: number;
    contents_24h: number;
    units_month: number;
    play_research_24h: number;
    deferred_24h: number;
  };
  remaining: {
    daily_queries: number;
    daily_contents: number;
    monthly_units: number;
    play_research: number;
  };
  cache: {
    active_query_entries: number;
    active_content_entries: number;
    cache_hits_24h: number;
  };
}

export class ExaBudgetExceededError extends Error {
  readonly workspace_id: string;
  readonly intent: string;
  readonly reason: string;
  readonly cap: number;
  readonly used: number;
  readonly requested: number;

  constructor(input: {
    workspace_id: string;
    intent: string;
    reason: string;
    cap: number;
    used: number;
    requested: number;
  }) {
    super(
      `Exa ${input.reason} exceeded for ${input.workspace_id}: ${input.used}/${input.cap} used, ${input.requested} requested`,
    );
    this.name = "ExaBudgetExceededError";
    this.workspace_id = input.workspace_id;
    this.intent = input.intent;
    this.reason = input.reason;
    this.cap = input.cap;
    this.used = input.used;
    this.requested = input.requested;
  }
}

const DEFAULT_QUERY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CONTENT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function exaQueryHash(input: {
  intent: string;
  search: ExaSearchInput;
}): string {
  const query = normalizeQuery(input.search.query);
  return createHash("sha256")
    .update(stableJson({
      intent: input.intent.trim().toLowerCase(),
      query,
      options: normalizedSearchOptions(input.search),
    }))
    .digest("hex");
}

export function exaContentsHash(input: {
  intent: string;
  contents: ExaContentsInput;
}): string {
  return createHash("sha256")
    .update(stableJson({
      intent: input.intent.trim().toLowerCase(),
      contents: normalizedContentsOptions(input.contents),
    }))
    .digest("hex");
}

export function exaWebsetHash(input: {
  intent: string;
  webset: ExaWebsetCreateInput | { webset_id: string };
}): string {
  return createHash("sha256")
    .update(stableJson({
      intent: input.intent.trim().toLowerCase(),
      webset: "webset_id" in input.webset
        ? { webset_id: input.webset.webset_id.trim() }
        : normalizedWebsetOptions(input.webset),
    }))
    .digest("hex");
}

export async function searchExaWithWorkspaceCache(
  input: ExaCachedSearchInput,
): Promise<ExaCachedSearchResult> {
  const query = normalizeQuery(input.search.query);
  if (!query) throw new Error("Exa cache search query is required");
  const search = { ...input.search, query };
  const queryHash = exaQueryHash({ intent: input.intent, search });
  const cached = await readQueryCache(input.pool, {
    workspace_id: input.workspace_id,
    intent: input.intent,
    query_hash: queryHash,
  });
  if (cached) {
    const usageId = await recordExaUsage(input.pool, {
      workspace_id: input.workspace_id,
      intent: input.intent,
      operation: "search_cache_hit",
      query_hash: queryHash,
      request_id: cached.requestId,
      result_count: cached.results.length,
      estimated_units: 0,
      properties: {
        query,
        cache_hit: true,
      },
    });
    return {
      response: cached,
      cache_hit: true,
      query_hash: queryHash,
      usage_id: usageId,
    };
  }

  await assertExaBudgetAvailable(input.pool, {
    workspace_id: input.workspace_id,
    intent: input.intent,
    requested_results: requestedResultCount(search),
    play_id: input.play_id ?? null,
    query_hash: queryHash,
    query,
  });
  const response = await input.client.search(search);
  await writeQueryCache(input.pool, {
    workspace_id: input.workspace_id,
    intent: input.intent,
    query_hash: queryHash,
    query,
    search_options: normalizedSearchOptions(search),
    response,
    ttlMs: input.ttlMs ?? DEFAULT_QUERY_CACHE_TTL_MS,
  });
  await writeContentCache(input.pool, {
    workspace_id: input.workspace_id,
    request_id: response.requestId,
    results: response.results,
  });
  const usageId = await recordExaUsage(input.pool, {
    workspace_id: input.workspace_id,
    intent: input.intent,
    operation: "search",
    query_hash: queryHash,
    request_id: response.requestId,
    result_count: response.results.length,
    estimated_units: 1,
    properties: {
      query,
      cache_hit: false,
      play_id: input.play_id ?? null,
    },
  });
  return {
    response,
    cache_hit: false,
    query_hash: queryHash,
    usage_id: usageId,
  };
}

export async function getExaContentsWithWorkspaceBudget(
  input: ExaBudgetedContentsInput,
): Promise<ExaBudgetedContentsResult> {
  const contentHash = exaContentsHash({
    intent: input.intent,
    contents: input.contents,
  });
  const requested = requestedContentCount(input.contents);
  if (requested === 0) throw new Error("Exa contents fetch requires ids or urls");

  await assertExaContentsBudgetAvailable(input.pool, {
    workspace_id: input.workspace_id,
    intent: input.intent,
    requested_results: requested,
    play_id: input.play_id ?? null,
    content_hash: contentHash,
    request: contentRequestLabel(input.contents),
  });

  const response = await input.client.getContents(input.contents);
  await writeContentCache(input.pool, {
    workspace_id: input.workspace_id,
    request_id: response.requestId,
    results: response.results,
  });
  const usageId = await recordExaUsage(input.pool, {
    workspace_id: input.workspace_id,
    intent: input.intent,
    operation: "contents",
    query_hash: contentHash,
    request_id: response.requestId,
    result_count: response.results.length,
    estimated_units: 1,
    properties: {
      ids_count: input.contents.ids?.length ?? 0,
      urls_count: input.contents.urls?.length ?? 0,
      play_id: input.play_id ?? null,
    },
  });
  return {
    response,
    content_hash: contentHash,
    usage_id: usageId,
  };
}

export async function createExaWebsetWithWorkspaceBudget(
  input: ExaBudgetedWebsetCreateInput,
): Promise<ExaBudgetedWebsetCreateResult> {
  const query = input.webset.search.query.replace(/\s+/g, " ").trim();
  if (!query) throw new Error("Exa Webset create requires search.query");
  const webset = {
    ...input.webset,
    search: {
      ...input.webset.search,
      query,
    },
  };
  const websetHash = exaWebsetHash({ intent: input.intent, webset });
  await assertExaWebsetCreateBudgetAvailable(input.pool, {
    workspace_id: input.workspace_id,
    intent: input.intent,
    play_id: input.play_id ?? null,
    webset_hash: websetHash,
    query,
  });
  const response = await input.client.createWebset(webset);
  const usageId = await recordExaUsage(input.pool, {
    workspace_id: input.workspace_id,
    intent: input.intent,
    operation: "webset_create",
    query_hash: websetHash,
    request_id: response.id,
    result_count: 1,
    estimated_units: 1,
    properties: {
      query,
      webset_id: response.id,
      status: response.status,
      count: webset.search.count ?? null,
      play_id: input.play_id ?? null,
    },
  });
  return { response, webset_hash: websetHash, usage_id: usageId };
}

export async function listExaWebsetItemsWithWorkspaceBudget(
  input: ExaBudgetedWebsetListInput,
): Promise<ExaBudgetedWebsetListResult> {
  const websetId = input.webset_id.trim();
  if (!websetId) throw new Error("Exa Webset list requires webset_id");
  const websetHash = exaWebsetHash({
    intent: input.intent,
    webset: { webset_id: websetId },
  });
  await assertExaWebsetListBudgetAvailable(input.pool, {
    workspace_id: input.workspace_id,
    intent: input.intent,
    play_id: input.play_id ?? null,
    webset_hash: websetHash,
    webset_id: websetId,
  });
  const response = await input.client.listWebsetItems(websetId);
  const itemCount = websetItemCount(response);
  const usageId = await recordExaUsage(input.pool, {
    workspace_id: input.workspace_id,
    intent: input.intent,
    operation: "webset_list",
    query_hash: websetHash,
    request_id: websetId,
    result_count: itemCount,
    estimated_units: 1,
    properties: {
      webset_id: websetId,
      item_count: itemCount,
      play_id: input.play_id ?? null,
    },
  });
  return { response, webset_hash: websetHash, usage_id: usageId };
}

export async function getWorkspaceExaCostSummary(
  pool: Pool,
  workspace_id: string,
  env: Record<string, string | undefined> = process.env,
  play_id?: string | null,
): Promise<ExaBudgetSummary> {
  const { rows } = await pool.query<{
    daily_query_cap: string | null;
    daily_contents_cap: string | null;
    monthly_unit_cap: string | null;
    per_play_research_cap: string | null;
    queries_24h: string;
    contents_24h: string;
    units_month: string;
    play_research_24h: string;
    deferred_24h: string;
    active_query_entries: string;
    active_content_entries: string;
    cache_hits_24h: string;
  }>(
    `select
        coalesce(settings #>> '{exa,daily_query_cap}', settings->>'exa_daily_query_cap') as daily_query_cap,
        coalesce(settings #>> '{exa,daily_contents_cap}', settings->>'exa_daily_contents_cap') as daily_contents_cap,
        coalesce(settings #>> '{exa,monthly_unit_cap}', settings->>'exa_monthly_unit_cap') as monthly_unit_cap,
        coalesce(settings #>> '{exa,per_play_research_cap}', settings->>'exa_per_play_research_cap') as per_play_research_cap,
        coalesce((
          select count(*)::text
            from workspace_exa_usage
           where workspace_id = workspaces.id
             and operation in ('search', 'webset_create')
             and created_at >= now() - interval '24 hours'
        ), '0') as queries_24h,
        coalesce((
          select sum(result_count)::text
            from workspace_exa_usage
           where workspace_id = workspaces.id
             and operation in ('search', 'contents', 'webset_list')
             and created_at >= now() - interval '24 hours'
        ), '0') as contents_24h,
        coalesce((
          select sum(estimated_units)::text
            from workspace_exa_usage
           where workspace_id = workspaces.id
             and operation in ('search', 'contents', 'webset_create', 'webset_list')
             and created_at >= date_trunc('month', now())
        ), '0') as units_month,
        coalesce((
          select count(*)::text
            from workspace_exa_usage
           where workspace_id = workspaces.id
             and operation in ('search', 'webset_create')
             and properties->>'play_id' = $2
             and created_at >= now() - interval '24 hours'
        ), '0') as play_research_24h,
        coalesce((
          select count(*)::text
            from workspace_exa_usage
           where workspace_id = workspaces.id
             and operation in ('search_deferred', 'contents_deferred', 'webset_create_deferred', 'webset_list_deferred')
             and created_at >= now() - interval '24 hours'
        ), '0') as deferred_24h,
        coalesce((
          select count(*)::text
            from workspace_exa_query_cache
           where workspace_id = workspaces.id
             and expires_at > now()
        ), '0') as active_query_entries,
        coalesce((
          select count(*)::text
            from workspace_exa_content_cache
           where workspace_id = workspaces.id
             and expires_at > now()
        ), '0') as active_content_entries,
        coalesce((
          select count(*)::text
            from workspace_exa_usage
           where workspace_id = workspaces.id
             and operation = 'search_cache_hit'
             and created_at >= now() - interval '24 hours'
        ), '0') as cache_hits_24h
       from workspaces
      where id = $1`,
    [workspace_id, play_id ?? ""],
  );
  const row = rows[0];
  if (!row) throw new Error(`Workspace ${workspace_id} not found for Exa budget summary`);
  const caps = {
    daily_query_cap: capValue(row?.daily_query_cap, env.BOMBSELL_EXA_DAILY_QUERY_CAP, 50),
    daily_contents_cap: capValue(row?.daily_contents_cap, env.BOMBSELL_EXA_DAILY_CONTENTS_CAP, 500),
    monthly_unit_cap: capValue(row?.monthly_unit_cap, env.BOMBSELL_EXA_MONTHLY_UNIT_CAP, 1000),
    per_play_research_cap: capValue(row?.per_play_research_cap, env.BOMBSELL_EXA_PLAY_RESEARCH_CAP, 25),
  };
  const used = {
    queries_24h: numberValue(row?.queries_24h),
    contents_24h: numberValue(row?.contents_24h),
    units_month: numberValue(row?.units_month),
    play_research_24h: numberValue(row?.play_research_24h),
    deferred_24h: numberValue(row?.deferred_24h),
  };
  return {
    configured: Boolean(env.EXA_API_KEY?.trim()),
    caps,
    used,
    remaining: {
      daily_queries: remaining(caps.daily_query_cap, used.queries_24h),
      daily_contents: remaining(caps.daily_contents_cap, used.contents_24h),
      monthly_units: remaining(caps.monthly_unit_cap, used.units_month),
      play_research: remaining(caps.per_play_research_cap, used.play_research_24h),
    },
    cache: {
      active_query_entries: numberValue(row?.active_query_entries),
      active_content_entries: numberValue(row?.active_content_entries),
      cache_hits_24h: numberValue(row?.cache_hits_24h),
    },
  };
}

export async function recordExaUsage(
  pool: Pool,
  input: {
    workspace_id: string;
    intent: string;
    operation: string;
    query_hash?: string | null;
    request_id?: string | null;
    result_count?: number;
    estimated_units?: number;
    event_id?: string | null;
    properties?: Record<string, unknown>;
  },
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into workspace_exa_usage (
       workspace_id, event_id, intent, operation, query_hash, request_id,
       result_count, estimated_units, properties
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb
     )
     returning id`,
    [
      input.workspace_id,
      input.event_id ?? null,
      input.intent,
      input.operation,
      input.query_hash ?? null,
      input.request_id ?? null,
      Math.max(0, Math.trunc(input.result_count ?? 0)),
      input.estimated_units ?? 0,
      JSON.stringify(input.properties ?? {}),
    ],
  );
  return rows[0]!.id;
}

function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim();
}

function normalizedSearchOptions(input: ExaSearchInput): Record<string, unknown> {
  return {
    type: input.type ?? "auto",
    category: input.category ?? null,
    numResults: input.numResults ?? null,
    includeDomains: cleanStringArray(input.includeDomains),
    excludeDomains: cleanStringArray(input.excludeDomains),
    startPublishedDate: input.startPublishedDate ?? null,
    startCrawlDate: input.startCrawlDate ?? null,
    endPublishedDate: input.endPublishedDate ?? null,
    endCrawlDate: input.endCrawlDate ?? null,
    includeText: input.includeText ?? false,
    textMaxCharacters: input.textMaxCharacters ?? null,
    highlights: input.highlights ?? false,
    summary: normalizeSummaryOption(input.summary),
  };
}

function normalizedContentsOptions(input: ExaContentsInput): Record<string, unknown> {
  return {
    ids: cleanStringArray(input.ids),
    urls: cleanStringArray(input.urls),
    includeText: input.includeText ?? false,
    textMaxCharacters: input.textMaxCharacters ?? null,
    highlights: input.highlights ?? false,
    summary: normalizeSummaryOption(input.summary),
  };
}

function normalizedWebsetOptions(input: ExaWebsetCreateInput): Record<string, unknown> {
  return {
    search: {
      query: input.search.query.replace(/\s+/g, " ").trim(),
      count: input.search.count ?? null,
    },
    enrichments: normalizeJsonValue(input.enrichments ?? []),
    metadata: normalizeJsonValue(input.metadata ?? {}),
  };
}

async function assertExaBudgetAvailable(
  pool: Pool,
  input: {
    workspace_id: string;
    intent: string;
    requested_results: number;
    play_id: string | null;
    query_hash: string;
    query: string;
  },
): Promise<void> {
  const summary = await getWorkspaceExaCostSummary(pool, input.workspace_id, process.env, input.play_id);
  const checks = [
    {
      reason: "daily_query_cap_exhausted",
      cap: summary.caps.daily_query_cap,
      used: summary.used.queries_24h,
      requested: 1,
    },
    {
      reason: "daily_contents_cap_exhausted",
      cap: summary.caps.daily_contents_cap,
      used: summary.used.contents_24h,
      requested: input.requested_results,
    },
    {
      reason: "monthly_unit_cap_exhausted",
      cap: summary.caps.monthly_unit_cap,
      used: summary.used.units_month,
      requested: 1,
    },
    {
      reason: "per_play_research_cap_exhausted",
      cap: input.play_id ? summary.caps.per_play_research_cap : Number.MAX_SAFE_INTEGER,
      used: input.play_id ? summary.used.play_research_24h : 0,
      requested: 1,
    },
  ];
  const failed = checks.find((check) => check.used + check.requested > check.cap);
  if (!failed) return;
  await recordExaUsage(pool, {
    workspace_id: input.workspace_id,
    intent: input.intent,
    operation: "search_deferred",
    query_hash: input.query_hash,
    result_count: 0,
    estimated_units: 0,
    properties: {
      query: input.query,
      reason: failed.reason,
      cap: failed.cap,
      used: failed.used,
      requested: failed.requested,
      play_id: input.play_id,
    },
  });
  throw new ExaBudgetExceededError({
    workspace_id: input.workspace_id,
    intent: input.intent,
    reason: failed.reason,
    cap: failed.cap,
    used: failed.used,
    requested: failed.requested,
  });
}

async function assertExaContentsBudgetAvailable(
  pool: Pool,
  input: {
    workspace_id: string;
    intent: string;
    requested_results: number;
    play_id: string | null;
    content_hash: string;
    request: string;
  },
): Promise<void> {
  const summary = await getWorkspaceExaCostSummary(pool, input.workspace_id, process.env, input.play_id);
  const checks = [
    {
      reason: "daily_contents_cap_exhausted",
      cap: summary.caps.daily_contents_cap,
      used: summary.used.contents_24h,
      requested: input.requested_results,
    },
    {
      reason: "monthly_unit_cap_exhausted",
      cap: summary.caps.monthly_unit_cap,
      used: summary.used.units_month,
      requested: 1,
    },
  ];
  const failed = checks.find((check) => check.used + check.requested > check.cap);
  if (!failed) return;
  await recordExaUsage(pool, {
    workspace_id: input.workspace_id,
    intent: input.intent,
    operation: "contents_deferred",
    query_hash: input.content_hash,
    result_count: 0,
    estimated_units: 0,
    properties: {
      request: input.request,
      reason: failed.reason,
      cap: failed.cap,
      used: failed.used,
      requested: failed.requested,
      play_id: input.play_id,
    },
  });
  throw new ExaBudgetExceededError({
    workspace_id: input.workspace_id,
    intent: input.intent,
    reason: failed.reason,
    cap: failed.cap,
    used: failed.used,
    requested: failed.requested,
  });
}

async function assertExaWebsetCreateBudgetAvailable(
  pool: Pool,
  input: {
    workspace_id: string;
    intent: string;
    play_id: string | null;
    webset_hash: string;
    query: string;
  },
): Promise<void> {
  const summary = await getWorkspaceExaCostSummary(pool, input.workspace_id, process.env, input.play_id);
  const checks = [
    {
      reason: "daily_query_cap_exhausted",
      cap: summary.caps.daily_query_cap,
      used: summary.used.queries_24h,
      requested: 1,
    },
    {
      reason: "monthly_unit_cap_exhausted",
      cap: summary.caps.monthly_unit_cap,
      used: summary.used.units_month,
      requested: 1,
    },
    {
      reason: "per_play_research_cap_exhausted",
      cap: input.play_id ? summary.caps.per_play_research_cap : Number.MAX_SAFE_INTEGER,
      used: input.play_id ? summary.used.play_research_24h : 0,
      requested: 1,
    },
  ];
  const failed = checks.find((check) => check.used + check.requested > check.cap);
  if (!failed) return;
  await recordExaUsage(pool, {
    workspace_id: input.workspace_id,
    intent: input.intent,
    operation: "webset_create_deferred",
    query_hash: input.webset_hash,
    result_count: 0,
    estimated_units: 0,
    properties: {
      query: input.query,
      reason: failed.reason,
      cap: failed.cap,
      used: failed.used,
      requested: failed.requested,
      play_id: input.play_id,
    },
  });
  throw new ExaBudgetExceededError({
    workspace_id: input.workspace_id,
    intent: input.intent,
    reason: failed.reason,
    cap: failed.cap,
    used: failed.used,
    requested: failed.requested,
  });
}

async function assertExaWebsetListBudgetAvailable(
  pool: Pool,
  input: {
    workspace_id: string;
    intent: string;
    play_id: string | null;
    webset_hash: string;
    webset_id: string;
  },
): Promise<void> {
  const summary = await getWorkspaceExaCostSummary(pool, input.workspace_id, process.env, input.play_id);
  const checks = [
    {
      reason: "daily_contents_cap_exhausted",
      cap: summary.caps.daily_contents_cap,
      used: summary.used.contents_24h,
      requested: 1,
    },
    {
      reason: "monthly_unit_cap_exhausted",
      cap: summary.caps.monthly_unit_cap,
      used: summary.used.units_month,
      requested: 1,
    },
  ];
  const failed = checks.find((check) => check.used + check.requested > check.cap);
  if (!failed) return;
  await recordExaUsage(pool, {
    workspace_id: input.workspace_id,
    intent: input.intent,
    operation: "webset_list_deferred",
    query_hash: input.webset_hash,
    request_id: input.webset_id,
    result_count: 0,
    estimated_units: 0,
    properties: {
      webset_id: input.webset_id,
      reason: failed.reason,
      cap: failed.cap,
      used: failed.used,
      requested: failed.requested,
      play_id: input.play_id,
    },
  });
  throw new ExaBudgetExceededError({
    workspace_id: input.workspace_id,
    intent: input.intent,
    reason: failed.reason,
    cap: failed.cap,
    used: failed.used,
    requested: failed.requested,
  });
}

function requestedResultCount(input: ExaSearchInput): number {
  const value = input.numResults ?? 10;
  return Math.max(1, Math.min(100, Math.trunc(value)));
}

function requestedContentCount(input: ExaContentsInput): number {
  const count = (input.ids?.length ?? 0) + (input.urls?.length ?? 0);
  return Math.max(0, Math.min(100, Math.trunc(count)));
}

function contentRequestLabel(input: ExaContentsInput): string {
  return stableJson({
    ids: cleanStringArray(input.ids),
    urls: cleanStringArray(input.urls),
  });
}

function capValue(configured: string | null | undefined, fallback: string | undefined, defaultValue: number): number {
  const raw = configured ?? fallback;
  const value = raw == null ? NaN : Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : defaultValue;
}

function numberValue(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function remaining(cap: number, used: number): number {
  return Math.max(0, cap - used);
}

function normalizeSummaryOption(summary: ExaSearchInput["summary"]): unknown {
  if (!summary || summary === true) return summary ?? false;
  return { query: summary.query ?? null };
}

function normalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, normalizeJsonValue(entry)]),
    );
  }
  return value;
}

function cleanStringArray(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean).sort();
}

async function readQueryCache(
  pool: Pool,
  input: {
    workspace_id: string;
    intent: string;
    query_hash: string;
  },
): Promise<ExaSearchResponse | null> {
  const { rows } = await pool.query<{
    request_id: string | null;
    response: ExaSearchResponse;
  }>(
    `select request_id, response
       from workspace_exa_query_cache
      where workspace_id = $1
        and intent = $2
        and query_hash = $3
        and expires_at > now()
      limit 1`,
    [input.workspace_id, input.intent, input.query_hash],
  );
  const row = rows[0];
  if (!row) return null;
  return normalizeSearchResponse(row.response, row.request_id);
}

async function writeQueryCache(
  pool: Pool,
  input: {
    workspace_id: string;
    intent: string;
    query_hash: string;
    query: string;
    search_options: Record<string, unknown>;
    response: ExaSearchResponse;
    ttlMs: number;
  },
): Promise<void> {
  await pool.query(
    `insert into workspace_exa_query_cache (
       workspace_id, intent, query_hash, query, search_options, request_id,
       result_count, response, expires_at
     ) values (
       $1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb,
       now() + ($9::text || ' milliseconds')::interval
     )
     on conflict (workspace_id, intent, query_hash) do update set
       query = excluded.query,
       search_options = excluded.search_options,
       request_id = excluded.request_id,
       result_count = excluded.result_count,
       response = excluded.response,
       expires_at = excluded.expires_at,
       updated_at = now()`,
    [
      input.workspace_id,
      input.intent,
      input.query_hash,
      input.query,
      JSON.stringify(input.search_options),
      input.response.requestId,
      input.response.results.length,
      JSON.stringify(input.response),
      Math.max(1, Math.trunc(input.ttlMs)),
    ],
  );
}

async function writeContentCache(
  pool: Pool,
  input: {
    workspace_id: string;
    request_id: string | null;
    results: readonly ExaResult[];
  },
): Promise<void> {
  for (const result of input.results) {
    const url = canonicalUrl(result.url);
    if (!url) continue;
    await pool.query(
      `insert into workspace_exa_content_cache (
         workspace_id, canonical_url, exa_result_id, title, summary,
         text_excerpt, highlights, request_id, raw, expires_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7::text[], $8, $9::jsonb,
         now() + ($10::text || ' milliseconds')::interval
       )
       on conflict (workspace_id, canonical_url) do update set
         exa_result_id = coalesce(excluded.exa_result_id, workspace_exa_content_cache.exa_result_id),
         title = coalesce(excluded.title, workspace_exa_content_cache.title),
         summary = coalesce(excluded.summary, workspace_exa_content_cache.summary),
         text_excerpt = coalesce(excluded.text_excerpt, workspace_exa_content_cache.text_excerpt),
         highlights = excluded.highlights,
         request_id = excluded.request_id,
         raw = excluded.raw,
         expires_at = excluded.expires_at,
         updated_at = now()`,
      [
        input.workspace_id,
        url,
        result.id,
        result.title,
        result.summary,
        result.text?.slice(0, 5000) ?? null,
        result.highlights,
        input.request_id,
        JSON.stringify(result.raw ?? {}),
        DEFAULT_CONTENT_CACHE_TTL_MS,
      ],
    );
  }
}

function normalizeSearchResponse(
  value: ExaSearchResponse,
  requestId: string | null,
): ExaSearchResponse {
  return {
    requestId: value.requestId ?? requestId ?? null,
    autopromptString: value.autopromptString ?? null,
    results: Array.isArray(value.results) ? value.results : [],
    raw: value.raw && typeof value.raw === "object" ? value.raw : {},
  };
}

function canonicalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    url.searchParams.sort();
    return url.toString();
  } catch {
    return value.trim() || null;
  }
}

function websetItemCount(response: Record<string, unknown>): number {
  for (const key of ["items", "results", "data"]) {
    const value = response[key];
    if (Array.isArray(value)) return value.length;
  }
  const total = response.total ?? response.totalCount ?? response.count;
  return Number.isFinite(Number(total)) ? Math.max(0, Math.trunc(Number(total))) : 0;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

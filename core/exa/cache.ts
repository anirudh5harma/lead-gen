import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type {
  ExaClient,
  ExaResult,
  ExaSearchInput,
  ExaSearchResponse,
} from "./client.ts";

export interface ExaCachedSearchInput {
  pool: Pool;
  workspace_id: string;
  intent: string;
  client: Pick<ExaClient, "search">;
  search: ExaSearchInput;
  ttlMs?: number;
}

export interface ExaCachedSearchResult {
  response: ExaSearchResponse;
  cache_hit: boolean;
  query_hash: string;
  usage_id: string | null;
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
    },
  });
  return {
    response,
    cache_hit: false,
    query_hash: queryHash,
    usage_id: usageId,
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

function normalizeSummaryOption(summary: ExaSearchInput["summary"]): unknown {
  if (!summary || summary === true) return summary ?? false;
  return { query: summary.query ?? null };
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

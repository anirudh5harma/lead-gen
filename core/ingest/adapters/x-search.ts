import type {
  WorkspaceAdapter,
  WorkspacePollInput,
  WorkspacePollResult,
} from "./_workspace-types.ts";
import type { RawCandidate } from "../types.ts";
import {
  buildSocialStructured,
  matchedKeywordsFromQuery,
} from "../social-signals.ts";
import { normalizeCompanyDomain } from "../company-domain.ts";

export type XSearchProvider = "x_official" | "socialdata" | "twitterapi_io";

interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  provider: XSearchProvider;
}

export class XSearchError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(status ? `X search: ${message} (status ${status})` : `X search: ${message}`);
    this.name = "XSearchError";
    this.status = status;
  }
}

export const xSearchAdapter: WorkspaceAdapter = {
  id: "x_search",
  kindHint: null,

  async poll(input: WorkspacePollInput): Promise<WorkspacePollResult> {
    return pollXSearchSource({
      query: stringValue(input.source.config.query),
      provider: xSearchProvider(input.source.config.provider),
      limit: boundedLimit(input.source.config.limit),
      cursor: input.cursor,
      fetchImpl: input.fetchImpl,
      sourceName: input.source.name,
    });
  },
};

export async function pollXSearchSource(input: {
  query: string | undefined;
  provider: XSearchProvider;
  limit: number;
  cursor: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  sourceName: string;
}): Promise<WorkspacePollResult> {
  if (!input.query) return { items: [], cursor: input.cursor };
  const request = buildProviderRequest({
    provider: input.provider,
    query: input.query,
    limit: input.limit,
    cursor: input.cursor,
  });
  const response = await (input.fetchImpl ?? globalThis.fetch)(request.url, {
    headers: request.headers,
  });
  if (!response.ok) {
    throw new XSearchError(`${request.provider} search failed`, response.status);
  }
  const json = await response.json();
  const items = normalizeProviderResponse(request.provider, json, {
    query: input.query,
    sourceName: input.sourceName,
  });
  return {
    items,
    cursor: {
      last_polled_at: new Date().toISOString(),
      provider: request.provider,
      query: input.query,
      count: items.length,
    },
  };
}

export function buildProviderRequest(input: {
  provider: XSearchProvider;
  query: string;
  limit: number;
  cursor: Record<string, unknown>;
}): ProviderRequest {
  switch (input.provider) {
    case "x_official": {
      const token = providerToken("X_API_BEARER_TOKEN", input.provider);
      const url = new URL("https://api.x.com/2/tweets/search/recent");
      url.searchParams.set("query", input.query);
      url.searchParams.set("max_results", String(Math.max(10, Math.min(input.limit, 100))));
      url.searchParams.set("tweet.fields", "created_at,author_id,conversation_id,public_metrics,lang");
      url.searchParams.set("expansions", "author_id");
      url.searchParams.set("user.fields", "username,name,verified");
      const since = lastPolledAt(input.cursor);
      if (since) url.searchParams.set("start_time", since);
      return {
        provider: input.provider,
        url: url.toString(),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      };
    }
    case "socialdata": {
      const token = providerToken("SOCIALDATA_API_KEY", input.provider);
      const url = new URL("https://api.socialdata.tools/twitter/search");
      url.searchParams.set("query", providerQuery(input.query, input.cursor));
      return {
        provider: input.provider,
        url: url.toString(),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      };
    }
    case "twitterapi_io": {
      const token = providerToken("TWITTERAPI_IO_API_KEY", input.provider);
      const url = new URL("https://api.twitterapi.io/twitter/tweet/advanced_search");
      url.searchParams.set("query", providerQuery(input.query, input.cursor));
      url.searchParams.set("queryType", "Latest");
      return {
        provider: input.provider,
        url: url.toString(),
        headers: {
          Accept: "application/json",
          "X-API-Key": token,
        },
      };
    }
  }
}

export function normalizeProviderResponse(
  provider: XSearchProvider,
  json: unknown,
  context: { query: string; sourceName: string },
): RawCandidate[] {
  if (provider === "x_official") return normalizeOfficialX(json, context);
  const tweets = arrayValue(recordValue(json)?.tweets) ?? arrayValue(recordValue(json)?.data) ?? [];
  return tweets.flatMap((tweet) => normalizeThirdPartyTweet(provider, tweet, context));
}

function normalizeOfficialX(
  json: unknown,
  context: { query: string; sourceName: string },
): RawCandidate[] {
  const root = recordValue(json);
  const data = arrayValue(root?.data) ?? [];
  const users = new Map<string, Record<string, unknown>>();
  for (const user of arrayValue(recordValue(root?.includes)?.users) ?? []) {
    const record = recordValue(user);
    const id = stringValue(record?.id);
    if (id && record) users.set(id, record);
  }
  return data.flatMap((tweet) => {
    const record = recordValue(tweet);
    if (!record) return [];
    const id = stringValue(record?.id);
    const text = stringValue(record?.text);
    if (!id || !text) return [];
    const author = users.get(stringValue(record?.author_id) ?? "");
    const username = stringValue(author?.username);
    const url = username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/web/status/${id}`;
    return [candidateFromTweet({
      provider: "x_official",
      id,
      text,
      url,
      createdAt: stringValue(record?.created_at),
      authorName: stringValue(author?.name),
      authorHandle: username,
      metrics: recordValue(record?.public_metrics),
      query: context.query,
      sourceName: context.sourceName,
      raw: record,
    })];
  });
}

function normalizeThirdPartyTweet(
  provider: XSearchProvider,
  tweet: unknown,
  context: { query: string; sourceName: string },
): RawCandidate[] {
  const record = recordValue(tweet);
  if (!record) return [];
  const id = stringValue(record?.id_str) ?? stringValue(record?.id) ?? stringValue(record?.tweet_id);
  const text =
    stringValue(record?.full_text) ??
    stringValue(record?.text) ??
    stringValue(record?.content);
  if (!id || !text) return [];
  const author = recordValue(record?.user) ?? recordValue(record?.author);
  const handle =
    stringValue(record?.username) ??
    stringValue(record?.screen_name) ??
    stringValue(author?.screen_name) ??
    stringValue(author?.username) ??
    stringValue(author?.userName);
  const url =
    stringValue(record?.url) ??
    (handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/web/status/${id}`);
  return [candidateFromTweet({
    provider,
    id,
    text,
    url,
    createdAt:
      stringValue(record?.created_at) ??
      stringValue(record?.createdAt) ??
      stringValue(record?.creation_date),
    authorName: stringValue(author?.name) ?? stringValue(record?.name),
    authorHandle: handle,
    authorProfileUrl:
      stringValue(author?.url) ??
      stringValue(author?.twitterUrl) ??
      (handle ? `https://x.com/${handle}` : undefined),
    companyDomain: firstExpandedDomain(record, author),
    metrics: recordValue(record?.public_metrics) ?? recordValue(record?.metrics),
    query: context.query,
    sourceName: context.sourceName,
    raw: record,
  })];
}

function candidateFromTweet(input: {
  provider: XSearchProvider;
  id: string;
  text: string;
  url: string;
  createdAt?: string;
  authorName?: string;
  authorHandle?: string;
  authorProfileUrl?: string;
  companyDomain?: string | null;
  metrics?: Record<string, unknown>;
  query: string;
  sourceName: string;
  raw: Record<string, unknown>;
}): RawCandidate {
  const author = input.authorHandle ? `@${input.authorHandle}` : input.authorName ?? "X";
  const matchedKeywords = matchedKeywordsFromQuery(input.query, input.text);
  return {
    external_id: input.id,
    external_thread_id: stringValue(input.raw.conversation_id),
    title: `${author}: ${input.text.replace(/\s+/g, " ").slice(0, 160)}`,
    content: input.text,
    url: input.url,
    freshness_at: parseTimestamp(input.createdAt) ?? new Date().toISOString(),
    structured: buildSocialStructured({
      platform: "x",
      query: input.query,
      source_name: input.sourceName,
      post_url: input.url,
      author_name: input.authorName ?? null,
      author_handle: input.authorHandle ?? null,
      author_profile_url:
        input.authorProfileUrl ??
        (input.authorHandle ? `https://x.com/${input.authorHandle}` : null),
      company_domain: input.companyDomain ?? null,
      matched_keywords: matchedKeywords,
      engagement: normalizeEngagement(input.metrics),
    }),
    provenance: {
      adapter: "x_search",
      provider: input.provider,
      query: input.query,
      source_name: input.sourceName,
      raw_id: input.id,
    },
  };
}

function xSearchProvider(value: unknown): XSearchProvider {
  const normalized = stringValue(value)?.toLowerCase();
  if (normalized === "x_official" || normalized === "official_x" || normalized === "x") {
    return "x_official";
  }
  if (normalized === "socialdata") return "socialdata";
  if (normalized === "twitterapi_io" || normalized === "twitterapi.io") {
    return "twitterapi_io";
  }
  return "x_official";
}

function providerToken(envKey: string, provider: XSearchProvider): string {
  const token = process.env[envKey]?.trim();
  if (!token) throw new XSearchError(`${provider} requires ${envKey}`);
  return token;
}

function boundedLimit(value: unknown): number {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(raw) || raw <= 0) return 10;
  return Math.max(1, Math.min(Math.trunc(raw), 100));
}

function providerQuery(query: string, cursor: Record<string, unknown>): string {
  const since = lastPolledAt(cursor);
  if (!since || /\bsince(?:_time)?:/i.test(query)) return query;
  return `${query} since_time:${Math.floor(Date.parse(since) / 1000)}`;
}

function lastPolledAt(cursor: Record<string, unknown>): string | null {
  const value = stringValue(cursor.last_polled_at);
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Date(Date.parse(value) - 60_000).toISOString();
}

function parseTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstExpandedDomain(
  record: Record<string, unknown>,
  author: Record<string, unknown> | undefined,
): string | null {
  const entityUrls = arrayValue(recordValue(record.entities)?.urls) ?? [];
  for (const entry of entityUrls) {
    const url = stringValue(recordValue(entry)?.expanded_url) ?? stringValue(recordValue(entry)?.url);
    const domain = normalizeCompanyDomain(url);
    if (domain) return domain;
  }
  const authorUrl = stringValue(author?.url);
  return normalizeCompanyDomain(authorUrl);
}

function normalizeEngagement(
  metrics: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!metrics) return null;
  const normalized: Record<string, unknown> = {};
  for (const key of [
    "like_count",
    "favorite_count",
    "retweet_count",
    "reply_count",
    "quote_count",
    "bookmark_count",
    "view_count",
    "impression_count",
  ]) {
    const value = metrics[key];
    const numeric =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(numeric) && numeric >= 0) normalized[key] = numeric;
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

import { parseStringPromise } from "xml2js";
import type {
  WorkspaceAdapter,
  WorkspacePollInput,
  WorkspacePollResult,
} from "./_workspace-types.ts";
import { stripHtml } from "./_hiring-heuristics.ts";
import type { RawCandidate } from "../types.ts";

/**
 * Generic RSS / Atom adapter. Workspace-driven — config.url points at the
 * feed (TechCrunch, The Verge, a company blog, a Google News RSS search,
 * a Substack newsletter). kindHint is null because the source is mixed;
 * stage 2 LLM classifies each item.
 *
 *   config: { url: string, novelty_domain?: string }
 *
 * Google News piggybacks on this adapter — see google-news.ts for the
 * config helper.
 */

export class RssError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(`RSS: ${message} (status ${status})`);
    this.name = "RssError";
    this.status = status;
  }
}

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const MAX_FETCH_TIMEOUT_MS = 30_000;

interface RssItem {
  guid?: string | { _: string; $?: Record<string, string> };
  id?: string;
  link?: string | string[];
  title?: string | { _: string };
  description?: string;
  summary?: string | { _: string };
  pubDate?: string;
  updated?: string;
  published?: string;
  content?: string | { _: string };
  "content:encoded"?: string;
  author?: string;
  "dc:creator"?: string;
}

interface Rss20Channel {
  channel?: {
    title?: string;
    link?: string;
    item?: RssItem | RssItem[];
  };
}

interface AtomFeed {
  feed?: {
    title?: string | { _: string };
    entry?: RssItem | RssItem[];
  };
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "_" in (value as { _: unknown })) {
    const inner = (value as { _: unknown })._;
    return typeof inner === "string" ? inner : undefined;
  }
  return undefined;
}

function pickLink(value: RssItem["link"]): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

function pickGuid(value: RssItem["guid"]): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "_" in value) {
    const inner = (value as { _: string })._;
    if (typeof inner === "string") return inner;
  }
  return undefined;
}

export async function parseFeed(xml: string): Promise<RawCandidate[]> {
  const parsed = (await parseStringPromise(xml, {
    explicitArray: false,
    normalizeTags: false,
    trim: true,
  })) as (Rss20Channel & AtomFeed) | undefined;
  const candidates: RawCandidate[] = [];

  // RSS 2.0
  if (parsed?.channel?.item) {
    const items = Array.isArray(parsed.channel.item)
      ? parsed.channel.item
      : [parsed.channel.item];
    for (const item of items) candidates.push(...itemToCandidate(item));
  }
  // Wrapped <rss><channel>...
  const rss = (parsed as { rss?: Rss20Channel } | undefined)?.rss;
  if (rss?.channel?.item) {
    const items = Array.isArray(rss.channel.item)
      ? rss.channel.item
      : [rss.channel.item];
    for (const item of items) candidates.push(...itemToCandidate(item));
  }
  // Atom
  if (parsed?.feed?.entry) {
    const entries = Array.isArray(parsed.feed.entry)
      ? parsed.feed.entry
      : [parsed.feed.entry];
    for (const entry of entries) candidates.push(...itemToCandidate(entry));
  }
  return candidates;
}

function itemToCandidate(item: RssItem): RawCandidate[] {
  const title = asString(item.title);
  const link = pickLink(item.link);
  const guid = pickGuid(item.guid) ?? item.id ?? link;
  if (!title || !guid) return [];

  const contentRaw =
    asString(item.content) ??
    item["content:encoded"] ??
    item.description ??
    asString(item.summary);
  const content = contentRaw ? stripHtml(contentRaw) : undefined;

  const freshness = safeIsoTimestamp(
    item.pubDate ?? item.updated ?? item.published,
  );

  return [
    {
      external_id: guid,
      title,
      content,
      url: link,
      structured: {
        author: item.author ?? item["dc:creator"] ?? null,
      },
      freshness_at: freshness,
      provenance: { adapter: "rss" },
    },
  ];
}

function safeIsoTimestamp(value: string | undefined): string {
  if (!value) return new Date().toISOString();
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? new Date().toISOString() : new Date(ms).toISOString();
}

export const rssAdapter: WorkspaceAdapter = {
  id: "rss",
  kindHint: null,

  async poll(input: WorkspacePollInput): Promise<WorkspacePollResult> {
    const url = (input.source.config as { url?: string }).url;
    if (!url) {
      return { items: [], cursor: input.cursor };
    }
    const fetchImpl = input.fetchImpl ?? globalThis.fetch;
    const timeoutMs = rssFetchTimeoutMs(input.source.config);
    const response = await fetchImpl(url, {
      headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new RssError(`failed to fetch ${url}`, response.status);
    }
    const xml = await response.text();
    let items = await parseFeed(xml);
    const noveltyDomain = (input.source.config as { novelty_domain?: string }).novelty_domain;
    if (noveltyDomain) {
      items = items.map((it) => ({ ...it, novelty_hint: { domain: noveltyDomain } }));
    }
    return {
      items,
      cursor: { last_polled_at: new Date().toISOString(), count: items.length },
    };
  },
};

export function rssFetchTimeoutMs(config: Record<string, unknown>): number {
  const raw = (config as { fetch_timeout_ms?: unknown }).fetch_timeout_ms;
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_FETCH_TIMEOUT_MS;
  return Math.min(Math.floor(value), MAX_FETCH_TIMEOUT_MS);
}

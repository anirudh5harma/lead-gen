import {
  createExaClientFromEnv,
  type ExaResult,
} from "../../exa/index.ts";
import {
  buildSocialStructured,
  matchedKeywordsFromQuery,
  socialCompanyHintFromEvidence,
  socialPlatformFromUrl,
} from "../social-signals.ts";
import type {
  WorkspaceAdapter,
  WorkspacePollInput,
  WorkspacePollResult,
} from "./_workspace-types.ts";
import type { RawCandidate } from "../types.ts";

export class ExaAdapterError extends Error {
  constructor(message: string) {
    super(`Exa adapter: ${message}`);
    this.name = "ExaAdapterError";
  }
}

export const exaAdapter: WorkspaceAdapter = {
  id: "exa",
  kindHint: null,

  async poll(input: WorkspacePollInput): Promise<WorkspacePollResult> {
    const query = stringValue(input.source.config.query);
    if (!query) return { items: [], cursor: input.cursor };
    const client = createExaClientFromEnv({
      fetchImpl: input.fetchImpl,
      timeoutMs: numberValue(input.source.config.timeout_ms) ?? undefined,
    });
    const since = sinceDate(input);
    const response = await client.search({
      query,
      type: searchType(input.source.config.type),
      category: stringValue(input.source.config.category),
      numResults: numberValue(input.source.config.limit) ?? 10,
      includeDomains: stringArray(input.source.config.include_domains),
      excludeDomains: stringArray(input.source.config.exclude_domains),
      startPublishedDate: stringValue(input.source.config.start_published_date),
      startCrawlDate: since,
      includeText: booleanValue(input.source.config.include_text, true),
      textMaxCharacters: numberValue(input.source.config.text_max_characters) ?? 1600,
      highlights: booleanValue(input.source.config.highlights, true),
      summary: booleanValue(input.source.config.summary, false),
    });
    const items = response.results.flatMap((result) =>
      candidateFromResult(result, {
        query,
        sourceName: input.source.name,
        sourceId: input.source.id,
        requestId: response.requestId,
        signalKind: stringValue(input.source.config.signal_kind),
      }),
    );
    return {
      items,
      cursor: {
        last_polled_at: new Date().toISOString(),
        query,
        request_id: response.requestId,
        count: items.length,
      },
    };
  },
};

function candidateFromResult(
  result: ExaResult,
  context: {
    query: string;
    sourceName: string;
    sourceId: string;
    requestId: string | null;
    signalKind?: string;
  },
): RawCandidate[] {
  if (!result.url) return [];
  const title = result.title || hostname(result.url) || result.url;
  const content =
    result.summary ??
    result.text ??
    (result.highlights.length ? result.highlights.join("\n\n") : undefined);
  const socialPlatform = socialPlatformFromUrl(result.url);
  const matchedKeywords = matchedKeywordsFromQuery(
    context.query,
    `${title}\n${content ?? ""}`,
  );
  const socialCompany = socialPlatform
    ? socialCompanyHintFromEvidence({
        title,
        content,
        highlights: result.highlights,
      })
    : null;
  return [{
    external_id: result.id ?? result.url,
    title,
    content,
    url: result.url,
    freshness_at: parseTimestamp(result.publishedDate) ?? new Date().toISOString(),
    structured: socialPlatform
      ? {
          ...buildSocialStructured({
            platform: socialPlatform,
            query: context.query,
            source_name: context.sourceName,
            post_url: result.url,
            author_name: result.author,
            company_name: socialCompany?.name,
            company_domain: socialCompany?.domain,
            matched_keywords: matchedKeywords,
          }),
          exa_author: result.author ?? null,
          exa_score: result.score ?? null,
          exa_summary: result.summary ?? null,
          exa_highlights: result.highlights,
        }
      : {
          source: "exa",
          query: context.query,
          title: result.title,
          author: result.author,
          score: result.score,
          summary: result.summary,
          highlights: result.highlights,
        },
    provenance: {
      adapter: "exa",
      provider: "exa",
      query: context.query,
      source_name: context.sourceName,
      source_id: context.sourceId,
      request_id: context.requestId,
      raw_id: result.id,
      url: result.url,
    },
    novelty_hint: { domain: hostname(result.url) ?? undefined },
  }];
}

function sinceDate(input: WorkspacePollInput): string | undefined {
  if (input.source.config.incremental === false) return undefined;
  const raw = stringValue(input.cursor.last_polled_at);
  if (!raw || Number.isNaN(Date.parse(raw))) return undefined;
  return new Date(Date.parse(raw) - 5 * 60_000).toISOString();
}

function searchType(value: unknown): "auto" | "neural" | "keyword" | "fast" {
  const normalized = stringValue(value)?.toLowerCase();
  if (
    normalized === "auto" ||
    normalized === "neural" ||
    normalized === "keyword" ||
    normalized === "fast"
  ) {
    return normalized;
  }
  return "auto";
}

function parseTimestamp(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function hostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value.flatMap((item) => {
    const text = stringValue(item);
    return text ? [text] : [];
  });
  return cleaned.length ? cleaned : undefined;
}

export const EXA_API_BASE_URL = "https://api.exa.ai";

export type ExaSearchType = "auto" | "neural" | "keyword" | "fast";

export interface ExaClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface ExaSearchInput {
  query: string;
  type?: ExaSearchType;
  category?: string;
  numResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  startCrawlDate?: string;
  endPublishedDate?: string;
  endCrawlDate?: string;
  includeText?: boolean;
  textMaxCharacters?: number;
  highlights?: boolean;
  summary?: boolean | { query?: string };
}

export interface ExaContentsInput {
  ids?: string[];
  urls?: string[];
  includeText?: boolean;
  textMaxCharacters?: number;
  highlights?: boolean;
  summary?: boolean | { query?: string };
}

export interface ExaWebsetCreateInput {
  search: {
    query: string;
    count?: number;
  };
  enrichments?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

export interface ExaResult {
  id: string | null;
  url: string;
  title: string | null;
  score: number | null;
  publishedDate: string | null;
  author: string | null;
  text: string | null;
  highlights: string[];
  summary: string | null;
  image: string | null;
  favicon: string | null;
  raw: Record<string, unknown>;
}

export interface ExaSearchResponse {
  requestId: string | null;
  autopromptString: string | null;
  results: ExaResult[];
  raw: Record<string, unknown>;
}

export interface ExaContentsResponse {
  requestId: string | null;
  results: ExaResult[];
  raw: Record<string, unknown>;
}

export interface ExaWebsetResponse {
  id: string | null;
  status: string | null;
  raw: Record<string, unknown>;
}

export class ExaError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(status ? `Exa: ${message} (status ${status})` : `Exa: ${message}`);
    this.name = "ExaError";
    this.status = status;
  }
}

export function exaApiKeyFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const key = env.EXA_API_KEY?.trim();
  return key || null;
}

export function createExaClientFromEnv(
  opts: Omit<ExaClientOptions, "apiKey"> & {
    env?: Record<string, string | undefined>;
  } = {},
): ExaClient {
  const apiKey = exaApiKeyFromEnv(opts.env);
  if (!apiKey) throw new ExaError("EXA_API_KEY is required");
  return new ExaClient({ ...opts, apiKey });
}

export class ExaClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: ExaClientOptions) {
    const apiKey = opts.apiKey.trim();
    if (!apiKey) throw new ExaError("apiKey is required");
    this.apiKey = apiKey;
    this.baseUrl = (opts.baseUrl ?? EXA_API_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = Math.max(1000, Math.trunc(opts.timeoutMs ?? 20_000));
  }

  async search(input: ExaSearchInput): Promise<ExaSearchResponse> {
    const query = cleanString(input.query);
    if (!query) throw new ExaError("search query is required");
    const body: Record<string, unknown> = {
      query,
      type: input.type ?? "auto",
      numResults: boundedNumber(input.numResults, 1, 100, 10),
      ...optionalString("category", input.category),
      ...optionalStringArray("includeDomains", input.includeDomains),
      ...optionalStringArray("excludeDomains", input.excludeDomains),
      ...optionalIso("startPublishedDate", input.startPublishedDate),
      ...optionalIso("startCrawlDate", input.startCrawlDate),
      ...optionalIso("endPublishedDate", input.endPublishedDate),
      ...optionalIso("endCrawlDate", input.endCrawlDate),
      ...contentsOptions(input),
    };
    const raw = await this.postJson("/search", body);
    return {
      requestId: stringValue(raw.requestId) ?? stringValue(raw.request_id) ?? null,
      autopromptString: stringValue(raw.autopromptString) ?? null,
      results: resultArray(raw.results).map(normalizeResult),
      raw,
    };
  }

  async getContents(input: ExaContentsInput): Promise<ExaContentsResponse> {
    const ids = cleanArray(input.ids);
    const urls = cleanArray(input.urls);
    if (ids.length === 0 && urls.length === 0) {
      throw new ExaError("getContents requires ids or urls");
    }
    const raw = await this.postJson("/contents", {
      ...(ids.length ? { ids } : {}),
      ...(urls.length ? { urls } : {}),
      ...contentsOptions(input),
    });
    return {
      requestId: stringValue(raw.requestId) ?? stringValue(raw.request_id) ?? null,
      results: resultArray(raw.results).map(normalizeResult),
      raw,
    };
  }

  async createWebset(input: ExaWebsetCreateInput): Promise<ExaWebsetResponse> {
    const query = cleanString(input.search?.query);
    if (!query) throw new ExaError("webset search.query is required");
    const raw = await this.postJson("/websets/v0/websets", {
      search: {
        query,
        ...(input.search.count ? { count: boundedNumber(input.search.count, 1, 1000, 25) } : {}),
      },
      ...(input.enrichments ? { enrichments: input.enrichments } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
    return {
      id: stringValue(raw.id) ?? null,
      status: stringValue(raw.status) ?? null,
      raw,
    };
  }

  async listWebsetItems(websetId: string): Promise<Record<string, unknown>> {
    const id = cleanString(websetId);
    if (!id) throw new ExaError("websetId is required");
    return this.getJson(`/websets/v0/websets/${encodeURIComponent(id)}/items`);
  }

  private async postJson(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    return parseJsonResponse(response);
  }

  private async getJson(path: string): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: {
        Accept: "application/json",
        "x-api-key": this.apiKey,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    return parseJsonResponse(response);
  }
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  let parsed: unknown = {};
  try {
    parsed = await response.json();
  } catch {
    parsed = {};
  }
  const record = recordValue(parsed) ?? {};
  if (!response.ok) {
    const message =
      stringValue(record.message) ??
      stringValue(record.error) ??
      stringValue(record.detail) ??
      "request failed";
    throw new ExaError(message, response.status);
  }
  return record;
}

function contentsOptions(input: {
  includeText?: boolean;
  textMaxCharacters?: number;
  highlights?: boolean;
  summary?: boolean | { query?: string };
}): Record<string, unknown> {
  const contents: Record<string, unknown> = {};
  if (input.includeText) {
    contents.text = {
      maxCharacters: boundedNumber(input.textMaxCharacters, 200, 20_000, 2000),
    };
  }
  if (input.highlights) contents.highlights = true;
  if (input.summary) {
    contents.summary =
      typeof input.summary === "object"
        ? { query: cleanString(input.summary.query) ?? undefined }
        : true;
  }
  return Object.keys(contents).length ? { contents } : {};
}

function normalizeResult(raw: unknown): ExaResult {
  const record = recordValue(raw) ?? {};
  const url = stringValue(record.url) ?? stringValue(record.sourceUrl) ?? "";
  return {
    id: stringValue(record.id) ?? null,
    url,
    title: stringValue(record.title) ?? null,
    score: numberValue(record.score),
    publishedDate:
      stringValue(record.publishedDate) ??
      stringValue(record.published_date) ??
      stringValue(record.publishedAt) ??
      null,
    author: stringValue(record.author) ?? null,
    text: stringValue(record.text) ?? null,
    highlights: resultHighlights(record.highlights),
    summary:
      stringValue(record.summary) ??
      stringValue(record.summaryText) ??
      null,
    image: stringValue(record.image) ?? null,
    favicon: stringValue(record.favicon) ?? null,
    raw: record,
  };
}

function resultHighlights(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text =
      typeof item === "string"
        ? item
        : stringValue(recordValue(item)?.text) ?? stringValue(recordValue(item)?.highlight);
    return text ? [text] : [];
  });
}

function resultArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function optionalString(key: string, value: unknown): Record<string, string> {
  const cleaned = cleanString(value);
  return cleaned ? { [key]: cleaned } : {};
}

function optionalStringArray(key: string, value: unknown): Record<string, string[]> {
  const cleaned = cleanArray(value);
  return cleaned.length ? { [key]: cleaned } : {};
}

function optionalIso(key: string, value: unknown): Record<string, string> {
  const cleaned = cleanString(value);
  if (!cleaned) return {};
  const ms = Date.parse(cleaned);
  return Number.isNaN(ms) ? {} : { [key]: new Date(ms).toISOString() };
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(Math.trunc(raw), max));
}

function cleanArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const cleaned = cleanString(item);
    return cleaned ? [cleaned] : [];
  });
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

import type { Pool } from "pg";
import type { ExaClient, ExaResult } from "../exa/index.ts";
import {
  createExaClientFromEnv,
  exaApiKeyFromEnv,
  searchExaWithWorkspaceCache,
} from "../exa/index.ts";
import { contactDiscoveryDomain } from "../ingest/company-domain.ts";
import { fetchPublicHttpUrl } from "../../lib/network/safe-public-fetch.ts";
import { ContactProviderDeferredError } from "./resolution.ts";
import type {
  ContactDiscoveryProvider,
  ContactResolutionDeps,
  ContactResolutionInput,
  ContactResolutionProviderPerson,
  EmailVerificationProvider,
} from "./resolution.ts";

export const HUNTER_API_BASE_URL = "https://api.hunter.io/v2";
export const ZEROBOUNCE_API_BASE_URL = "https://api.zerobounce.net/v2";

const DEFAULT_PROVIDER_TIMEOUT_MS = 20_000;
const MAX_PROVIDER_RETRIES = 2;

export interface ContactResolutionProviderFactoryOptions {
  pool: Pool;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  publicFetchImpl?: typeof fetchPublicHttpUrl;
}

export interface PublicWebsiteContactProviderOptions {
  pool: Pool;
  fetchPublicImpl?: typeof fetchPublicHttpUrl;
}

export interface ExaPeopleSearchProviderOptions {
  pool: Pool;
  client: Pick<ExaClient, "search">;
}

export interface HunterProviderOptions {
  pool: Pool;
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxEmailFinderCalls?: number;
  timeoutMs?: number;
}

export interface ZeroBounceVerifierOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutSeconds?: number;
}

export { contactDiscoveryDomain } from "../ingest/company-domain.ts";

export function createContactResolutionProviders(
  opts: ContactResolutionProviderFactoryOptions,
): Pick<ContactResolutionDeps, "discoveryProviders" | "emailVerifier"> {
  const env = opts.env ?? process.env;
  const discoveryProviders: ContactDiscoveryProvider[] = [
    createPublicWebsiteContactDiscoveryProvider({
      pool: opts.pool,
      fetchPublicImpl: opts.publicFetchImpl,
    }),
  ];
  if (exaApiKeyFromEnv(env)) {
    discoveryProviders.push(
      createExaPeopleSearchProvider({
        pool: opts.pool,
        client: createExaClientFromEnv({ env, fetchImpl: opts.fetchImpl }),
      }),
    );
  }
  const hunterApiKey = cleanString(env.HUNTER_API_KEY);
  if (hunterApiKey) {
    discoveryProviders.push(
      createHunterContactDiscoveryProvider({
        pool: opts.pool,
        apiKey: hunterApiKey,
        baseUrl: cleanString(env.HUNTER_API_BASE_URL) ?? undefined,
        fetchImpl: opts.fetchImpl,
      }),
    );
  }
  const zeroBounceApiKey = cleanString(env.ZEROBOUNCE_API_KEY);
  const emailVerifier = zeroBounceApiKey
    ? createZeroBounceEmailVerifier({
      apiKey: zeroBounceApiKey,
      baseUrl: cleanString(env.ZEROBOUNCE_API_BASE_URL) ?? undefined,
      fetchImpl: opts.fetchImpl,
    })
    : hunterApiKey
      ? createHunterEmailVerifier({
        apiKey: hunterApiKey,
        baseUrl: cleanString(env.HUNTER_API_BASE_URL) ?? undefined,
        fetchImpl: opts.fetchImpl,
      })
      : undefined;

  return { discoveryProviders, emailVerifier };
}

export function createPublicWebsiteContactDiscoveryProvider(
  opts: PublicWebsiteContactProviderOptions,
): ContactDiscoveryProvider {
  const safeFetch = opts.fetchPublicImpl ?? fetchPublicHttpUrl;
  return {
    name: "website.public_contacts",
    async discover(input) {
      const context = await loadContactResolutionContext(opts.pool, input);
      const domain = contactDiscoveryDomain(context.company?.domain);
      if (!domain) return [];
      const origin = `https://${domain}`;
      const people = new Map<string, ContactResolutionProviderPerson>();

      const homepage = await fetchPublicHtml(safeFetch, origin);
      if (!homepage) return [];
      const pages = [origin, ...companyPeoplePageLinks(homepage, origin).slice(0, 4)];
      const htmlByPage = await Promise.allSettled(
        pages.map((url, index) => index === 0 ? Promise.resolve(homepage) : fetchPublicHtml(safeFetch, url)),
      );
      for (let index = 0; index < pages.length; index += 1) {
        const result = htmlByPage[index];
        const html = result?.status === "fulfilled" ? result.value : null;
        if (!html) continue;
        const url = pages[index]!;
        for (const person of publicPeopleFromHtml(html, domain, url)) {
          const key = `${person.full_name.toLowerCase()}|${person.emails?.[0] ?? ""}`;
          people.set(key, person);
        }
      }
      return [...people.values()];
    },
  };
}

async function fetchPublicHtml(
  safeFetch: typeof fetchPublicHttpUrl,
  url: string,
): Promise<string | null> {
  try {
    const response = await safeFetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "BombsellContactBot/1.0 (+https://www.bombsell.com)",
      },
      maxResponseBytes: 1_000_000,
      signal: AbortSignal.timeout(8_000),
    });
    if (!response?.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  }
}

function publicPeopleFromHtml(
  html: string,
  companyDomain: string,
  evidenceUrl: string,
): ContactResolutionProviderPerson[] {
  const blocks = [...html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )];
  const people: ContactResolutionProviderPerson[] = [];
  for (const block of blocks) {
    const raw = decodeHtmlEntities(block[1] ?? "").trim();
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const candidate of personRecords(parsed)) {
      const fullName = cleanString(candidate.name);
      const email = normalizePublicCompanyEmail(candidate.email, companyDomain);
      const linkedin = linkedinFromSameAs(candidate.sameAs);
      if (!fullName || !email) continue;
      people.push({
        full_name: fullName,
        title: cleanString(candidate.jobTitle) ?? null,
        emails: [email],
        email_evidence: [{
          email,
          kind: "company_public_listing",
          source_url: evidenceUrl,
          company_domain: companyDomain,
        }],
        linkedin_url: linkedin,
        confidence: 0.95,
        source: "website_public_contact",
        evidence: { url: evidenceUrl, type: "company_json_ld_person" },
      });
    }
  }
  return people;
}

function personRecords(value: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const visit = (current: unknown) => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    const record = recordValue(current);
    if (!record) return;
    const types = Array.isArray(record["@type"])
      ? record["@type"]
      : [record["@type"]];
    if (types.some((type) => String(type).toLowerCase() === "person")) {
      found.push(record);
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return found;
}

function normalizePublicCompanyEmail(value: unknown, companyDomain: string): string | null {
  const raw = cleanString(value)?.replace(/^mailto:/i, "").split("?")[0]?.toLowerCase();
  if (!raw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return null;
  const emailDomain = contactDiscoveryDomain(raw.split("@")[1]);
  return emailDomain === companyDomain ? raw : null;
}

function linkedinFromSameAs(value: unknown): string | null {
  const values = Array.isArray(value) ? value : [value];
  for (const candidate of values) {
    const url = normalizeLinkedInUrl(cleanString(candidate));
    if (url && /linkedin\.com\/in\//i.test(url)) return url;
  }
  return null;
}

function companyPeoplePageLinks(html: string, origin: string): string[] {
  const base = new URL(origin);
  const links = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const url = new URL(decodeHtmlEntities(match[1] ?? ""), base);
      if (url.origin !== base.origin) continue;
      if (!/(?:^|\/)(?:about|team|leadership|company|contact)(?:\/|$)/i.test(url.pathname)) {
        continue;
      }
      links.add(url.toString());
    } catch {
      // Ignore malformed links from public pages.
    }
  }
  return [...links];
}

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

export function createExaPeopleSearchProvider(
  opts: ExaPeopleSearchProviderOptions,
): ContactDiscoveryProvider {
  return {
    name: "exa.people_search",
    async discover(input) {
      const context = await loadContactResolutionContext(opts.pool, input);
      if (!context.company) return [];
      const query = buildExaPeopleQuery(context);
      const result = await searchExaWithWorkspaceCache({
        pool: opts.pool,
        workspace_id: input.workspace_id,
        intent: "rep_research",
        client: opts.client,
        play_id: input.play_id,
        search: {
          query,
          category: "people",
          type: "auto",
          numResults: 10,
          includeDomains: ["linkedin.com"],
          includeText: false,
          summary: { query: "Extract the person's current role, company, and public profile evidence." },
        },
      });
      return result.response.results.flatMap((row) =>
        contactPersonFromExaResult(row, context.company!.name),
      );
    },
  };
}

export function createHunterContactDiscoveryProvider(
  opts: HunterProviderOptions,
): ContactDiscoveryProvider {
  const providerName = "hunter.contact_discovery";
  const apiKey = cleanString(opts.apiKey);
  const baseUrl = normalizeBaseUrl(opts.baseUrl ?? HUNTER_API_BASE_URL);
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const maxEmailFinderCalls = Math.max(0, Math.min(10, Math.trunc(opts.maxEmailFinderCalls ?? 5)));
  const timeoutMs = providerTimeoutMs(opts.timeoutMs);
  return {
    name: providerName,
    async discover(input) {
      if (!apiKey) {
        console.warn(`[${providerName}] deferred: missing HUNTER_API_KEY`);
        throw new ContactProviderDeferredError(providerName, "provider_unconfigured", "missing HUNTER_API_KEY");
      }
      const context = await loadContactResolutionContext(opts.pool, input);
      const domain = contactDiscoveryDomain(context.company?.domain);
      if (!domain) return [];
      const people: ContactResolutionProviderPerson[] = [];
      const domainSearch = await hunterGet(fetchImpl, providerName, baseUrl, "/domain-search", apiKey, {
        domain,
        limit: "10",
      }, timeoutMs);
      people.push(...contactPeopleFromHunterDomainSearch(domainSearch));

      const graphPeople = await loadHighValuePeopleMissingEmail(opts.pool, input, maxEmailFinderCalls);
      for (const person of graphPeople) {
        const parsedName = splitPersonName(person.full_name);
        if (!parsedName) continue;
        const found = await hunterGet(fetchImpl, providerName, baseUrl, "/email-finder", apiKey, {
          domain,
          first_name: parsedName.firstName,
          last_name: parsedName.lastName,
        }, timeoutMs);
        const enriched = contactPersonFromHunterEmailFinder(found, person);
        if (enriched) people.push(enriched);
      }
      return people;
    },
  };
}

export function createHunterEmailVerifier(
  opts: Omit<HunterProviderOptions, "pool" | "maxEmailFinderCalls">,
): EmailVerificationProvider {
  const providerName = "hunter.email_verifier";
  const apiKey = cleanString(opts.apiKey);
  const baseUrl = normalizeBaseUrl(opts.baseUrl ?? HUNTER_API_BASE_URL);
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = providerTimeoutMs(opts.timeoutMs);
  return {
    name: providerName,
    async verify(email) {
      if (!apiKey) {
        console.warn(`[${providerName}] deferred: missing HUNTER_API_KEY`);
        throw new ContactProviderDeferredError(providerName, "provider_unconfigured", "missing HUNTER_API_KEY");
      }
      const raw = await hunterGet(fetchImpl, providerName, baseUrl, "/email-verifier", apiKey, { email }, timeoutMs);
      const data = recordValue(raw.data) ?? raw;
      const status = cleanString(data.status) ?? "unknown";
      const score = numberValue(data.score);
      return {
        status: normalizeHunterEmailStatus(status, score),
        verified: status.toLowerCase() === "valid" && (score ?? 0) >= 80,
        confidence: score == null ? undefined : score / 100,
        raw,
      };
    },
  };
}

export function createZeroBounceEmailVerifier(
  opts: ZeroBounceVerifierOptions,
): EmailVerificationProvider {
  const providerName = "zerobounce.validate";
  const apiKey = cleanString(opts.apiKey);
  const baseUrl = normalizeBaseUrl(opts.baseUrl ?? ZEROBOUNCE_API_BASE_URL);
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeout = Math.max(3, Math.min(60, Math.trunc(opts.timeoutSeconds ?? 15)));
  const timeoutMs = timeout * 1000;
  return {
    name: providerName,
    async verify(email) {
      if (!apiKey) {
        console.warn(`[${providerName}] deferred: missing ZEROBOUNCE_API_KEY`);
        throw new ContactProviderDeferredError(providerName, "provider_unconfigured", "missing ZEROBOUNCE_API_KEY");
      }
      const raw = await getJson(fetchImpl, `${baseUrl}/validate`, {
        api_key: apiKey,
        email,
        timeout: String(timeout),
      }, timeoutMs, providerName);
      const status = cleanString(raw.status) ?? "unknown";
      return {
        status: status.toLowerCase(),
        verified: status.toLowerCase() === "valid",
        confidence: status.toLowerCase() === "valid" ? 1 : 0,
        raw,
      };
    },
  };
}

export function contactPersonFromExaResult(
  result: ExaResult,
  companyName: string,
): ContactResolutionProviderPerson[] {
  const entities = arrayValue(result.raw.entities);
  const personEntities = entities
    .map(recordValue)
    .filter((entity): entity is Record<string, unknown> =>
      cleanString(entity?.type)?.toLowerCase() === "person"
    );
  if (personEntities.length === 0) {
    const fallback = fallbackPersonFromProfileTitle(result, companyName);
    return fallback ? [fallback] : [];
  }
  return personEntities.flatMap((entity) => {
    const props = recordValue(entity.properties) ?? {};
    const name = cleanString(props.name) ??
      [cleanString(props.firstName), cleanString(props.lastName)].filter(Boolean).join(" ");
    if (!name) return [];
    const workHistory = arrayValue(props.workHistory).map(recordValue).filter(Boolean);
    const currentWork = workHistory.find((work) => {
      const company = recordValue(work?.company);
      const end = recordValue(work?.dates)?.to;
      return !end && sameCompanyName(cleanString(company?.name), companyName);
    }) ?? workHistory.find((work) => !recordValue(work?.dates)?.to);
    const title = cleanString(currentWork?.title) ?? titleFromProfileTitle(result.title, name);
    const currentCompany = cleanString(recordValue(currentWork?.company)?.name);
    if (currentCompany && !sameCompanyName(currentCompany, companyName)) return [];
    return [{
      full_name: name,
      title,
      linkedin_url: result.url.includes("linkedin.com/in/") ? result.url : null,
      confidence: scoreToConfidence(result.score),
      source: "exa",
      evidence: {
        result_id: result.id,
        url: result.url,
        title: result.title,
        entity_id: cleanString(entity.id) ?? null,
        summary: result.summary,
      },
    }];
  });
}

export function contactPeopleFromHunterDomainSearch(
  raw: Record<string, unknown>,
): ContactResolutionProviderPerson[] {
  const data = recordValue(raw.data) ?? raw;
  const emails = arrayValue(data.emails)
    .map(recordValue)
    .filter((row): row is Record<string, unknown> => row != null);
  return emails.flatMap((row) => {
    const email = cleanString(row.value) ?? cleanString(row.email);
    const fullName = cleanString(row.full_name) ??
      [cleanString(row.first_name), cleanString(row.last_name)].filter(Boolean).join(" ");
    if (!email || !fullName) return [];
    return [{
      full_name: fullName,
      title: cleanString(row.position) ?? cleanString(row.title) ?? null,
      emails: [email.toLowerCase()],
      linkedin_url: normalizeLinkedInUrl(cleanString(row.linkedin) ?? cleanString(row.linkedin_url)),
      confidence: scoreToConfidence(numberValue(row.confidence) ?? numberValue(row.score)),
      source: "hunter",
      evidence: {
        endpoint: "domain-search",
        department: cleanString(row.department) ?? null,
        seniority: cleanString(row.seniority) ?? null,
        sources: arrayValue(row.sources),
      },
    }];
  });
}

export function contactPersonFromHunterEmailFinder(
  raw: Record<string, unknown>,
  person: { full_name: string; title: string | null; linkedin_url: string | null },
): ContactResolutionProviderPerson | null {
  const data = recordValue(raw.data) ?? raw;
  const email = cleanString(data.email);
  if (!email) return null;
  return {
    full_name: cleanString(data.full_name) ?? person.full_name,
    title: cleanString(data.position) ?? cleanString(data.title) ?? person.title,
    emails: [email.toLowerCase()],
    linkedin_url: person.linkedin_url,
    confidence: scoreToConfidence(numberValue(data.score) ?? numberValue(data.confidence)),
    source: "hunter",
    evidence: {
      endpoint: "email-finder",
      verification: cleanString(data.verification) ?? null,
      sources: arrayValue(data.sources),
    },
  };
}

interface ContactResolutionContext {
  company: {
    name: string;
    domain: string | null;
    industry: string | null;
    description: string | null;
  } | null;
  signal: {
    kind: string;
    title: string;
    content: string | null;
    freshness_at: Date | string;
  } | null;
}

async function loadContactResolutionContext(
  pool: Pool,
  input: ContactResolutionInput,
): Promise<ContactResolutionContext> {
  const [company, signal] = await Promise.all([
    pool.query<{
      name: string;
      domain: string | null;
      industry: string | null;
      description: string | null;
    }>(
      `select name, domain::text as domain, industry, description
         from graph_companies
        where workspace_id = $1
          and id = $2`,
      [input.workspace_id, input.company_id],
    ),
    pool.query<{
      kind: string;
      title: string;
      content: string | null;
      freshness_at: Date;
    }>(
      `select kind::text as kind, title, content, freshness_at
         from signals
        where workspace_id = $1
          and id = $2`,
      [input.workspace_id, input.signal_id],
    ),
  ]);
  return {
    company: company.rows[0] ?? null,
    signal: signal.rows[0] ?? null,
  };
}

function buildExaPeopleQuery(context: ContactResolutionContext): string {
  const company = context.company!;
  const signal = context.signal;
  const timing = signal?.freshness_at
    ? `Signal timing: ${new Date(signal.freshness_at).toISOString().slice(0, 10)}.`
    : "";
  return [
    `Find senior decision makers at ${company.name}${company.domain ? ` (${company.domain})` : ""}.`,
    "Prioritize founders, CEOs, revenue, sales, growth, marketing, partnerships, business development, operations, and hiring leaders.",
    signal ? `Relevant signal: ${signal.kind} - ${signal.title}. ${signal.content ?? ""}` : "",
    timing,
    company.description ? `Company context: ${company.description}` : "",
  ].filter(Boolean).join(" ");
}

async function loadHighValuePeopleMissingEmail(
  pool: Pool,
  input: ContactResolutionInput,
  limit: number,
): Promise<Array<{ full_name: string; title: string | null; linkedin_url: string | null }>> {
  if (limit <= 0) return [];
  const { rows } = await pool.query<{
    full_name: string;
    title: string | null;
    linkedin_url: string | null;
  }>(
    `select full_name, title, linkedin_url
       from graph_persons
      where workspace_id = $1
        and company_id = $2
        and cardinality(emails) = 0
        and full_name <> ''
      order by
        case
          when title ~* '(founder|co-founder|ceo|chief executive|owner)' then 0
          when title ~* '(revenue|sales|growth|marketing|gtm|partnership|business development)' then 1
          else 2
        end,
        updated_at desc
      limit $3`,
    [input.workspace_id, input.company_id, limit],
  );
  return rows;
}

async function hunterGet(
  fetchImpl: typeof fetch,
  providerName: string,
  baseUrl: string,
  path: string,
  apiKey: string,
  params: Record<string, string>,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  return getJson(fetchImpl, `${baseUrl}${path}`, { ...params, api_key: apiKey }, timeoutMs, providerName);
}

async function getJson(
  fetchImpl: typeof fetch,
  url: string,
  params: Record<string, string>,
  timeoutMs: number,
  providerName?: string,
): Promise<Record<string, unknown>> {
  const request = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value.trim()) request.searchParams.set(key, value);
  }
  return fetchJsonWithRetry(fetchImpl, request, {
    headers: { Accept: "application/json" },
  }, timeoutMs, providerName);
}

async function fetchJsonWithRetry(
  fetchImpl: typeof fetch,
  request: URL,
  init: RequestInit,
  timeoutMs: number,
  providerName?: string,
): Promise<Record<string, unknown>> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= MAX_PROVIDER_RETRIES; attempt += 1) {
    let response: Response;
    let raw: Record<string, unknown>;
    try {
      response = await fetchImpl(request, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      raw = recordValue(await response.json().catch(() => ({}))) ?? {};
    } catch (error) {
      lastError = error;
      if (!shouldRetryError(error) || attempt === MAX_PROVIDER_RETRIES) {
        throw error;
      }
      await delay(backoffMs(attempt));
      continue;
    }

    if (response.ok) return raw;
    const error = providerHttpError(request, raw, response.status, providerName);
    if (
      error instanceof ContactProviderDeferredError ||
      !shouldRetryResponse(response.status) ||
      attempt === MAX_PROVIDER_RETRIES
    ) {
      throw error;
    }
    lastError = error;
    await delay(backoffMs(attempt));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "request failed"));
}

function providerHttpError(
  request: URL,
  raw: Record<string, unknown>,
  status: number,
  providerName?: string,
): Error {
  const error = arrayValue(raw.errors).map(recordValue).find(Boolean);
  const code = cleanString(recordValue(error)?.id) ??
    cleanString(recordValue(error)?.code);
  const message = cleanString(recordValue(error)?.details) ??
    code ??
    cleanString(raw.error) ??
    cleanString(raw.message) ??
    "request failed";
  if (providerName && status === 429 && isQuotaMessage(code, message)) {
    return new ContactProviderDeferredError(
      providerName,
      "quota_exceeded",
      message,
    );
  }
  if (providerName && (status === 401 || status === 403)) {
    return new ContactProviderDeferredError(
      providerName,
      "auth_failed",
      message,
    );
  }
  return new Error(`${request.hostname}: ${message} (${status})`);
}

function isQuotaMessage(
  code: string | null | undefined,
  message: string,
): boolean {
  return /quota|limit|billing period|plan|too_many_requests/i.test(
    [code, message].filter(Boolean).join(" "),
  );
}

function shouldRetryResponse(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function shouldRetryError(error: unknown): boolean {
  if (error instanceof ContactProviderDeferredError) return false;
  return true;
}

function backoffMs(attempt: number): number {
  return 100 * 2 ** attempt;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fallbackPersonFromProfileTitle(
  result: ExaResult,
  companyName: string,
): ContactResolutionProviderPerson | null {
  if (!result.url.includes("linkedin.com/in/") || !result.title) return null;
  const [rawName, ...rest] = result.title.split(" - ");
  const name = cleanString(rawName);
  if (!name) return null;
  const title = cleanString(rest.join(" - ")) ?? null;
  if (title && !result.title.toLowerCase().includes(companyName.toLowerCase().split(/\s+/)[0] ?? "")) {
    return null;
  }
  return {
    full_name: name,
    title,
    linkedin_url: result.url,
    confidence: scoreToConfidence(result.score),
    source: "exa",
    evidence: {
      result_id: result.id,
      url: result.url,
      title: result.title,
      summary: result.summary,
      fallback: true,
    },
  };
}

function titleFromProfileTitle(title: string | null, name: string): string | null {
  if (!title) return null;
  const cleaned = title.replace(name, "").replace(/^[-|:, ]+/, "").trim();
  return cleaned || null;
}

function splitPersonName(fullName: string): { firstName: string; lastName: string } | null {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { firstName: parts[0]!, lastName: parts[parts.length - 1]! };
}

function sameCompanyName(candidate: string | null | undefined, expected: string): boolean {
  if (!candidate) return false;
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(inc|llc|ltd|corp|corporation|company|co)\b/g, "").trim();
  return normalize(candidate) === normalize(expected);
}

function normalizeLinkedInUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("linkedin.com/")) return `https://www.${value}`;
  if (value.startsWith("www.linkedin.com/")) return `https://${value}`;
  return null;
}

function normalizeHunterEmailStatus(status: string, score: number | null): string {
  const lower = status.toLowerCase();
  if (lower === "valid" && (score ?? 0) >= 80) return "valid";
  if (lower === "valid") return "risky";
  return lower || "unknown";
}

function providerTimeoutMs(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_PROVIDER_TIMEOUT_MS;
  return Math.max(1_000, Math.min(60_000, Math.trunc(value)));
}

function scoreToConfidence(score: number | null | undefined): number | undefined {
  if (typeof score !== "number" || !Number.isFinite(score)) return undefined;
  return score > 1 ? Math.max(0, Math.min(1, score / 100)) : Math.max(0, Math.min(1, score));
}

function normalizeBaseUrl(value: string): string {
  const cleaned = requiredKey(value, "baseUrl");
  return cleaned.replace(/\/$/, "");
}

function requiredKey(value: string, label: string): string {
  const cleaned = cleanString(value);
  if (!cleaned) throw new Error(`${label} is required`);
  return cleaned;
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

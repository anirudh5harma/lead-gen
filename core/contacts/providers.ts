import type { Pool } from "pg";
import type { ExaClient, ExaResult } from "../exa/index.ts";
import {
  createExaClientFromEnv,
  exaApiKeyFromEnv,
  searchExaWithWorkspaceCache,
} from "../exa/index.ts";
import type {
  ContactDiscoveryProvider,
  ContactResolutionDeps,
  ContactResolutionInput,
  ContactResolutionProviderPerson,
  EmailVerificationProvider,
} from "./resolution.ts";

export const HUNTER_API_BASE_URL = "https://api.hunter.io/v2";
export const ZEROBOUNCE_API_BASE_URL = "https://api.zerobounce.net/v2";

export interface ContactResolutionProviderFactoryOptions {
  pool: Pool;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}

export interface ExaPeopleSearchProviderOptions {
  pool: Pool;
  client: Pick<ExaClient, "search">;
}

export interface HunterProviderOptions {
  pool: Pool;
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxEmailFinderCalls?: number;
}

export interface ZeroBounceVerifierOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutSeconds?: number;
}

export function createContactResolutionProviders(
  opts: ContactResolutionProviderFactoryOptions,
): Pick<ContactResolutionDeps, "discoveryProviders" | "emailVerifier"> {
  const env = opts.env ?? process.env;
  const discoveryProviders: ContactDiscoveryProvider[] = [];
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
  const apiKey = requiredKey(opts.apiKey, "Hunter apiKey");
  const baseUrl = normalizeBaseUrl(opts.baseUrl ?? HUNTER_API_BASE_URL);
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const maxEmailFinderCalls = Math.max(0, Math.min(10, Math.trunc(opts.maxEmailFinderCalls ?? 5)));
  return {
    name: "hunter.contact_discovery",
    async discover(input) {
      const context = await loadContactResolutionContext(opts.pool, input);
      const domain = context.company?.domain;
      if (!domain) return [];
      const people: ContactResolutionProviderPerson[] = [];
      const domainSearch = await hunterGet(fetchImpl, baseUrl, "/domain-search", apiKey, {
        domain,
        limit: "10",
      });
      people.push(...contactPeopleFromHunterDomainSearch(domainSearch));

      const graphPeople = await loadHighValuePeopleMissingEmail(opts.pool, input, maxEmailFinderCalls);
      for (const person of graphPeople) {
        const parsedName = splitPersonName(person.full_name);
        if (!parsedName) continue;
        const found = await hunterGet(fetchImpl, baseUrl, "/email-finder", apiKey, {
          domain,
          first_name: parsedName.firstName,
          last_name: parsedName.lastName,
        });
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
  const apiKey = requiredKey(opts.apiKey, "Hunter apiKey");
  const baseUrl = normalizeBaseUrl(opts.baseUrl ?? HUNTER_API_BASE_URL);
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  return {
    name: "hunter.email_verifier",
    async verify(email) {
      const raw = await hunterGet(fetchImpl, baseUrl, "/email-verifier", apiKey, { email });
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
  const apiKey = requiredKey(opts.apiKey, "ZeroBounce apiKey");
  const baseUrl = normalizeBaseUrl(opts.baseUrl ?? ZEROBOUNCE_API_BASE_URL);
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeout = Math.max(3, Math.min(60, Math.trunc(opts.timeoutSeconds ?? 15)));
  return {
    name: "zerobounce.validate",
    async verify(email) {
      const raw = await getJson(fetchImpl, `${baseUrl}/validate`, {
        api_key: apiKey,
        email,
        timeout: String(timeout),
      });
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
  baseUrl: string,
  path: string,
  apiKey: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  return getJson(fetchImpl, `${baseUrl}${path}`, { ...params, api_key: apiKey });
}

async function getJson(
  fetchImpl: typeof fetch,
  url: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const request = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value.trim()) request.searchParams.set(key, value);
  }
  const response = await fetchImpl(request, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const raw = recordValue(await response.json().catch(() => ({}))) ?? {};
  if (!response.ok) {
    const error = recordValue(raw.errors)?.[0];
    const message = cleanString(recordValue(error)?.details) ??
      cleanString(recordValue(error)?.code) ??
      cleanString(raw.error) ??
      cleanString(raw.message) ??
      "request failed";
    throw new Error(`${request.hostname}: ${message} (${response.status})`);
  }
  return raw;
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

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { upsertCompany } from "../graph/nodes/companies.ts";
import type { EventBus } from "../substrate/events/index.ts";
import type { SignalKind } from "../primitives/signal.ts";
import type { EmbeddingClient } from "./embeddings.ts";
import type { IcpRow } from "./icps.ts";
import type { RawCandidate } from "./types.ts";
import {
  ensureBudgetRow,
  recordOverflow,
  reserveCandidate,
} from "./budget.ts";
import { allMatchingIcps } from "./icp-filter.ts";
import { listIcps } from "./icps.ts";
import { deriveSignalQualityMetadata } from "./source-quality.ts";

export interface WorkspaceSignalSourceRow {
  id: string;
  workspace_id: string;
  kind: string;
  name: string;
  config: Record<string, unknown>;
  properties: Record<string, unknown>;
}

export interface WorkspaceSignalDiscoveryDeps {
  pool: Pool;
  bus: EventBus;
  embedder: EmbeddingClient;
}

export interface WorkspaceSignalDiscoveryContext {
  workspace_id: string;
  source: WorkspaceSignalSourceRow;
  adapter_id: string;
  kind_hint: SignalKind | null;
  icps: IcpRow[];
}

export interface WorkspaceSignalDiscoveryItem extends RawCandidate {
  related_company_id?: string | null;
  related_person_id?: string | null;
  properties?: Record<string, unknown>;
  producer_ref?: string;
  idempotency_key?: string;
}

export interface SignalCompanyHint {
  name: string;
  domain: string | null;
  description: string | null;
  source: string;
  confidence: "explicit" | "derived";
}

export interface MatchedSignalCompanyLinkRepairOptions {
  workspace_id?: string | null;
  limit?: number;
}

export type WorkspaceSignalDiscoveryResult =
  | {
      outcome: "created";
      signal_id: string;
      event_id: string;
    }
  | {
      outcome: "skipped:dedup";
      signal_id?: string;
    }
  | { outcome: "skipped:must_haves" }
  | { outcome: "skipped:budget" };

export async function loadWorkspaceSignalSource(
  pool: Pool,
  workspace_id: string,
  source_id: string,
): Promise<WorkspaceSignalSourceRow | null> {
  const { rows } = await pool.query<WorkspaceSignalSourceRow>(
    `select id, workspace_id, kind::text as kind, name, config,
            coalesce(properties, '{}'::jsonb) as properties
       from graph_sources
      where workspace_id = $1 and id = $2 and enabled`,
    [workspace_id, source_id],
  );
  return rows[0] ?? null;
}

export async function createWorkspaceSignalDiscoveryContext(
  deps: WorkspaceSignalDiscoveryDeps,
  input: {
    workspace_id: string;
    source_id: string;
    adapter_id?: string | null;
    kind_hint?: SignalKind | null;
  },
): Promise<WorkspaceSignalDiscoveryContext | null> {
  const source = await loadWorkspaceSignalSource(
    deps.pool,
    input.workspace_id,
    input.source_id,
  );
  if (!source) return null;
  return prepareWorkspaceSignalDiscoveryContext(deps, {
    workspace_id: input.workspace_id,
    source,
    adapter_id: input.adapter_id,
    kind_hint: input.kind_hint,
  });
}

export async function prepareWorkspaceSignalDiscoveryContext(
  deps: WorkspaceSignalDiscoveryDeps,
  input: {
    workspace_id: string;
    source: WorkspaceSignalSourceRow;
    adapter_id?: string | null;
    kind_hint?: SignalKind | null;
  },
): Promise<WorkspaceSignalDiscoveryContext> {
  await ensureBudgetRow(deps.pool, input.workspace_id);
  const icps = await listIcps(deps.pool, input.workspace_id, { only_enabled: true });
  return {
    workspace_id: input.workspace_id,
    source: input.source,
    adapter_id:
      input.adapter_id ??
      (typeof input.source.config.adapter === "string" &&
      input.source.config.adapter.trim()
        ? input.source.config.adapter.trim()
        : input.source.kind),
    kind_hint: input.kind_hint ?? parseConfiguredSignalKind(input.source.config),
    icps,
  };
}

export async function discoverWorkspaceSignal(
  deps: WorkspaceSignalDiscoveryDeps,
  ctx: WorkspaceSignalDiscoveryContext,
  item: WorkspaceSignalDiscoveryItem,
): Promise<WorkspaceSignalDiscoveryResult> {
  const existing = await existingSignalId(
    deps.pool,
    ctx.workspace_id,
    ctx.source.id,
    item.external_id,
  );
  if (existing) {
    return { outcome: "skipped:dedup", signal_id: existing };
  }

  const itemKind = item.kind ?? ctx.kind_hint;
  const filterCtx = {
    candidate: {
      kind: itemKind,
      title: item.title,
      url: item.url,
      structured: item.structured ?? {},
      freshness_at: item.freshness_at,
    },
  };
  if (ctx.icps.length > 0 && allMatchingIcps(ctx.icps, filterCtx).length === 0) {
    return { outcome: "skipped:must_haves" };
  }

  const sourceLimit = await sourceDailyItemLimitState(deps.pool, ctx);
  if (sourceLimit && sourceLimit.used >= sourceLimit.cap) {
    await recordOverflow(
      deps.pool,
      ctx.workspace_id,
      ctx.source.id,
      "source_daily_item_cap_reached",
      {
        external_id: item.external_id,
        title: item.title,
        provider: ctx.source.config.provider ?? null,
        cap: sourceLimit.cap,
        used: sourceLimit.used,
      },
    );
    return { outcome: "skipped:budget" };
  }

  const reserved = await reserveCandidate(deps.pool, ctx.workspace_id);
  if (!reserved) {
    await recordOverflow(
      deps.pool,
      ctx.workspace_id,
      ctx.source.id,
      "daily_cap_reached",
      { external_id: item.external_id, title: item.title },
    );
    return { outcome: "skipped:budget" };
  }

  const leadText = `${item.title} ${(item.content ?? "").slice(0, 200)}`.trim();
  const [embedding] = await deps.embedder.embed([leadText]);
  const relatedCompany =
    item.related_company_id === undefined
      ? await upsertSignalCompanyHint(deps, ctx, item)
      : null;
  const relatedCompanyHint = relatedCompany?.hint ?? null;
  const quality = deriveSignalQualityMetadata({
    adapter_id: ctx.adapter_id,
    source_name: ctx.source.name,
    source_config: ctx.source.config,
    source_properties: ctx.source.properties,
    item,
    kind: itemKind,
  });
  const signal_id = randomUUID();
  const event = await deps.bus.publish({
    workspace_id: ctx.workspace_id,
    event_type: "signal.discovered",
    source: "system",
    producer_ref: item.producer_ref ?? `ingest:workspace:${ctx.adapter_id}`,
    idempotency_key:
      item.idempotency_key ?? `workspace-source:${ctx.source.id}:external:${item.external_id}`,
    payload: {
      signal_id,
      source_id: ctx.source.id,
      kind: itemKind ?? null,
      title: item.title,
      content: item.content ?? null,
      url: item.url ?? null,
      freshness_at: item.freshness_at,
      related_company_id:
        item.related_company_id === undefined
          ? relatedCompany?.company_id ?? null
          : item.related_company_id,
      related_person_id: item.related_person_id ?? null,
      origin_candidate_id: null,
      properties: {
        ...(item.properties ?? {}),
        ...quality.properties,
        structured: item.structured ?? item.properties?.structured ?? {},
        ...(relatedCompanyHint
          ? {
              related_company_hint: {
                name: relatedCompanyHint.name,
                domain: relatedCompanyHint.domain,
                source: relatedCompanyHint.source,
                confidence: relatedCompanyHint.confidence,
              },
            }
          : {}),
      },
      provenance: {
        adapter: ctx.adapter_id,
        ...quality.provenance,
        ...(typeof ctx.source.config.provider === "string" &&
        ctx.source.config.provider.trim()
          ? { provider: ctx.source.config.provider.trim() }
          : {}),
        external_id: item.external_id,
        ...(item.provenance ?? {}),
      },
      embedding,
    },
  });
  const publishedSignalId =
    typeof event.payload.signal_id === "string" ? event.payload.signal_id : signal_id;
  return { outcome: "created", signal_id: publishedSignalId, event_id: event.id };
}

async function upsertSignalCompanyHint(
  deps: WorkspaceSignalDiscoveryDeps,
  ctx: WorkspaceSignalDiscoveryContext,
  item: WorkspaceSignalDiscoveryItem,
): Promise<{ company_id: string; hint: SignalCompanyHint } | null> {
  const hint = deriveSignalCompanyHint({
    adapter_id: ctx.adapter_id,
    source_name: ctx.source.name,
    source_config: ctx.source.config,
    item,
  });
  if (!hint) return null;
  const company = await upsertCompany(deps.pool, ctx.workspace_id, {
    name: hint.name,
    domain: hint.domain ?? undefined,
    description: hint.description ?? undefined,
    properties: {
      signal_discovery: {
        adapter: ctx.adapter_id,
        source_id: ctx.source.id,
        external_id: item.external_id,
        hint_source: hint.source,
        confidence: hint.confidence,
      },
    },
    provenance: {
      source: "workspace_signal_discovery",
      adapter: ctx.adapter_id,
      source_id: ctx.source.id,
      external_id: item.external_id,
      hint_source: hint.source,
      confidence: hint.confidence,
    },
  });
  return { company_id: company.id, hint };
}

export function deriveSignalCompanyHint(input: {
  adapter_id: string;
  source_name: string;
  source_config: Record<string, unknown>;
  item: Pick<
    WorkspaceSignalDiscoveryItem,
    "title" | "content" | "url" | "structured" | "novelty_hint"
  >;
}): SignalCompanyHint | null {
  const configHint = hintFromExplicitFields(
    input.source_config,
    "source_config",
    "explicit",
  );
  if (configHint) return configHint;

  const structured = recordValue(input.item.structured);
  const structuredHint = hintFromStructured(structured);
  if (structuredHint) return structuredHint;

  const adapter = input.adapter_id.trim().toLowerCase();
  if (adapter === "product_hunt") {
    return makeSignalCompanyHint({
      name: stringValue(structured?.name),
      domain: firstDomain(
        structured?.website,
        structured?.company_website,
        structured?.domain,
      ),
      description:
        stringValue(structured?.description) ??
        stringValue(structured?.tagline) ??
        stringValue(input.item.content),
      source: "product_hunt",
      confidence: "derived",
    });
  }

  if (adapter === "rss") {
    const domain = firstDomain(
      input.source_config.company_domain,
      input.source_config.target_company_domain,
      input.source_config.novelty_domain,
      input.source_config.domain,
      input.source_config.website,
    );
    if (domain) {
      return makeSignalCompanyHint({
        name: stringValue(input.source_config.company_name) ?? input.source_name,
        domain,
        description: stringValue(input.source_config.description),
        source: "rss_source_config",
        confidence: "derived",
      });
    }
  }

  if (
    adapter === "hn_whos_hiring" ||
    adapter === "hacker_news_hiring" ||
    adapter === "hn_hiring"
  ) {
    const domain = firstDomainInText(input.item.title, input.item.content);
    return makeSignalCompanyHint({
      name: hiringCompanyNameFromText(input.item.title, input.item.content, domain),
      domain,
      description: stringValue(input.item.content),
      source: "hn_whos_hiring",
      confidence: "derived",
    });
  }

  if (adapter === "hn_front" || adapter === "hacker_news" || adapter === "reddit") {
    const domain = firstDomain(
      structured?.company_domain,
      structured?.linked_domain,
      structured?.domain,
      input.item.novelty_hint?.domain,
      domainFromUrl(input.item.url),
    );
    if (domain) {
      return makeSignalCompanyHint({
        name: nameFromDomain(domain),
        domain,
        description: null,
        source: "linked_domain",
        confidence: "derived",
      });
    }
  }

  return null;
}

export async function repairMatchedSignalCompanyLinksOnce(
  deps: Pick<WorkspaceSignalDiscoveryDeps, "pool" | "bus">,
  opts: MatchedSignalCompanyLinkRepairOptions = {},
): Promise<number> {
  const limit = Math.max(1, Math.trunc(opts.limit ?? 25));
  const { rows } = await deps.pool.query<{
    signal_id: string;
    workspace_id: string;
    source_id: string | null;
    title: string;
    content: string | null;
    url: string | null;
    properties: Record<string, unknown> | null;
    provenance: Record<string, unknown> | null;
    audience_hint: Record<string, unknown> | null;
    source_kind: string | null;
    source_name: string | null;
    source_config: Record<string, unknown> | null;
  }>(
    `select s.id::text as signal_id,
            s.workspace_id::text as workspace_id,
            s.source_id::text as source_id,
            s.title,
            s.content,
            s.url,
            s.properties,
            s.provenance,
            s.audience_hint,
            gs.kind::text as source_kind,
            gs.name as source_name,
            gs.config as source_config
       from signals s
       left join graph_sources gs
         on gs.workspace_id = s.workspace_id
        and gs.id = s.source_id
      where s.status in ('matched', 'in_play')
        and s.related_company_id is null
        and ($2::uuid is null or s.workspace_id = $2)
        and not exists (
          select 1
            from events e
           where e.workspace_id = s.workspace_id
             and e.event_type = 'signal.company.linked'
             and e.payload->>'signal_id' = s.id::text
        )
      order by s.freshness_at desc nulls last, s.ingested_at desc
      limit $1`,
    [limit, opts.workspace_id ?? null],
  );

  let published = 0;
  for (const row of rows) {
    const sourceConfig = row.source_config ?? {};
    const properties = row.properties ?? {};
    const provenance = row.provenance ?? {};
    const adapter = signalRepairAdapterId(row.source_kind, sourceConfig, provenance);
    const hint = deriveSignalCompanyHint({
      adapter_id: adapter,
      source_name: row.source_name ?? adapter,
      source_config: sourceConfig,
      item: {
        title: row.title,
        content: row.content ?? undefined,
        url: row.url ?? undefined,
        structured: signalRepairStructured(properties, provenance),
        novelty_hint: signalRepairNoveltyHint(properties, row.audience_hint),
      },
    });
    if (!hint) continue;

    await deps.bus.publish({
      workspace_id: row.workspace_id,
      event_type: "signal.company.linked",
      source: "system",
      producer_ref: "repair:signal-company-link",
      idempotency_key:
        `repair:signal-company-link:${row.signal_id}:${hint.domain ?? hint.name.toLowerCase()}`,
      payload: {
        signal_id: row.signal_id,
        source_id: row.source_id,
        adapter,
        company: {
          name: hint.name,
          domain: hint.domain,
          description: hint.description,
        },
        hint_source: hint.source,
        confidence: hint.confidence,
      },
    });
    published++;
  }
  return published;
}

export async function discoverWorkspaceSignalOnce(
  deps: WorkspaceSignalDiscoveryDeps,
  input: WorkspaceSignalDiscoveryItem & {
    workspace_id: string;
    source_id: string;
  },
): Promise<WorkspaceSignalDiscoveryResult | { outcome: "skipped:source_not_found" }> {
  const ctx = await createWorkspaceSignalDiscoveryContext(deps, {
    workspace_id: input.workspace_id,
    source_id: input.source_id,
  });
  if (!ctx) return { outcome: "skipped:source_not_found" };
  return discoverWorkspaceSignal(deps, ctx, input);
}

function hintFromStructured(
  structured: Record<string, unknown> | null,
): SignalCompanyHint | null {
  if (!structured) return null;
  const nested = recordValue(structured.company);
  if (nested) {
    const nestedHint = hintFromCompanyObject(nested);
    if (nestedHint) return nestedHint;
  }
  if (typeof structured.company === "string") {
    const directCompany = makeSignalCompanyHint({
      name: structured.company,
      domain: firstDomain(
        structured.company_domain,
        structured.company_website,
        structured.website,
      ),
      description: stringValue(structured.company_description),
      source: "structured_company",
      confidence: "explicit",
    });
    if (directCompany) return directCompany;
  }
  return hintFromExplicitFields(structured, "structured_company", "explicit");
}

function hintFromCompanyObject(record: Record<string, unknown>): SignalCompanyHint | null {
  return makeSignalCompanyHint({
    name:
      stringValue(record.name) ??
      stringValue(record.company_name) ??
      stringValue(record.organization_name) ??
      stringValue(record.account_name),
    domain: firstDomain(
      record.domain,
      record.website,
      record.url,
      record.company_domain,
      record.company_website,
      record.organization_domain,
      record.organization_website,
    ),
    description:
      stringValue(record.description) ??
      stringValue(record.company_description) ??
      stringValue(record.organization_description),
    source: "structured_company",
    confidence: "explicit",
  });
}

function hintFromExplicitFields(
  record: Record<string, unknown>,
  source: string,
  confidence: "explicit" | "derived",
): SignalCompanyHint | null {
  const name =
    stringValue(record.target_company_name) ??
    stringValue(record.company_name) ??
    stringValue(record.organization_name) ??
    stringValue(record.account_name);
  const domain = firstDomain(
    record.target_company_domain,
    record.target_company_website,
    record.company_domain,
    record.company_website,
    record.organization_domain,
    record.organization_website,
    name ? record.domain : null,
    name ? record.website : null,
  );
  return makeSignalCompanyHint({
    name,
    domain,
    description:
      stringValue(record.company_description) ??
      stringValue(record.organization_description) ??
      stringValue(record.description),
    source,
    confidence,
  });
}

function makeSignalCompanyHint(input: {
  name?: unknown;
  domain?: string | null;
  description?: string | null;
  source: string;
  confidence: "explicit" | "derived";
}): SignalCompanyHint | null {
  const domain = input.domain ?? null;
  const name = sanitizeCompanyName(input.name) ?? (domain ? nameFromDomain(domain) : null);
  if (!name) return null;
  return {
    name,
    domain,
    description: stringValue(input.description) ?? null,
    source: input.source,
    confidence: input.confidence,
  };
}

function firstDomain(...values: unknown[]): string | null {
  for (const value of values) {
    const domain = normalizeCompanyDomain(value);
    if (domain) return domain;
  }
  return null;
}

function firstDomainInText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = stringValue(value);
    if (!text) continue;
    const urls = text.match(/https?:\/\/[^\s<>)\]]+/gi) ?? [];
    for (const url of urls) {
      const domain = normalizeCompanyDomain(url.replace(/[.,;:!?]+$/, ""));
      if (domain) return domain;
    }
    const bareDomains = text.match(/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+\b/gi) ?? [];
    for (const candidate of bareDomains) {
      const index = text.toLowerCase().indexOf(candidate.toLowerCase());
      if (index > 0 && text[index - 1] === "@") continue;
      const domain = normalizeCompanyDomain(candidate.replace(/[.,;:!?]+$/, ""));
      if (domain) return domain;
    }
  }
  return null;
}

function normalizeCompanyDomain(value: unknown): string | null {
  const raw = stringValue(value)?.toLowerCase();
  if (!raw || raw.includes("@")) return null;
  const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const hostname = new URL(withProtocol).hostname
      .replace(/\.$/, "")
      .replace(/^www\./, "")
      .toLowerCase();
    if (!hostname.includes(".")) return null;
    if (isBlockedCompanyDomain(hostname)) return null;
    return hostname;
  } catch {
    return null;
  }
}

function domainFromUrl(value: unknown): string | null {
  return normalizeCompanyDomain(value);
}

const BLOCKED_COMPANY_DOMAINS = new Set([
  "businesswire.com",
  "facebook.com",
  "forbes.com",
  "github.com",
  "globenewswire.com",
  "linkedin.com",
  "medium.com",
  "news.google.com",
  "news.ycombinator.com",
  "old.reddit.com",
  "prnewswire.com",
  "producthunt.com",
  "reddit.com",
  "substack.com",
  "techcrunch.com",
  "theverge.com",
  "twitter.com",
  "x.com",
  "ycombinator.com",
  "youtu.be",
  "youtube.com",
]);

function isBlockedCompanyDomain(domain: string): boolean {
  for (const blocked of BLOCKED_COMPANY_DOMAINS) {
    if (domain === blocked || domain.endsWith(`.${blocked}`)) {
      return true;
    }
  }
  return false;
}

function nameFromDomain(domain: string): string {
  const labels = domain.split(".").filter(Boolean);
  let label = labels.length >= 2 ? labels[labels.length - 2] : labels[0] ?? domain;
  if (labels.length >= 3 && ["co", "com", "net", "org"].includes(label)) {
    label = labels[labels.length - 3] ?? label;
  }
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function hiringCompanyNameFromText(
  title: unknown,
  content: unknown,
  domain: string | null,
): string | null {
  for (const value of [title, content]) {
    const text = stringValue(value);
    if (!text) continue;
    const firstClause = text
      .split(/\s+\|\s+|\s+-\s+|\s+—\s+/)[0]
      ?.replace(/\b(?:is\s+)?hiring\b.*$/i, "")
      .replace(/\s*\((?:yc|y\s*combinator)[^)]+\)\s*/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!firstClause) continue;
    if (/^(ask|show)\s+hn\b/i.test(firstClause)) continue;
    if (/who'?s hiring/i.test(firstClause)) continue;
    const name = sanitizeCompanyName(firstClause);
    if (name) return name;
  }
  return domain ? nameFromDomain(domain) : null;
}

function signalRepairAdapterId(
  sourceKind: string | null,
  sourceConfig: Record<string, unknown>,
  provenance: Record<string, unknown>,
): string {
  return (
    stringValue(provenance.adapter) ??
    stringValue(sourceConfig.adapter) ??
    sourceKind ??
    "unknown"
  );
}

function signalRepairStructured(
  properties: Record<string, unknown>,
  provenance: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return (
    recordValue(properties.structured) ??
    recordValue(provenance.structured) ??
    (Object.keys(properties).length > 0 ? properties : undefined)
  );
}

function signalRepairNoveltyHint(
  properties: Record<string, unknown>,
  audienceHint: Record<string, unknown> | null,
): { domain?: string } | undefined {
  const noveltyHint = recordValue(properties.novelty_hint) ?? audienceHint;
  const domain = firstDomain(noveltyHint?.domain);
  return domain ? { domain } : undefined;
}

function sanitizeCompanyName(value: unknown): string | null {
  const text = stringValue(value);
  if (!text || text.includes("@")) return null;
  if (/^https?:\/\//i.test(text)) return null;
  if (text.length > 120) return null;
  return text;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : null;
}

async function existingSignalId(
  pool: Pool,
  workspace_id: string,
  source_id: string,
  external_id: string,
): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from signals
      where workspace_id = $1
        and source_id    = $2
        and provenance->>'external_id' = $3
      limit 1`,
    [workspace_id, source_id, external_id],
  );
  return rows[0]?.id ?? null;
}

async function sourceDailyItemLimitState(
  pool: Pool,
  ctx: WorkspaceSignalDiscoveryContext,
): Promise<{ cap: number; used: number } | null> {
  const cap = positiveInteger(ctx.source.config.max_daily_items);
  if (cap === null) return null;
  const { rows } = await pool.query<{ used: string }>(
    `select count(*)::text as used
       from signals
      where workspace_id = $1
        and source_id = $2
        and ingested_at >= now() - interval '24 hours'`,
    [ctx.workspace_id, ctx.source.id],
  );
  return { cap, used: Number(rows[0]?.used ?? 0) };
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : null;
}

function parseConfiguredSignalKind(config: Record<string, unknown>): SignalKind | null {
  const value = config.kind ?? config.signal_kind;
  return isSignalKind(value) ? value : null;
}

function isSignalKind(value: unknown): value is SignalKind {
  return (
    value === "funding" ||
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
    value === "other"
  );
}

import type { TrackedCompany } from "../catalog.ts";
import type { RawCandidate } from "../types.ts";
import { ashbyAdapter } from "./ashby.ts";
import type {
  WorkspaceAdapter,
  WorkspacePollInput,
  WorkspacePollResult,
} from "./_workspace-types.ts";
import { greenhouseAdapter } from "./greenhouse.ts";
import { leverAdapter } from "./lever.ts";
import { secEdgarAdapter } from "./sec-edgar.ts";
import { workableAdapter } from "./workable.ts";
import type { CatalogAdapter } from "./types.ts";

type OfficialWorkspaceAdapterId =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workable"
  | "sec_edgar";

const OFFICIAL_ADAPTERS: Record<OfficialWorkspaceAdapterId, CatalogAdapter> = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
  workable: workableAdapter,
  sec_edgar: secEdgarAdapter,
};

export const greenhouseWorkspaceAdapter = officialWorkspaceAdapter("greenhouse");
export const leverWorkspaceAdapter = officialWorkspaceAdapter("lever");
export const ashbyWorkspaceAdapter = officialWorkspaceAdapter("ashby");
export const workableWorkspaceAdapter = officialWorkspaceAdapter("workable");
export const secEdgarWorkspaceAdapter = officialWorkspaceAdapter("sec_edgar");

function officialWorkspaceAdapter(id: OfficialWorkspaceAdapterId): WorkspaceAdapter {
  const catalog = OFFICIAL_ADAPTERS[id];
  return {
    id,
    kindHint: catalog.kindHint,
    async poll(input: WorkspacePollInput): Promise<WorkspacePollResult> {
      const company = companyFromWorkspaceSource(input, id);
      const result = await catalog.poll({
        company,
        cursor: input.cursor,
        fetchImpl: input.fetchImpl,
      });
      return {
        cursor: result.cursor,
        items: result.items.map((item) =>
          enrichOfficialItem(item, input, id, company),
        ),
      };
    },
  };
}

function companyFromWorkspaceSource(
  input: WorkspacePollInput,
  id: OfficialWorkspaceAdapterId,
): TrackedCompany {
  const cfg = input.source.config;
  const slug = sourceSlug(cfg, id);
  const companyName = stringValue(cfg.company_name) ?? input.source.name;
  const companyDomain = domainValue(
    cfg.company_domain,
    cfg.domain,
    cfg.website_url,
    cfg.website,
  );
  return {
    id: stringValue(cfg.company_id) ?? input.source.id,
    name: companyName,
    domain: companyDomain,
    industry: stringValue(cfg.industry) ?? null,
    size_bucket: stringValue(cfg.size_bucket) ?? null,
    greenhouse_id: id === "greenhouse" ? slug : null,
    lever_id: id === "lever" ? slug : null,
    ashby_id: id === "ashby" ? slug : null,
    workable_id: id === "workable" ? slug : null,
    career_rss_url: null,
    sec_cik: id === "sec_edgar" ? slug : null,
    properties: {
      source_id: input.source.id,
      adapter: id,
    },
    added_at: new Date(0).toISOString(),
  };
}

function sourceSlug(
  cfg: Record<string, unknown>,
  id: OfficialWorkspaceAdapterId,
): string | null {
  const direct = stringValue(cfg.board_slug) ??
    stringValue(cfg.slug) ??
    stringValue(cfg[id]) ??
    stringValue(cfg[`${id}_id`]);
  if (direct) return direct;
  switch (id) {
    case "greenhouse":
      return stringValue(cfg.greenhouse_id) ?? null;
    case "lever":
      return stringValue(cfg.lever_id) ?? null;
    case "ashby":
      return stringValue(cfg.ashby_id) ?? null;
    case "workable":
      return stringValue(cfg.workable_id) ?? null;
    case "sec_edgar":
      return stringValue(cfg.sec_cik) ?? stringValue(cfg.cik) ?? null;
  }
}

function enrichOfficialItem(
  item: RawCandidate,
  input: WorkspacePollInput,
  id: OfficialWorkspaceAdapterId,
  company: TrackedCompany,
): RawCandidate {
  const configuredKind = stringValue(input.source.config.signal_kind);
  return {
    ...item,
    kind: item.kind ?? catalogKind(id, configuredKind),
    structured: {
      ...(item.structured ?? {}),
      company: {
        name: company.name,
        domain: company.domain,
      },
      source_tier: "official",
    },
    properties: {
      source_tier: "official",
      source_reason:
        id === "sec_edgar" ? "official_regulatory_filing" : "official_ats_job_board",
    },
    provenance: {
      ...(item.provenance ?? {}),
      adapter: id,
      source_tier: "official",
      source_name: input.source.name,
      source_id: input.source.id,
    },
    novelty_hint: {
      ...(item.novelty_hint ?? {}),
      domain: item.novelty_hint?.domain ?? company.domain ?? undefined,
    },
  };
}

function catalogKind(id: OfficialWorkspaceAdapterId, configuredKind?: string): RawCandidate["kind"] {
  if (id === "greenhouse" || id === "lever" || id === "ashby" || id === "workable") {
    return "hiring";
  }
  return configuredKind === "funding" ||
    configuredKind === "hiring" ||
    configuredKind === "leadership_change" ||
    configuredKind === "product_launch" ||
    configuredKind === "acquisition" ||
    configuredKind === "churn_risk" ||
    configuredKind === "competitor_move" ||
    configuredKind === "podcast_mention" ||
    configuredKind === "press_mention" ||
    configuredKind === "regulation" ||
    configuredKind === "expansion" ||
    configuredKind === "layoff" ||
    configuredKind === "other"
    ? configuredKind
    : null;
}

function domainValue(...values: unknown[]): string | null {
  for (const value of values) {
    const raw = stringValue(value);
    if (!raw) continue;
    try {
      const url = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
      return url.hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return raw.replace(/^www\./, "").toLowerCase();
    }
  }
  return null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

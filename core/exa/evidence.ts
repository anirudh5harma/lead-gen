import type { Pool } from "pg";
import { upsertSource } from "../graph/nodes/sources.ts";
import type { GraphSource } from "../graph/types.ts";
import type { ExaResult } from "./client.ts";

export interface ExaEvidenceProjectionInput {
  workspace_id: string;
  query: string;
  query_intent:
    | "profile_bootstrap"
    | "rep_research"
    | "signal_discovery"
    | "draft_grounding"
    | "content_research"
    | "aeo_audit";
  results: ExaResult[];
  request_id?: string | null;
  properties?: Record<string, unknown>;
}

export interface ExaEvidenceProjectionResult {
  sources: GraphSource[];
}

export async function projectExaEvidence(
  pool: Pool,
  input: ExaEvidenceProjectionInput,
): Promise<ExaEvidenceProjectionResult> {
  const sources: GraphSource[] = [];
  for (const result of input.results) {
    if (!result.url) continue;
    const source = await upsertSource(pool, input.workspace_id, {
      kind: "web_monitor",
      name: evidenceSourceName(result),
      config: {
        provider: "exa",
        url: result.url,
        exa_result_id: result.id,
        query: input.query,
        query_intent: input.query_intent,
      },
      enabled: false,
      properties: {
        provider: "exa",
        title: result.title,
        score: result.score,
        published_at: result.publishedDate,
        author: result.author,
        summary: result.summary,
        snippet: evidenceSnippet(result),
        highlights: result.highlights.slice(0, 5),
        request_id: input.request_id ?? null,
        projected_at: new Date().toISOString(),
        ...(input.properties ?? {}),
      },
    });
    sources.push(source);
  }
  return { sources };
}

export function summarizeExaEvidence(results: readonly ExaResult[], limit = 5): string {
  const lines = results.slice(0, limit).flatMap((result, index) => {
    if (!result.url) return [];
    const title = result.title || hostname(result.url) || result.url;
    const snippet = evidenceSnippet(result);
    return [
      `${index + 1}. ${title}${snippet ? ` - ${snippet}` : ""} (${result.url})`,
    ];
  });
  return lines.join("\n");
}

function evidenceSourceName(result: ExaResult): string {
  const host = hostname(result.url);
  const title = (result.title ?? "").replace(/\s+/g, " ").trim();
  const suffix = title || result.url;
  return `Exa: ${host ? `${host} ` : ""}${suffix}`.slice(0, 180);
}

function evidenceSnippet(result: ExaResult): string | null {
  const value =
    result.summary ??
    result.highlights[0] ??
    result.text ??
    null;
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 500) : null;
}

function hostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

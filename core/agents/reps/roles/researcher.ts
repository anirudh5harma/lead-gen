import type { RoleAgent } from "../types.ts";
import type { GraphCompany, GraphPerson } from "../../../graph/types.ts";
import type { Signal } from "../../../primitives/index.ts";
import type { MemoryScope } from "../../memory/types.ts";

export interface ResearchBrief {
  signal: Signal;
  person: GraphPerson;
  company?: GraphCompany | null;
}

export interface ResearchResult {
  signal_summary: string;
  counterparty_summary: string;
  pattern_key: string;
}

/**
 * Researcher role agent.
 *
 * Responsibility: given a Signal or a target Person, gather context the
 * Writer will need: company background, recent activity, mutual ground.
 * Reads from the knowledge graph and external sources via Tools. Writes
 * findings into the Rep's semantic memory.
 */

export function createResearcherRole(): RoleAgent<ResearchBrief, ResearchResult> {
  return {
    kind: "researcher",
    name: "researcher.signal_context.v1",
    async invoke(brief, ctx) {
      const scope: MemoryScope = {
        workspace_id: brief.signal.workspace_id,
        rep_id: ctx.rep.id,
      };
      const companyName = brief.company?.name ?? "their company";
      const signal_summary = [
        brief.signal.title,
        brief.signal.content,
        brief.signal.url ? `Source: ${brief.signal.url}` : null,
      ]
        .filter(Boolean)
        .join(" ");
      const counterparty_summary = [
        brief.person.full_name,
        brief.person.title ? `${brief.person.title}` : null,
        companyName ? `at ${companyName}` : null,
        brief.company?.description ? `(${brief.company.description})` : null,
      ]
        .filter(Boolean)
        .join(" ");
      const icp = typeof brief.signal.audience_hint.icp_segment === "string"
        ? brief.signal.audience_hint.icp_segment
        : "default";
      const pattern_key = `icp:${icp}|signal:${brief.signal.kind}|stage:cold_open`;

      await ctx.memory.semantic.upsert(scope, {
        subject_type: "signal",
        subject_id: brief.signal.id,
        facts: {
          title: brief.signal.title,
          kind: brief.signal.kind,
          summary: signal_summary,
          pattern_key,
        },
        confidence: brief.signal.match_score ?? brief.signal.audience_hint.confidence ?? 0.7,
      });
      await ctx.memory.semantic.upsert(scope, {
        subject_type: "person",
        subject_id: brief.person.id,
        facts: {
          full_name: brief.person.full_name,
          title: brief.person.title,
          company: companyName,
          summary: counterparty_summary,
        },
        confidence: 0.8,
      });
      await ctx.memory.episodic.append(scope, {
        kind: "research.completed",
        content: `${counterparty_summary} :: ${signal_summary}`,
        refs: {
          signal_id: brief.signal.id,
          person_id: brief.person.id,
          company_id: brief.company?.id ?? null,
          pattern_key,
        },
      });

      return { signal_summary, counterparty_summary, pattern_key };
    },
  };
}

export const researcherStub: RoleAgent<unknown, unknown> = {
  kind: "researcher",
  name: "researcher.stub",
  async invoke() {
    throw new Error(
      "researcher role agent is not yet implemented; see core/agents/reps/roles/researcher.ts",
    );
  },
};

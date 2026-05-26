import { randomUUID } from "node:crypto";
import type {
  EpisodicAppend,
  EpisodicEntry,
  EpisodicQuery,
  EpisodicRepository,
  MemoryScope,
  ProceduralAdd,
  ProceduralExemplar,
  ProceduralOutcomeUpdate,
  ProceduralRepository,
  RepMemory,
  SemanticEntry,
  SemanticRepository,
  SemanticSubjectType,
  SemanticUpsert,
} from "../types.ts";

function scopeKey(scope: MemoryScope): string {
  return `${scope.workspace_id}:${scope.rep_id}`;
}

export function createInMemoryRepMemory(): RepMemory {
  const episodicRows: EpisodicEntry[] = [];
  const semanticRows = new Map<string, SemanticEntry>();
  const proceduralRows = new Map<string, ProceduralExemplar>();

  const episodic: EpisodicRepository = {
    async append(scope: MemoryScope, entry: EpisodicAppend): Promise<EpisodicEntry> {
      const row: EpisodicEntry = {
        id: randomUUID(),
        workspace_id: scope.workspace_id,
        rep_id: scope.rep_id,
        kind: entry.kind,
        content: entry.content,
        refs: entry.refs ?? {},
        occurred_at: entry.occurred_at ?? new Date().toISOString(),
      };
      episodicRows.push(row);
      return row;
    },

    async recent(scope: MemoryScope, query?: EpisodicQuery): Promise<EpisodicEntry[]> {
      const since = query?.since ? Date.parse(query.since) : null;
      const kinds = query?.kinds && query.kinds.length > 0 ? new Set(query.kinds) : null;
      return episodicRows
        .filter((row) => row.workspace_id === scope.workspace_id && row.rep_id === scope.rep_id)
        .filter((row) => !since || Date.parse(row.occurred_at) >= since)
        .filter((row) => !kinds || kinds.has(row.kind))
        .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
        .slice(0, query?.limit ?? 50);
    },

    async search(scope: MemoryScope, query: string, limit = 25): Promise<EpisodicEntry[]> {
      const needle = query.toLowerCase();
      return episodicRows
        .filter((row) => row.workspace_id === scope.workspace_id && row.rep_id === scope.rep_id)
        .filter((row) => row.content.toLowerCase().includes(needle))
        .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
        .slice(0, limit);
    },
  };

  const semantic: SemanticRepository = {
    async upsert(scope: MemoryScope, entry: SemanticUpsert): Promise<SemanticEntry> {
      const key = `${scopeKey(scope)}:${entry.subject_type}:${entry.subject_id}`;
      const existing = semanticRows.get(key);
      const row: SemanticEntry = {
        id: existing?.id ?? randomUUID(),
        workspace_id: scope.workspace_id,
        rep_id: scope.rep_id,
        subject_type: entry.subject_type,
        subject_id: entry.subject_id,
        facts: { ...(existing?.facts ?? {}), ...entry.facts },
        confidence: entry.confidence ?? existing?.confidence ?? null,
        last_observed_at: new Date().toISOString(),
      };
      semanticRows.set(key, row);
      return row;
    },

    async get(
      scope: MemoryScope,
      subject_type: SemanticSubjectType,
      subject_id: string,
    ): Promise<SemanticEntry | null> {
      return semanticRows.get(`${scopeKey(scope)}:${subject_type}:${subject_id}`) ?? null;
    },

    async forSubjects(
      scope: MemoryScope,
      subjects: Array<{ type: SemanticSubjectType; id: string }>,
    ): Promise<SemanticEntry[]> {
      return subjects
        .map((subject) => semanticRows.get(`${scopeKey(scope)}:${subject.type}:${subject.id}`))
        .filter((row): row is SemanticEntry => Boolean(row));
    },
  };

  const procedural: ProceduralRepository = {
    async add(scope: MemoryScope, entry: ProceduralAdd): Promise<ProceduralExemplar> {
      const row: ProceduralExemplar = {
        id: randomUUID(),
        workspace_id: scope.workspace_id,
        rep_id: scope.rep_id,
        pattern_key: entry.pattern_key,
        exemplar: entry.exemplar,
        score: entry.initial_score ?? 0.5,
        win_count: 0,
        loss_count: 0,
        last_used_at: null,
      };
      proceduralRows.set(row.id, row);
      return row;
    },

    async topForPattern(
      scope: MemoryScope,
      pattern_key: string,
      limit = 5,
    ): Promise<ProceduralExemplar[]> {
      return Array.from(proceduralRows.values())
        .filter(
          (row) =>
            row.workspace_id === scope.workspace_id &&
            row.rep_id === scope.rep_id &&
            row.pattern_key === pattern_key,
        )
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },

    async applyOutcome(
      scope: MemoryScope,
      exemplar_ids: string[],
      update: ProceduralOutcomeUpdate,
    ): Promise<void> {
      const now = new Date().toISOString();
      for (const id of exemplar_ids) {
        const row = proceduralRows.get(id);
        if (
          !row ||
          row.workspace_id !== scope.workspace_id ||
          row.rep_id !== scope.rep_id ||
          row.pattern_key !== update.pattern_key
        ) {
          continue;
        }
        row.score = Math.max(0, Math.min(1, row.score + update.delta_score));
        row.win_count += update.win ? 1 : 0;
        row.loss_count += update.win ? 0 : 1;
        row.last_used_at = now;
      }
    },
  };

  return { episodic, semantic, procedural };
}

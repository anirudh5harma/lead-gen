/**
 * Three-tier Rep memory. See ARCHITECTURE.md "Agent Fabric" and
 * db/migrations/008_primitive_rep.sql.
 *
 * Tier              Purpose                                     Grows from
 * ───────────────── ─────────────────────────────────────────── ──────────────
 * Episodic          Every raw interaction. The replay tape.     Every action
 * Semantic          Deduped facts about people/companies.       Reply parsing,
 *                                                                enrichment
 * Procedural        Winning playbooks per ICP×signal×stage.     Positive
 *                                                                outcomes
 *                                                                (the moat)
 *
 * Repositories are typed interfaces only — concrete adapters (Postgres-backed
 * via the db migrations in `db/migrations/008_primitive_rep.sql`) land in
 * core/agents/memory/adapters/ once the storage layer is wired.
 */

import type { Rep } from "../../primitives/index.ts";

export interface MemoryScope {
  workspace_id: string;
  rep_id: Rep["id"];
}

// ─── Episodic ──────────────────────────────────────────────────────────────

export interface EpisodicEntry {
  id: string;
  rep_id: string;
  workspace_id: string;
  kind: string;
  content: string;
  refs: Record<string, unknown>;
  occurred_at: string;
}

export interface EpisodicAppend {
  kind: string;
  content: string;
  refs?: Record<string, unknown>;
  occurred_at?: string;
}

export interface EpisodicQuery {
  since?: string;
  kinds?: string[];
  limit?: number;
}

export interface EpisodicRepository {
  append(scope: MemoryScope, entry: EpisodicAppend): Promise<EpisodicEntry>;
  recent(scope: MemoryScope, query?: EpisodicQuery): Promise<EpisodicEntry[]>;
  search(scope: MemoryScope, query: string, limit?: number): Promise<EpisodicEntry[]>;
}

// ─── Semantic ──────────────────────────────────────────────────────────────

export type SemanticSubjectType = "person" | "company" | "signal";

export interface SemanticEntry {
  id: string;
  rep_id: string;
  workspace_id: string;
  subject_type: SemanticSubjectType;
  subject_id: string;
  facts: Record<string, unknown>;
  confidence: number | null;
  last_observed_at: string;
}

export interface SemanticUpsert {
  subject_type: SemanticSubjectType;
  subject_id: string;
  /** New facts to merge over existing facts. Existing keys are replaced. */
  facts: Record<string, unknown>;
  confidence?: number;
}

export interface SemanticRepository {
  upsert(scope: MemoryScope, entry: SemanticUpsert): Promise<SemanticEntry>;
  get(
    scope: MemoryScope,
    subject_type: SemanticSubjectType,
    subject_id: string,
  ): Promise<SemanticEntry | null>;
  forSubjects(
    scope: MemoryScope,
    subjects: Array<{ type: SemanticSubjectType; id: string }>,
  ): Promise<SemanticEntry[]>;
}

// ─── Procedural ────────────────────────────────────────────────────────────

export interface ProceduralExemplar {
  id: string;
  rep_id: string;
  workspace_id: string;
  pattern_key: string;
  exemplar: Record<string, unknown>;
  score: number;
  win_count: number;
  loss_count: number;
  last_used_at: string | null;
}

export interface ProceduralAdd {
  pattern_key: string;
  exemplar: Record<string, unknown>;
  initial_score?: number;
}

export interface ProceduralOutcomeUpdate {
  pattern_key: string;
  win: boolean;
  delta_score: number;
}

export interface ProceduralRepository {
  add(scope: MemoryScope, entry: ProceduralAdd): Promise<ProceduralExemplar>;
  /** Top-N exemplars for a pattern key, score-descending. */
  topForPattern(
    scope: MemoryScope,
    pattern_key: string,
    limit?: number,
  ): Promise<ProceduralExemplar[]>;
  /** Apply an outcome to every exemplar that contributed to it. */
  applyOutcome(
    scope: MemoryScope,
    exemplar_ids: string[],
    update: ProceduralOutcomeUpdate,
  ): Promise<void>;
}

// ─── Composite ─────────────────────────────────────────────────────────────

export interface RepMemory {
  episodic: EpisodicRepository;
  semantic: SemanticRepository;
  procedural: ProceduralRepository;
}

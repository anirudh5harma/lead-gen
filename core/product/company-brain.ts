import type { Pool } from "pg";
import { getPool } from "../substrate/storage/index.ts";
import {
  assertProductWorkspaceAccess,
  type ProductWorkspaceSession,
} from "./app.ts";

export type CompanyBrainCardKind =
  | "profile"
  | "signal"
  | "outcome"
  | "playbook"
  | "semantic_fact"
  | "meeting_prep";

export interface CompanyBrainSourceRef {
  type: string;
  id: string;
  label: string;
  url?: string | null;
}

export interface CompanyBrainPrimitiveRefs {
  rep_id?: string | null;
  signal_id?: string | null;
  conversation_id?: string | null;
  message_id?: string | null;
  outcome_id?: string | null;
  company_id?: string | null;
  person_id?: string | null;
}

export interface CompanyBrainCard {
  id: string;
  kind: CompanyBrainCardKind;
  title: string;
  summary: string;
  confidence: number | null;
  freshness_at: string | null;
  tags: string[];
  primitive_refs: CompanyBrainPrimitiveRefs;
  source_refs: CompanyBrainSourceRef[];
}

export interface CompanyBrainConnectorStatus {
  memory_store: {
    enabled: boolean;
    status: "disabled" | "configured";
    detail: string;
  };
}

export interface CompanyBrainBrief {
  workspace_id: string;
  generated_at: string;
  cards: CompanyBrainCard[];
  connector: CompanyBrainConnectorStatus;
}

export interface CompanyBrainProfileInput {
  company_id: string;
  company_name: string;
  domain: string | null;
  website_url: string | null;
  industry: string | null;
  description: string | null;
  exa_summary?: string | null;
  updated_at?: string | Date | null;
}

export interface CompanyBrainSignalInput {
  id: string;
  kind: string | null;
  title: string;
  status: string;
  match_score: string | number | null;
  match_reason: string | null;
  freshness_at: string | Date;
  url: string | null;
}

export interface CompanyBrainOutcomeInput {
  id: string;
  kind: string;
  score: string | number;
  occurred_at: string | Date;
  attributed_signal_id: string | null;
  attributed_rep_id: string | null;
  subject_company_id: string | null;
  subject_person_id: string | null;
  properties: Record<string, unknown> | null;
}

export interface CompanyBrainPlaybookInput {
  id: string;
  rep_id: string;
  rep_name: string | null;
  pattern_key: string;
  exemplar: Record<string, unknown> | null;
  score: string | number;
  win_count: number;
  loss_count: number;
  last_used_at: string | Date | null;
  created_at: string | Date;
}

export interface CompanyBrainSemanticInput {
  id: string;
  rep_id: string;
  rep_name: string | null;
  subject_type: string;
  subject_id: string;
  facts: Record<string, unknown> | null;
  confidence: string | number | null;
  last_observed_at: string | Date;
}

export interface CompanyBrainMeetingPrepInput {
  event_id: string;
  meeting_prep_id: string;
  conversation_id: string;
  generated_at: string | Date;
  status: string;
  next_action: string;
  summary: string;
  thread_summary?: string | null;
  thread_turns?: Array<{
    message_id: string;
    direction: string;
    at: string | null;
    intent_class: string | null;
    excerpt: string;
  }> | null;
  agenda: string[];
  suggested_questions: string[];
  profile_context: {
    user?: {
      user_id?: string | null;
      name?: string | null;
      email?: string | null;
      role?: string | null;
    } | null;
    prospect?: {
      person_id?: string | null;
      name?: string | null;
      title?: string | null;
      linkedin_url?: string | null;
    } | null;
    company?: {
      company_id?: string | null;
      name?: string | null;
      domain?: string | null;
      industry?: string | null;
      description?: string | null;
    } | null;
    rep?: {
      rep_id?: string | null;
      name?: string | null;
      role?: string | null;
    } | null;
  } | null;
  source_refs: CompanyBrainSourceRef[];
}

export interface BuildCompanyBrainBriefInput {
  workspace_id: string;
  generated_at?: string;
  profile?: CompanyBrainProfileInput | null;
  signals?: CompanyBrainSignalInput[];
  outcomes?: CompanyBrainOutcomeInput[];
  playbooks?: CompanyBrainPlaybookInput[];
  semantic?: CompanyBrainSemanticInput[];
  meeting_prep?: CompanyBrainMeetingPrepInput[];
  connectorEnv?: Record<string, string | undefined>;
}

interface CompanyBrainProfileRow {
  company_id: string;
  company_name: string;
  domain: string | null;
  website_url: string | null;
  industry: string | null;
  description: string | null;
  exa_summary: string | null;
  updated_at: Date;
}

interface CompanyBrainSignalRow extends Omit<CompanyBrainSignalInput, "freshness_at"> {
  freshness_at: Date;
}

interface CompanyBrainOutcomeRow extends Omit<CompanyBrainOutcomeInput, "occurred_at"> {
  occurred_at: Date;
}

interface CompanyBrainPlaybookRow extends Omit<CompanyBrainPlaybookInput, "last_used_at" | "created_at"> {
  last_used_at: Date | null;
  created_at: Date;
}

interface CompanyBrainSemanticRow extends Omit<CompanyBrainSemanticInput, "last_observed_at"> {
  last_observed_at: Date;
}

interface CompanyBrainMeetingPrepRow extends Omit<CompanyBrainMeetingPrepInput, "generated_at"> {
  generated_at: Date;
}

export async function getWorkspaceCompanyBrain(
  session: ProductWorkspaceSession,
  pool: Pool = getPool(),
  opts: { skipAccessCheck?: boolean } = {},
): Promise<CompanyBrainBrief> {
  if (!opts.skipAccessCheck) {
    await assertProductWorkspaceAccess(session, pool);
  }
  const [profile, signals, outcomes, playbooks, semantic, meetingPrep] = await Promise.all([
    pool.query<CompanyBrainProfileRow>(
      `select id::text as company_id,
              name as company_name,
              domain::text as domain,
              properties->>'website_url' as website_url,
              industry,
              description,
              properties #>> '{exa_profile,summary}' as exa_summary,
              updated_at
         from graph_companies
        where workspace_id = $1
          and properties->>'profile_role' = 'workspace_company'
        order by updated_at desc
        limit 1`,
      [session.workspace_id],
    ),
    pool.query<CompanyBrainSignalRow>(
      `select id::text,
              kind::text as kind,
              title,
              status::text as status,
              match_score::text as match_score,
              match_reason,
              freshness_at,
              url
         from signals
        where workspace_id = $1
        order by coalesce(match_score, 0) desc, freshness_at desc
        limit 8`,
      [session.workspace_id],
    ),
    pool.query<CompanyBrainOutcomeRow>(
      `select id::text,
              kind::text as kind,
              score::text as score,
              occurred_at,
              attributed_signal_id::text,
              attributed_rep_id::text,
              subject_company_id::text,
              subject_person_id::text,
              properties
         from outcomes
        where workspace_id = $1
        order by occurred_at desc
        limit 8`,
      [session.workspace_id],
    ),
    pool.query<CompanyBrainPlaybookRow>(
      `select rmp.id::text,
              rmp.rep_id::text,
              r.name as rep_name,
              rmp.pattern_key,
              rmp.exemplar,
              rmp.score::text as score,
              rmp.win_count,
              rmp.loss_count,
              rmp.last_used_at,
              rmp.created_at
         from rep_memory_procedural rmp
         left join reps r
           on r.workspace_id = rmp.workspace_id
          and r.id = rmp.rep_id
        where rmp.workspace_id = $1
        order by rmp.score desc, rmp.created_at desc
        limit 8`,
      [session.workspace_id],
    ),
    pool.query<CompanyBrainSemanticRow>(
      `select rms.id::text,
              rms.rep_id::text,
              r.name as rep_name,
              rms.subject_type,
              rms.subject_id::text,
              rms.facts,
              rms.confidence::text as confidence,
              rms.last_observed_at
         from rep_memory_semantic rms
         left join reps r
           on r.workspace_id = rms.workspace_id
          and r.id = rms.rep_id
        where rms.workspace_id = $1
        order by rms.last_observed_at desc
        limit 8`,
      [session.workspace_id],
    ),
    pool.query<CompanyBrainMeetingPrepRow>(
      `select id::text as event_id,
              payload->>'meeting_prep_id' as meeting_prep_id,
              payload->>'conversation_id' as conversation_id,
              (payload->>'generated_at')::timestamptz as generated_at,
              payload->>'status' as status,
              payload->>'next_action' as next_action,
              payload->>'summary' as summary,
              payload->>'thread_summary' as thread_summary,
              coalesce(payload->'thread_turns', '[]'::jsonb) as thread_turns,
              coalesce(payload->'agenda', '[]'::jsonb) as agenda,
              coalesce(payload->'suggested_questions', '[]'::jsonb) as suggested_questions,
              coalesce(payload->'profile_context', '{}'::jsonb) as profile_context,
              coalesce(payload->'source_refs', '[]'::jsonb) as source_refs
         from events
        where workspace_id = $1
          and event_type = 'meeting.prep.generated'
        order by occurred_at desc
        limit 8`,
      [session.workspace_id],
    ),
  ]);

  return buildCompanyBrainBrief({
    workspace_id: session.workspace_id,
    profile: profile.rows[0] ?? null,
    signals: signals.rows,
    outcomes: outcomes.rows,
    playbooks: playbooks.rows,
    semantic: semantic.rows,
    meeting_prep: meetingPrep.rows,
  });
}

export function buildCompanyBrainBrief(
  input: BuildCompanyBrainBriefInput,
): CompanyBrainBrief {
  const generated_at = input.generated_at ?? new Date().toISOString();
  const cards = [
    input.profile ? profileCard(input.profile) : null,
    ...(input.signals ?? []).map(signalCard),
    ...(input.outcomes ?? []).map(outcomeCard),
    ...(input.playbooks ?? []).map(playbookCard),
    ...(input.semantic ?? []).map(semanticCard),
    ...(input.meeting_prep ?? []).map(meetingPrepCard),
  ]
    .filter((card): card is CompanyBrainCard => Boolean(card))
    .filter((card) => card.source_refs.length > 0)
    .sort(compareCards)
    .slice(0, 24);

  return {
    workspace_id: input.workspace_id,
    generated_at,
    cards,
    connector: memoryStoreConnectorStatus(input.connectorEnv ?? process.env),
  };
}

export function formatCompanyBrainMarkdown(brief: CompanyBrainBrief): string {
  const connector = brief.connector.memory_store.enabled
    ? "Memory Store connector configured"
    : "Memory Store connector disabled; using Bombsell native brain";
  const lines = [
    `- ${connector}`,
    ...brief.cards.slice(0, 12).map((card) => {
      const confidence = card.confidence == null ? "-" : card.confidence.toFixed(2);
      const tags = card.tags.length > 0 ? ` tags=${card.tags.join(",")}` : "";
      return `- [${card.kind}] ${line(card.title)} confidence=${confidence} fresh=${card.freshness_at ?? "-"} refs=${card.source_refs.length}${tags}: ${line(card.summary)}`;
    }),
  ];
  return lines.length > 1 ? lines.join("\n") : "- none";
}

function profileCard(profile: CompanyBrainProfileInput): CompanyBrainCard {
  const summary = [
    profile.description,
    profile.exa_summary,
    profile.industry ? `Industry: ${profile.industry}` : null,
  ].filter(Boolean).join(" ");
  return {
    id: `profile:${profile.company_id}`,
    kind: "profile",
    title: profile.company_name,
    summary: summary || "Workspace company profile.",
    confidence: profile.exa_summary ? 0.8 : 0.65,
    freshness_at: isoOrNull(profile.updated_at),
    tags: ["company_profile", ...(profile.industry ? [profile.industry] : [])],
    primitive_refs: { company_id: profile.company_id },
    source_refs: [{
      type: "graph_company",
      id: profile.company_id,
      label: "Workspace company profile",
      url: profile.website_url,
    }],
  };
}

function signalCard(signal: CompanyBrainSignalInput): CompanyBrainCard {
  return {
    id: `signal:${signal.id}`,
    kind: "signal",
    title: signal.title,
    summary: signal.match_reason || `${signal.status} ${signal.kind ?? "signal"}`,
    confidence: numericOrNull(signal.match_score),
    freshness_at: isoOrNull(signal.freshness_at),
    tags: ["signal", signal.status, signal.kind ?? "unknown"].filter(Boolean),
    primitive_refs: { signal_id: signal.id },
    source_refs: [{
      type: "signal",
      id: signal.id,
      label: "Signal",
      url: signal.url,
    }],
  };
}

function outcomeCard(outcome: CompanyBrainOutcomeInput): CompanyBrainCard {
  const detail =
    stringProp(outcome.properties, "summary") ??
    stringProp(outcome.properties, "note") ??
    `${outcome.kind} outcome with score ${numericOrNull(outcome.score) ?? "-"}.`;
  return {
    id: `outcome:${outcome.id}`,
    kind: "outcome",
    title: outcome.kind,
    summary: detail,
    confidence: numericOrNull(outcome.score),
    freshness_at: isoOrNull(outcome.occurred_at),
    tags: ["outcome", outcome.kind],
    primitive_refs: {
      outcome_id: outcome.id,
      signal_id: outcome.attributed_signal_id,
      rep_id: outcome.attributed_rep_id,
      company_id: outcome.subject_company_id,
      person_id: outcome.subject_person_id,
    },
    source_refs: [{
      type: "outcome",
      id: outcome.id,
      label: "Outcome",
    }],
  };
}

function playbookCard(playbook: CompanyBrainPlaybookInput): CompanyBrainCard {
  const exemplar = playbook.exemplar ?? {};
  const body = stringProp(exemplar, "body") ?? stringProp(exemplar, "summary");
  return {
    id: `playbook:${playbook.id}`,
    kind: "playbook",
    title: playbook.pattern_key,
    summary:
      body ??
      `${playbook.rep_name ?? "Rep"} playbook scored ${numericOrNull(playbook.score) ?? "-"}.`,
    confidence: numericOrNull(playbook.score),
    freshness_at: isoOrNull(playbook.last_used_at ?? playbook.created_at),
    tags: ["playbook", `wins:${playbook.win_count}`, `losses:${playbook.loss_count}`],
    primitive_refs: { rep_id: playbook.rep_id },
    source_refs: [{
      type: "rep_memory_procedural",
      id: playbook.id,
      label: playbook.rep_name ?? "Procedural memory",
    }],
  };
}

function semanticCard(entry: CompanyBrainSemanticInput): CompanyBrainCard {
  const facts = entry.facts ?? {};
  const summary = Object.entries(facts)
    .slice(0, 5)
    .map(([key, value]) => `${key}: ${shortValue(value)}`)
    .join("; ");
  return {
    id: `semantic:${entry.id}`,
    kind: "semantic_fact",
    title: `${entry.subject_type}:${entry.subject_id}`,
    summary: summary || "Semantic fact.",
    confidence: numericOrNull(entry.confidence),
    freshness_at: isoOrNull(entry.last_observed_at),
    tags: ["semantic", entry.subject_type],
    primitive_refs: {
      rep_id: entry.rep_id,
      company_id: entry.subject_type === "company" ? entry.subject_id : null,
      person_id: entry.subject_type === "person" ? entry.subject_id : null,
      signal_id: entry.subject_type === "signal" ? entry.subject_id : null,
    },
    source_refs: [{
      type: "rep_memory_semantic",
      id: entry.id,
      label: entry.rep_name ?? "Semantic memory",
    }],
  };
}

function meetingPrepCard(prep: CompanyBrainMeetingPrepInput): CompanyBrainCard {
  const prospect = prep.profile_context?.prospect ?? null;
  const company = prep.profile_context?.company ?? null;
  const rep = prep.profile_context?.rep ?? null;
  const signalRef = prep.source_refs.find((ref) => ref.type === "signal");
  const messageRef = prep.source_refs.find((ref) => ref.type === "message");
  const outcomeRef = prep.source_refs.find((ref) => ref.type === "outcome");
  const threadTurnCount = Array.isArray(prep.thread_turns) ? prep.thread_turns.length : 0;
  const sourceRefs = [
    {
      type: "meeting_prep",
      id: prep.meeting_prep_id,
      label: "Meeting prep note",
    },
    ...prep.source_refs,
  ];
  const title = [
    "Meeting prep",
    prospect?.name ? `for ${prospect.name}` : null,
    company?.name ? `at ${company.name}` : null,
  ].filter(Boolean).join(" ");
  return {
    id: `meeting_prep:${prep.meeting_prep_id}`,
    kind: "meeting_prep",
    title,
    summary: prep.thread_summary ? `${prep.summary} ${prep.thread_summary}` : prep.summary,
    confidence: prep.status === "ready" ? 0.82 : 0.45,
    freshness_at: isoOrNull(prep.generated_at),
    tags: [
      "meeting_prep",
      prep.status,
      prep.next_action,
      ...(prep.agenda.length > 0 ? ["agenda"] : []),
      ...(prep.suggested_questions.length > 0 ? ["questions"] : []),
      ...(threadTurnCount > 0 ? ["thread_context"] : []),
    ],
    primitive_refs: {
      conversation_id: prep.conversation_id,
      message_id: messageRef?.id ?? null,
      signal_id: signalRef?.id ?? null,
      outcome_id: outcomeRef?.id ?? null,
      person_id: prospect?.person_id ?? null,
      company_id: company?.company_id ?? null,
      rep_id: rep?.rep_id ?? null,
    },
    source_refs: sourceRefs,
  };
}

function memoryStoreConnectorStatus(
  env: Record<string, string | undefined>,
): CompanyBrainConnectorStatus {
  const enabled = Boolean(
    env.MEMORY_STORE_MCP_URL?.trim() ||
      env.MEMORY_STORE_API_KEY?.trim(),
  );
  return {
    memory_store: {
      enabled,
      status: enabled ? "configured" : "disabled",
      detail: enabled
        ? "Optional Memory Store connector is configured; Bombsell still keeps primitive events and graph memory as source of truth."
        : "Optional Memory Store connector is disabled; Bombsell native graph, event journal, and Rep memory remain fully functional.",
    },
  };
}

function compareCards(a: CompanyBrainCard, b: CompanyBrainCard): number {
  const confidence = (b.confidence ?? 0) - (a.confidence ?? 0);
  if (confidence !== 0) return confidence;
  return Date.parse(b.freshness_at ?? "1970-01-01T00:00:00.000Z") -
    Date.parse(a.freshness_at ?? "1970-01-01T00:00:00.000Z");
}

function numericOrNull(value: unknown): number | null {
  if (value == null) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function stringProp(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function shortValue(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 160);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return "null";
  return JSON.stringify(value).slice(0, 160);
}

function line(value: unknown): string {
  if (typeof value !== "string") return "-";
  return value.replace(/\s+/g, " ").trim() || "-";
}

export type VerticalIntelligenceFactCategory =
  | "icp_rule"
  | "pain"
  | "objection"
  | "proof"
  | "competitor"
  | "trigger"
  | "positioning"
  | "signal_mapping"
  | "skill_performance";

export interface VerticalIntelligenceSourceRef {
  type: string;
  id: string;
  label: string;
  url?: string | null;
}

export interface VerticalIntelligencePrimitiveRefs {
  rep_id?: string | null;
  signal_id?: string | null;
  play_id?: string | null;
  play_run_id?: string | null;
  outcome_id?: string | null;
  company_id?: string | null;
  person_id?: string | null;
  icp_id?: string | null;
}

export interface VerticalIntelligenceFact {
  id: string;
  category: VerticalIntelligenceFactCategory;
  statement: string;
  confidence: number;
  tags: string[];
  source_refs: VerticalIntelligenceSourceRef[];
  primitive_refs: VerticalIntelligencePrimitiveRefs;
  last_observed_at: string;
  included_in_prompt: boolean;
}

export interface VerticalIntelligencePack {
  workspace_id: string;
  company_id: string;
  company_name: string;
  vertical: string;
  generated_at: string;
  graph_name: string;
  run_id: string;
  confidence: number;
  facts: VerticalIntelligenceFact[];
  prompt_context: string;
  evidence_source_ids: string[];
  redaction_status: "source_refs_only";
}

export interface VerticalIntelligenceProfileInput {
  company_id: string;
  company_name: string;
  domain?: string | null;
  website_url?: string | null;
  industry?: string | null;
  description?: string | null;
  exa_summary?: string | null;
  evidence_source_ids?: string[];
  intelligence?: {
    market_terms?: string[];
    positioning_notes?: string[];
    competitor_mentions?: string[];
    audience_terms?: string[];
    proof_points?: string[];
  } | null;
  updated_at?: string | Date | null;
}

export interface VerticalIntelligenceIcpInput {
  id: string;
  name: string;
  description: string;
  must_haves?: unknown[];
  nice_to_haves?: string[];
  match_threshold?: string | number | null;
  enabled?: boolean;
  updated_at?: string | Date | null;
}

export interface VerticalIntelligenceSemanticInput {
  id: string;
  rep_id?: string | null;
  subject_type: string;
  subject_id: string;
  facts: Record<string, unknown> | null;
  confidence?: string | number | null;
  last_observed_at: string | Date;
}

export interface VerticalIntelligencePlaybookInput {
  id: string;
  rep_id?: string | null;
  pattern_key: string;
  score: string | number;
  win_count: number;
  loss_count: number;
  last_used_at?: string | Date | null;
  created_at: string | Date;
}

export interface BuildVerticalIntelligenceInput {
  workspace_id: string;
  generated_at?: string;
  graph_name?: string;
  run_id?: string;
  profile: VerticalIntelligenceProfileInput;
  icps?: VerticalIntelligenceIcpInput[];
  semantic?: VerticalIntelligenceSemanticInput[];
  playbooks?: VerticalIntelligencePlaybookInput[];
}

const PROMPT_CONFIDENCE_THRESHOLD = 0.6;

export function buildVerticalIntelligencePack(
  input: BuildVerticalIntelligenceInput,
): VerticalIntelligencePack {
  const generated_at = input.generated_at ?? new Date().toISOString();
  const graph_name = input.graph_name ?? "vertical.intelligence_graph.v1";
  const run_id = input.run_id ?? `vertical:${input.workspace_id}:${input.profile.company_id}`;
  const vertical = inferVertical(input.profile);
  const facts = [
    ...profileFacts(input.profile, generated_at),
    ...(input.icps ?? []).flatMap((icp) =>
      icp.enabled === false ? [] : icpFacts(icp, input.profile, generated_at),
    ),
    ...(input.semantic ?? []).flatMap((fact) =>
      semanticFacts(fact, input.profile, generated_at),
    ),
    ...(input.playbooks ?? []).flatMap((playbook) =>
      playbookFacts(playbook, input.profile, generated_at),
    ),
  ]
    .map((fact) => ({
      ...fact,
      included_in_prompt: fact.confidence >= PROMPT_CONFIDENCE_THRESHOLD,
    }))
    .sort(compareFacts)
    .slice(0, 60);

  const prompt_context = formatVerticalIntelligenceMarkdown({
    workspace_id: input.workspace_id,
    company_id: input.profile.company_id,
    company_name: input.profile.company_name,
    vertical,
    generated_at,
    graph_name,
    run_id,
    confidence: packConfidence(facts),
    facts,
    evidence_source_ids: uniqueStrings(input.profile.evidence_source_ids ?? []),
    prompt_context: "",
    redaction_status: "source_refs_only",
  });

  return {
    workspace_id: input.workspace_id,
    company_id: input.profile.company_id,
    company_name: input.profile.company_name,
    vertical,
    generated_at,
    graph_name,
    run_id,
    confidence: packConfidence(facts),
    facts,
    prompt_context,
    evidence_source_ids: uniqueStrings(input.profile.evidence_source_ids ?? []),
    redaction_status: "source_refs_only",
  };
}

export function formatVerticalIntelligenceMarkdown(
  pack: VerticalIntelligencePack | null | undefined,
  opts: { limit?: number } = {},
): string {
  if (!pack) return "- none";
  const included = pack.facts
    .filter((fact) => fact.included_in_prompt)
    .sort(compareFacts)
    .slice(0, opts.limit ?? 10);
  if (included.length === 0) {
    return [
      `- Vertical: ${line(pack.vertical)} confidence=${pack.confidence.toFixed(2)}`,
      "- No vertical facts above confidence threshold yet.",
    ].join("\n");
  }
  return [
    `- Vertical: ${line(pack.vertical)} confidence=${pack.confidence.toFixed(2)}`,
    ...included.map((fact) =>
      `- [${fact.category}] ${line(fact.statement)} confidence=${fact.confidence.toFixed(2)} refs=${fact.source_refs.length} tags=${fact.tags.join(",") || "-"}`,
    ),
  ].join("\n");
}

export function parseVerticalIntelligencePack(
  value: unknown,
): VerticalIntelligencePack | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const workspace_id = stringValue(record.workspace_id);
  const company_id = stringValue(record.company_id);
  const company_name = stringValue(record.company_name);
  const vertical = stringValue(record.vertical);
  const generated_at = stringValue(record.generated_at);
  const graph_name = stringValue(record.graph_name);
  const run_id = stringValue(record.run_id);
  if (!workspace_id || !company_id || !company_name || !vertical || !generated_at) {
    return null;
  }
  const facts = Array.isArray(record.facts)
    ? record.facts.flatMap(parseFact)
    : [];
  return {
    workspace_id,
    company_id,
    company_name,
    vertical,
    generated_at,
    graph_name: graph_name || "vertical.intelligence_graph.v1",
    run_id: run_id || `vertical:${workspace_id}:${company_id}`,
    confidence: clamp01(numberValue(record.confidence) ?? packConfidence(facts)),
    facts,
    prompt_context: stringValue(record.prompt_context) || "",
    evidence_source_ids: stringArray(record.evidence_source_ids),
    redaction_status: "source_refs_only",
  };
}

function profileFacts(
  profile: VerticalIntelligenceProfileInput,
  observedAt: string,
): VerticalIntelligenceFact[] {
  const refs = profileSourceRefs(profile);
  const primitive_refs = { company_id: profile.company_id };
  const intelligence = profile.intelligence ?? {};
  return [
    ...stringArray(intelligence.positioning_notes).map((statement) =>
      fact("positioning", statement, 0.82, ["positioning"], refs, primitive_refs, observedAt),
    ),
    ...stringArray(intelligence.proof_points).map((statement) =>
      fact("proof", statement, 0.84, ["proof"], refs, primitive_refs, observedAt),
    ),
    ...stringArray(intelligence.competitor_mentions).map((statement) =>
      fact("competitor", statement, 0.74, ["competitor"], refs, primitive_refs, observedAt),
    ),
    ...stringArray(intelligence.audience_terms).map((audience) =>
      fact(
        "icp_rule",
        `Relevant audience term: ${audience}`,
        0.7,
        ["audience", audience],
        refs,
        primitive_refs,
        observedAt,
      ),
    ),
    ...stringArray(intelligence.market_terms).slice(0, 8).map((term) =>
      fact(
        "positioning",
        `Market term to use carefully: ${term}`,
        0.66,
        ["market_term", term],
        refs,
        primitive_refs,
        observedAt,
      ),
    ),
  ];
}

function icpFacts(
  icp: VerticalIntelligenceIcpInput,
  profile: VerticalIntelligenceProfileInput,
  observedAt: string,
): VerticalIntelligenceFact[] {
  const refs = [{
    type: "workspace_icp",
    id: icp.id,
    label: icp.name,
  }];
  const primitive_refs = { company_id: profile.company_id, icp_id: icp.id };
  return [
    fact(
      "icp_rule",
      `${icp.name}: ${icp.description}`,
      0.78,
      ["icp", icp.name],
      refs,
      primitive_refs,
      isoOrNow(icp.updated_at, observedAt),
    ),
    ...stringArray(icp.nice_to_haves).slice(0, 6).map((rule) =>
      fact("icp_rule", `Nice-to-have ICP signal: ${rule}`, 0.66, ["icp"], refs, primitive_refs, observedAt),
    ),
    ...arrayValue(icp.must_haves).slice(0, 5).map((rule) =>
      fact(
        "signal_mapping",
        `Match rule: ${compactJson(rule)}`,
        0.7,
        ["match_rule"],
        refs,
        primitive_refs,
        observedAt,
      ),
    ),
  ];
}

function semanticFacts(
  semantic: VerticalIntelligenceSemanticInput,
  profile: VerticalIntelligenceProfileInput,
  fallbackObservedAt: string,
): VerticalIntelligenceFact[] {
  const source_refs = [{
    type: "semantic_memory",
    id: semantic.id,
    label: `${semantic.subject_type}:${semantic.subject_id}`,
  }];
  const primitive_refs = {
    company_id: profile.company_id,
    rep_id: semantic.rep_id ?? null,
  };
  const confidence = clamp01(numberValue(semantic.confidence) ?? 0.5);
  const observedAt = isoOrNow(semantic.last_observed_at, fallbackObservedAt);
  return Object.entries(semantic.facts ?? {}).flatMap(([key, value]) => {
    const category = semanticCategory(key);
    if (!category) return [];
    const statement = `${titleizeKey(key)}: ${stringifyFactValue(value)}`;
    return fact(category, statement, confidence, ["memory", key], source_refs, primitive_refs, observedAt);
  });
}

function playbookFacts(
  playbook: VerticalIntelligencePlaybookInput,
  profile: VerticalIntelligenceProfileInput,
  fallbackObservedAt: string,
): VerticalIntelligenceFact[] {
  const total = playbook.win_count + playbook.loss_count;
  if (total < 2) return [];
  const score = clamp01(numberValue(playbook.score) ?? 0.5);
  const winRate = playbook.win_count / total;
  return [
    fact(
      "skill_performance",
      `Pattern ${playbook.pattern_key} has ${playbook.win_count} wins, ${playbook.loss_count} losses, win_rate=${Math.round(winRate * 100)}%.`,
      Math.max(0.6, score),
      ["skill_performance"],
      [{
        type: "procedural_memory",
        id: playbook.id,
        label: playbook.pattern_key,
      }],
      {
        company_id: profile.company_id,
        rep_id: playbook.rep_id ?? null,
      },
      isoOrNow(playbook.last_used_at ?? playbook.created_at, fallbackObservedAt),
    ),
  ];
}

function fact(
  category: VerticalIntelligenceFactCategory,
  statement: string,
  confidence: number,
  tags: string[],
  source_refs: VerticalIntelligenceSourceRef[],
  primitive_refs: VerticalIntelligencePrimitiveRefs,
  last_observed_at: string,
): VerticalIntelligenceFact {
  const cleanStatement = line(statement, 260);
  return {
    id: `vertical_fact:${category}:${hash(`${category}:${cleanStatement}`)}`,
    category,
    statement: cleanStatement,
    confidence: clamp01(confidence),
    tags: uniqueStrings(tags.map((tag) => tag.trim()).filter(Boolean)).slice(0, 8),
    source_refs,
    primitive_refs,
    last_observed_at,
    included_in_prompt: confidence >= PROMPT_CONFIDENCE_THRESHOLD,
  };
}

function profileSourceRefs(
  profile: VerticalIntelligenceProfileInput,
): VerticalIntelligenceSourceRef[] {
  return [
    {
      type: "graph_company",
      id: profile.company_id,
      label: "Workspace company profile",
      url: profile.website_url ?? null,
    },
    ...uniqueStrings(profile.evidence_source_ids ?? []).slice(0, 8).map((id) => ({
      type: "evidence_source",
      id,
      label: "Profile evidence",
    })),
  ];
}

function inferVertical(profile: VerticalIntelligenceProfileInput): string {
  if (profile.industry?.trim()) return profile.industry.trim();
  const term = profile.intelligence?.market_terms?.find((item) => item.trim());
  if (term) return term.trim();
  const description = profile.description?.trim();
  if (description) return line(description, 80);
  return "B2B GTM";
}

function semanticCategory(key: string): VerticalIntelligenceFactCategory | null {
  const normalized = key.toLowerCase();
  if (/(objection|concern|risk)/.test(normalized)) return "objection";
  if (/(proof|case|customer|result)/.test(normalized)) return "proof";
  if (/(pain|problem|need)/.test(normalized)) return "pain";
  if (/(trigger|buying|timing)/.test(normalized)) return "trigger";
  if (/(competitor|alternative)/.test(normalized)) return "competitor";
  return null;
}

function compareFacts(a: VerticalIntelligenceFact, b: VerticalIntelligenceFact): number {
  if (a.included_in_prompt !== b.included_in_prompt) {
    return a.included_in_prompt ? -1 : 1;
  }
  return b.confidence - a.confidence ||
    b.last_observed_at.localeCompare(a.last_observed_at) ||
    a.category.localeCompare(b.category);
}

function packConfidence(facts: readonly VerticalIntelligenceFact[]): number {
  const included = facts.filter((fact) => fact.included_in_prompt);
  if (included.length === 0) return 0;
  const avg = included.reduce((sum, fact) => sum + fact.confidence, 0) / included.length;
  return clamp01(avg);
}

function parseFact(value: unknown): VerticalIntelligenceFact[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const category = stringValue(record.category) as VerticalIntelligenceFactCategory;
  if (!isFactCategory(category)) return [];
  const statement = stringValue(record.statement);
  const last_observed_at = stringValue(record.last_observed_at);
  if (!statement || !last_observed_at) return [];
  const confidence = clamp01(numberValue(record.confidence) ?? 0);
  return [{
    id: stringValue(record.id) || `vertical_fact:${category}:${hash(statement)}`,
    category,
    statement,
    confidence,
    tags: stringArray(record.tags),
    source_refs: Array.isArray(record.source_refs)
      ? record.source_refs.flatMap(parseSourceRef)
      : [],
    primitive_refs: parsePrimitiveRefs(record.primitive_refs),
    last_observed_at,
    included_in_prompt: Boolean(record.included_in_prompt) &&
      confidence >= PROMPT_CONFIDENCE_THRESHOLD,
  }];
}

function parseSourceRef(value: unknown): VerticalIntelligenceSourceRef[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const type = stringValue(record.type);
  const id = stringValue(record.id);
  const label = stringValue(record.label);
  if (!type || !id || !label) return [];
  return [{
    type,
    id,
    label,
    url: stringValue(record.url) || null,
  }];
}

function parsePrimitiveRefs(value: unknown): VerticalIntelligencePrimitiveRefs {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  return {
    rep_id: stringValue(record.rep_id) || null,
    signal_id: stringValue(record.signal_id) || null,
    play_id: stringValue(record.play_id) || null,
    play_run_id: stringValue(record.play_run_id) || null,
    outcome_id: stringValue(record.outcome_id) || null,
    company_id: stringValue(record.company_id) || null,
    person_id: stringValue(record.person_id) || null,
    icp_id: stringValue(record.icp_id) || null,
  };
}

function isFactCategory(value: string): value is VerticalIntelligenceFactCategory {
  return [
    "icp_rule",
    "pain",
    "objection",
    "proof",
    "competitor",
    "trigger",
    "positioning",
    "signal_mapping",
    "skill_performance",
  ].includes(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isoOrNow(value: string | Date | null | undefined, fallback: string): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return fallback;
}

function titleizeKey(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stringifyFactValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(stringifyFactValue).join(", ");
  if (value && typeof value === "object") return compactJson(value);
  return String(value ?? "");
}

function compactJson(value: unknown): string {
  return JSON.stringify(value).replace(/\s+/g, " ").slice(0, 220);
}

function line(value: unknown, max = 180): string {
  if (typeof value !== "string") return "-";
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 3)}...` : compact;
}

function hash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

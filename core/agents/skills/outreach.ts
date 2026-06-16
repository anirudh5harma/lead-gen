export type OutreachSkillStage = "cold_open" | "reply";

export type OutreachSkillChannel =
  | "email"
  | "linkedin_connection"
  | "linkedin_dm"
  | "linkedin_inmail"
  | "linkedin_comment"
  | "x_dm";

export interface OutreachSkillSlot {
  key: string;
  label: string;
  source: "signal" | "counterparty" | "workspace" | "memory" | "outcome";
  required: boolean;
  instruction: string;
}

export interface OutreachSkill {
  skill_key: string;
  version: string;
  channel: OutreachSkillChannel;
  stage: OutreachSkillStage;
  name: string;
  description: string;
  framework: string[];
  slots: OutreachSkillSlot[];
  constraints: string[];
  judge_focus: string[];
  selection: {
    priority: number;
    signal_kinds?: string[];
    intents?: string[];
    actions?: OutreachSkillChannel[];
    seniority_regex?: string;
    fallback?: boolean;
  };
}

export interface SelectedOutreachSkill {
  skill_key: string;
  version: string;
  channel: OutreachSkillChannel;
  stage: OutreachSkillStage;
  name: string;
  description: string;
  pattern_key: string;
  framework: string[];
  slots: OutreachSkillSlot[];
  slot_values: Record<string, string>;
  constraints: string[];
  judge_focus: string[];
}

export interface OutreachSkillSelectionInput {
  channel: OutreachSkillChannel;
  stage: OutreachSkillStage;
  signal_kind?: string | null;
  intent?: string | null;
  action?: OutreachSkillChannel | null;
  person_title?: string | null;
}

export interface SelectedOutreachSkillInput extends OutreachSkillSelectionInput {
  base_pattern_key: string;
  slot_values?: Record<string, unknown> | null;
  preferred_skill_key?: string | null;
  preferred_skill_version?: string | null;
}

export const OUTREACH_SKILLS: readonly OutreachSkill[] = [
  {
    skill_key: "signal_problem_probe",
    version: "v1",
    channel: "email",
    stage: "cold_open",
    name: "Signal Problem Probe",
    description:
      "Cold email that connects a fresh buying signal to one likely operating problem and asks a low-friction question.",
    framework: [
      "Open with the exact signal and why it matters now.",
      "Name one plausible problem created by that signal.",
      "Tie Bombsell or the Rep's point of view to that problem without a broad pitch.",
      "Ask one concrete question that can be answered with a reply.",
    ],
    slots: [
      slot("signal_hook", "Signal hook", "signal", true, "The fresh event or trigger the opener must reference."),
      slot("why_now", "Why now", "signal", true, "The timing reason this is relevant now, not a generic compliment."),
      slot("inferred_problem", "Likely problem", "counterparty", true, "One plausible problem or risk the signal creates."),
      slot("proof_or_relevance", "Proof or relevance", "workspace", false, "One credible reason the Rep can help."),
      slot("reply_question", "Reply question", "outcome", true, "A short question designed to earn a reply."),
    ],
    constraints: [
      "No generic opener.",
      "No more than one ask.",
      "No unsupported claim about their stack, goals, or budget.",
    ],
    judge_focus: [
      "Signal is named in the first two sentences.",
      "The ask is specific enough to answer.",
      "The draft reads like a person, not a sequence template.",
    ],
    selection: {
      priority: 90,
      signal_kinds: [
        "funding",
        "hiring",
        "leadership_change",
        "product_launch",
        "expansion",
        "regulation",
        "competitor_move",
      ],
    },
  },
  {
    skill_key: "peer_proof_micro_case",
    version: "v1",
    channel: "email",
    stage: "cold_open",
    name: "Peer Proof Micro Case",
    description:
      "Cold email that uses a compact peer pattern or outcome learning before asking whether the same issue is present.",
    framework: [
      "Start from the signal, not the Rep.",
      "Reference a peer pattern, outcome learning, or workspace proof in one sentence.",
      "Translate that proof into a concrete risk or upside for the recipient.",
      "Ask whether that pattern is showing up for them.",
    ],
    slots: [
      slot("signal_hook", "Signal hook", "signal", true, "The fresh event that earns the outreach."),
      slot("peer_pattern", "Peer pattern", "outcome", true, "Outcome-backed pattern from similar teams or Plays."),
      slot("counterparty_context", "Counterparty context", "counterparty", true, "Role/company context that makes the proof relevant."),
      slot("reply_question", "Reply question", "outcome", true, "The concise question to test fit."),
    ],
    constraints: [
      "Do not invent a customer, benchmark, or metric.",
      "Keep proof to one sentence.",
      "Do not imply the recipient has the problem; ask.",
    ],
    judge_focus: [
      "Proof is credible and source-compatible.",
      "The signal and proof are connected.",
      "The email stays short enough for a cold open.",
    ],
    selection: {
      priority: 70,
      fallback: true,
    },
  },
  {
    skill_key: "linkedin_signal_dm_probe",
    version: "v1",
    channel: "linkedin_dm",
    stage: "cold_open",
    name: "LinkedIn Signal DM Probe",
    description:
      "Short LinkedIn DM that references a fresh signal and asks for a lightweight compare-notes response.",
    framework: [
      "Mention the signal in plain language.",
      "Connect it to one role-relevant consequence.",
      "Ask a short compare-notes question.",
    ],
    slots: [
      slot("signal_hook", "Signal hook", "signal", true, "The event or trigger worth mentioning."),
      slot("counterparty_context", "Counterparty context", "counterparty", true, "Role/company detail that makes the note relevant."),
      slot("reply_question", "Reply question", "outcome", true, "The short DM ask."),
    ],
    constraints: [
      "35 to 90 words.",
      "No sign-off.",
      "No fake familiarity or automation language.",
    ],
    judge_focus: [
      "The message is brief enough for LinkedIn.",
      "The ask is conversational, not a demo pitch.",
      "The signal is specific.",
    ],
    selection: {
      priority: 90,
      actions: ["linkedin_dm", "linkedin_inmail"],
    },
  },
  {
    skill_key: "linkedin_connection_why_now",
    version: "v1",
    channel: "linkedin_connection",
    stage: "cold_open",
    name: "LinkedIn Connection Why Now",
    description:
      "Connection note that explains why the connection is timely without pitching before acceptance.",
    framework: [
      "Name the trigger or shared business context.",
      "State why connecting is useful now.",
      "End with a natural connection ask, not a sales ask.",
    ],
    slots: [
      slot("signal_hook", "Signal hook", "signal", true, "The timely reason for the connection request."),
      slot("counterparty_context", "Counterparty context", "counterparty", true, "Role/company context for relevance."),
    ],
    constraints: [
      "Keep under platform-length limits.",
      "No demo ask before acceptance.",
      "No claims that require private knowledge.",
    ],
    judge_focus: [
      "The connection reason is clear.",
      "The note is not a disguised pitch.",
      "The language sounds human and specific.",
    ],
    selection: {
      priority: 100,
      actions: ["linkedin_connection"],
    },
  },
  {
    skill_key: "linkedin_comment_value_add",
    version: "v1",
    channel: "linkedin_comment",
    stage: "cold_open",
    name: "LinkedIn Comment Value Add",
    description:
      "Public comment that adds a useful angle to a post without turning the comment into a pitch.",
    framework: [
      "React to the actual post or signal.",
      "Add one useful angle, question, or concise observation.",
      "Avoid steering the public comment into a sales CTA.",
    ],
    slots: [
      slot("signal_hook", "Signal hook", "signal", true, "The post, announcement, or trigger being commented on."),
      slot("value_add", "Value add", "workspace", true, "One concise idea or question worth adding publicly."),
    ],
    constraints: [
      "No pitch.",
      "No private claims in a public comment.",
      "Keep it direct and easy to scan.",
    ],
    judge_focus: [
      "Comment is useful even if no reply happens.",
      "It does not sound like a sales sequence.",
      "It clearly reacts to the source material.",
    ],
    selection: {
      priority: 100,
      actions: ["linkedin_comment"],
    },
  },
  {
    skill_key: "reply_next_step_bridge",
    version: "v1",
    channel: "email",
    stage: "reply",
    name: "Reply Next Step Bridge",
    description:
      "Positive reply handler that acknowledges the inbound, preserves context, and asks for one concrete next step.",
    framework: [
      "Acknowledge the reply and mirror the reason they engaged.",
      "Summarize the useful next frame in one sentence.",
      "Ask for a specific next step without pretending calendar access.",
    ],
    slots: [
      slot("inbound_signal", "Inbound signal", "memory", true, "The part of the reply that shows interest or next-step intent."),
      slot("prior_context", "Prior context", "memory", true, "The outbound premise being continued."),
      slot("next_step", "Next step", "outcome", true, "The single next action to request."),
    ],
    constraints: [
      "No fake calendar availability.",
      "No new broad pitch.",
      "Preserve the existing thread context.",
    ],
    judge_focus: [
      "Reply clearly answers the inbound.",
      "The next step is singular and concrete.",
      "No scheduling claim appears without consent/context.",
    ],
    selection: {
      priority: 100,
      intents: ["meeting_intent", "positive"],
    },
  },
  {
    skill_key: "reply_objection_clarifier",
    version: "v1",
    channel: "email",
    stage: "reply",
    name: "Reply Objection Clarifier",
    description:
      "Neutral or objection reply handler that validates the objection, answers with one useful point, and keeps the path easy.",
    framework: [
      "Acknowledge the objection or requested condition.",
      "Answer with one useful point or offer to send the smallest relevant detail.",
      "Ask a low-pressure clarifying question or propose a light next step.",
    ],
    slots: [
      slot("objection", "Objection", "memory", true, "The objection, concern, or requested condition from memory/inbound."),
      slot("useful_answer", "Useful answer", "workspace", true, "One concrete answer, proof point, or clarifying detail."),
      slot("low_pressure_next_step", "Low pressure next step", "outcome", true, "A small next step that respects the objection."),
    ],
    constraints: [
      "Do not argue with the objection.",
      "Do not add multiple asks.",
      "Do not over-explain.",
    ],
    judge_focus: [
      "Tone validates the inbound.",
      "The reply uses remembered facts only when relevant.",
      "The next step respects the objection.",
    ],
    selection: {
      priority: 90,
      intents: ["neutral"],
      fallback: true,
    },
  },
];

export function listOutreachSkills(filter: Partial<OutreachSkillSelectionInput> = {}): OutreachSkill[] {
  return OUTREACH_SKILLS
    .filter((skill) => !filter.channel || skill.channel === filter.channel)
    .filter((skill) => !filter.stage || skill.stage === filter.stage)
    .filter((skill) => matchesSignal(skill, filter.signal_kind))
    .filter((skill) => matchesIntent(skill, filter.intent))
    .filter((skill) => matchesAction(skill, filter.action))
    .slice()
    .sort((a, b) => b.selection.priority - a.selection.priority || a.skill_key.localeCompare(b.skill_key));
}

export function selectOutreachSkill(input: OutreachSkillSelectionInput): OutreachSkill {
  const candidates = listOutreachSkills({
    channel: input.action ?? input.channel,
    stage: input.stage,
    signal_kind: input.signal_kind,
    intent: input.intent,
    action: input.action,
  });
  const exact = candidates
    .map((skill) => ({ skill, score: selectionScore(skill, input) }))
    .filter((candidate) => candidate.score > Number.NEGATIVE_INFINITY)
    .sort((a, b) => b.score - a.score || a.skill.skill_key.localeCompare(b.skill.skill_key));
  const selected = exact[0] ?? candidates[0];
  if (!selected) {
    throw new Error(`No outreach skill registered for ${input.channel}:${input.stage}`);
  }
  return "skill" in selected ? selected.skill : selected;
}

export function findOutreachSkill(input: OutreachSkillSelectionInput & {
  skill_key?: string | null;
  skill_version?: string | null;
}): OutreachSkill | null {
  const skillKey = cleanLookupString(input.skill_key);
  if (!skillKey) return null;
  const skillVersion = cleanLookupString(input.skill_version);
  const candidates = listOutreachSkills({
    channel: input.channel,
    stage: input.stage,
    signal_kind: input.signal_kind,
    intent: input.intent,
    action: input.action,
  }).filter((skill) => skill.skill_key === skillKey);
  if (candidates.length === 0) return null;
  if (skillVersion) {
    return candidates.find((skill) => skill.version === skillVersion) ?? candidates[0] ?? null;
  }
  return candidates[0] ?? null;
}

export function createSelectedOutreachSkill(input: SelectedOutreachSkillInput): SelectedOutreachSkill {
  const skill = findOutreachSkill({
    ...input,
    skill_key: input.preferred_skill_key,
    skill_version: input.preferred_skill_version,
  }) ?? selectOutreachSkill(input);
  return selectedOutreachSkill(skill, input.base_pattern_key, input.slot_values);
}

export function selectedOutreachSkill(
  skill: OutreachSkill,
  base_pattern_key: string,
  slot_values: Record<string, unknown> | null | undefined = {},
): SelectedOutreachSkill {
  return {
    skill_key: skill.skill_key,
    version: skill.version,
    channel: skill.channel,
    stage: skill.stage,
    name: skill.name,
    description: skill.description,
    pattern_key: outreachSkillPatternKey(base_pattern_key, skill),
    framework: [...skill.framework],
    slots: [...skill.slots],
    slot_values: normalizeSlotValues(skill, slot_values),
    constraints: [...skill.constraints],
    judge_focus: [...skill.judge_focus],
  };
}

export function outreachSkillPatternKey(base_pattern_key: string, skill: Pick<OutreachSkill, "skill_key" | "version">): string {
  return `${base_pattern_key}|skill:${skill.skill_key}@${skill.version}`;
}

export function outreachPatternCandidates(
  base_pattern_key: string,
  skill: SelectedOutreachSkill | null | undefined,
): string[] {
  if (!skill) return [base_pattern_key];
  return Array.from(new Set([skill.pattern_key, base_pattern_key]));
}

export function fallbackSeedPatternKey(
  candidates: string[],
  selected_pattern_key: string,
): string | null {
  const preferred = candidates[0] ?? null;
  return preferred && preferred !== selected_pattern_key ? preferred : null;
}

export function outreachSkillPromptBlock(skill: SelectedOutreachSkill | null | undefined): string | null {
  if (!skill) return null;
  return [
    `Selected Play Skill: ${skill.name} (${skill.skill_key}@${skill.version})`,
    `Skill description: ${skill.description}`,
    "Skill framework:",
    ...skill.framework.map((step, index) => `${index + 1}. ${step}`),
    "Required skill slots:",
    ...skill.slots.map((slot) => {
      const value = skill.slot_values[slot.key] ?? "(not available)";
      return `- ${slot.key}: ${value}`;
    }),
    "Skill constraints:",
    ...skill.constraints.map((constraint) => `- ${constraint}`),
    "Judge focus:",
    ...skill.judge_focus.map((focus) => `- ${focus}`),
    "Use the skill as a framework, not as a template to copy.",
  ].join("\n");
}

export function outreachSkillProvenance(
  skill: SelectedOutreachSkill | null | undefined,
  opts: { pattern_key: string; seed_pattern_key?: string | null },
): Record<string, unknown> {
  if (!skill) return {};
  return {
    skill_key: skill.skill_key,
    skill_version: skill.version,
    skill_name: skill.name,
    skill_channel: skill.channel,
    skill_stage: skill.stage,
    skill_framework: skill.framework,
    skill_slot_values: skill.slot_values,
    skill_judge_focus: skill.judge_focus,
    pattern_key: opts.pattern_key,
    ...(opts.seed_pattern_key ? { seed_pattern_key: opts.seed_pattern_key } : {}),
  };
}

function slot(
  key: string,
  label: string,
  source: OutreachSkillSlot["source"],
  required: boolean,
  instruction: string,
): OutreachSkillSlot {
  return { key, label, source, required, instruction };
}

function cleanLookupString(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeSlotValues(
  skill: OutreachSkill,
  values: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const input = values ?? {};
  const normalized: Record<string, string> = {};
  for (const slotDef of skill.slots) {
    const value = input[slotDef.key];
    if (typeof value === "string" && value.trim()) {
      normalized[slotDef.key] = value.trim();
    }
  }
  return normalized;
}

function selectionScore(skill: OutreachSkill, input: OutreachSkillSelectionInput): number {
  if (skill.stage !== input.stage) return Number.NEGATIVE_INFINITY;
  const targetChannel = input.action ?? input.channel;
  if (skill.channel !== targetChannel) return Number.NEGATIVE_INFINITY;
  if (!matchesSignal(skill, input.signal_kind)) return Number.NEGATIVE_INFINITY;
  if (!matchesIntent(skill, input.intent)) return Number.NEGATIVE_INFINITY;
  if (!matchesAction(skill, input.action)) return Number.NEGATIVE_INFINITY;

  let score = skill.selection.priority;
  if (input.signal_kind && skill.selection.signal_kinds?.includes(input.signal_kind)) score += 30;
  if (input.intent && skill.selection.intents?.includes(input.intent)) score += 30;
  if (input.action && skill.selection.actions?.includes(input.action)) score += 30;
  if (input.person_title && skill.selection.seniority_regex) {
    const re = new RegExp(skill.selection.seniority_regex, "iu");
    if (re.test(input.person_title)) score += 10;
  }
  if (skill.selection.fallback) score -= 5;
  return score;
}

function matchesSignal(skill: OutreachSkill, signal_kind: string | null | undefined): boolean {
  return !skill.selection.signal_kinds ||
    !signal_kind ||
    skill.selection.signal_kinds.includes(signal_kind) ||
    Boolean(skill.selection.fallback);
}

function matchesIntent(skill: OutreachSkill, intent: string | null | undefined): boolean {
  return !skill.selection.intents ||
    !intent ||
    skill.selection.intents.includes(intent) ||
    Boolean(skill.selection.fallback);
}

function matchesAction(skill: OutreachSkill, action: OutreachSkillChannel | null | undefined): boolean {
  return !skill.selection.actions ||
    !action ||
    skill.selection.actions.includes(action) ||
    Boolean(skill.selection.fallback);
}

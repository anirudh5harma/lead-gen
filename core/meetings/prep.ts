export interface MeetingPrepMessageInput {
  id: string;
  direction: string;
  subject?: string | null;
  body?: string | null;
  intent_class?: string | null;
  created_at?: string | Date | null;
}

export interface MeetingPrepOutcomeInput {
  id: string;
  kind: string;
  occurred_at?: string | Date | null;
}

export interface MeetingPrepConversationInput {
  id: string;
  topic?: string | null;
  counterparty_person_id?: string | null;
  counterparty_name?: string | null;
  counterparty_title?: string | null;
  counterparty_linkedin_url?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  company_domain?: string | null;
  company_industry?: string | null;
  company_description?: string | null;
  rep_id?: string | null;
  rep_name?: string | null;
  rep_role?: string | null;
  signal_id?: string | null;
  signal_title?: string | null;
  signal_kind?: string | null;
  signal_content?: string | null;
  signal_url?: string | null;
}

export interface MeetingPrepUserInput {
  user_id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
}

export interface MeetingPrepInput {
  conversation: MeetingPrepConversationInput;
  messages: MeetingPrepMessageInput[];
  outcomes: MeetingPrepOutcomeInput[];
  user?: MeetingPrepUserInput | null;
  calendar?: {
    consented: boolean;
    provider?: string | null;
    channel_account_id?: string | null;
    account_display_name?: string | null;
    suggested_times?: string[];
    reason?: string | null;
  } | null;
}

export interface MeetingPrepSourceRef {
  type:
    | "conversation"
    | "message"
    | "signal"
    | "outcome"
    | "person"
    | "company"
    | "rep"
    | "user";
  id: string;
  label: string;
  url?: string | null;
}

export interface MeetingPrepThreadTurn {
  message_id: string;
  direction: string;
  at: string | null;
  intent_class: string | null;
  excerpt: string;
}

export interface MeetingPrepProfileContext {
  user: {
    user_id: string | null;
    name: string | null;
    email: string | null;
    role: string | null;
  };
  prospect: {
    person_id: string | null;
    name: string | null;
    title: string | null;
    linkedin_url: string | null;
  };
  company: {
    company_id: string | null;
    name: string | null;
    domain: string | null;
    industry: string | null;
    description: string | null;
  };
  rep: {
    rep_id: string | null;
    name: string | null;
    role: string | null;
  };
}

export interface MeetingPrepNote {
  conversation_id: string;
  generated_at: string;
  status: "ready" | "blocked";
  next_action: "prepare_meeting" | "ask_for_times" | "wait_for_reply" | "do_not_follow_up";
  summary: string;
  thread_summary: string;
  thread_turns: MeetingPrepThreadTurn[];
  agenda: string[];
  suggested_questions: string[];
  suggested_times: string[];
  availability_status: "included" | "omitted_no_consent";
  availability_reason: string;
  calendar_provider: string | null;
  calendar_account_id: string | null;
  calendar_account_display_name: string | null;
  profile_context: MeetingPrepProfileContext;
  source_refs: MeetingPrepSourceRef[];
}

export function buildMeetingPrepNote(input: MeetingPrepInput): MeetingPrepNote {
  const inbound = latestMessage(input.messages, "inbound");
  const outbound = latestMessage(input.messages, "outbound");
  const latestOutcome = input.outcomes.at(-1) ?? null;
  const turns = threadTurns(input.messages);
  const blocked = shouldBlockFollowUp(input, inbound);
  const hasPositive = Boolean(
    latestOutcome &&
      ["positive_reply", "meeting_booked", "opportunity_created", "deal_won"].includes(
        latestOutcome.kind,
      ),
  );
  const hasMeetingIntent =
    inbound?.intent_class === "meeting_intent" ||
    inbound?.intent_class === "positive";
  const calendar = input.calendar ?? null;
  const calendarConsented = calendar?.consented === true;
  const suggested_times = calendarConsented
    ? [...(calendar.suggested_times ?? [])].slice(0, 3)
    : [];
  const next_action = blocked
    ? "do_not_follow_up"
    : suggested_times.length > 0
      ? "prepare_meeting"
      : hasPositive || hasMeetingIntent
        ? "ask_for_times"
        : "wait_for_reply";

  return {
    conversation_id: input.conversation.id,
    generated_at: new Date().toISOString(),
    status: blocked ? "blocked" : "ready",
    next_action,
    summary: prepSummary(input, inbound, latestOutcome, blocked, turns),
    thread_summary: threadSummary(input, turns),
    thread_turns: turns,
    agenda: blocked ? [] : agendaItems(input, inbound, outbound, turns),
    suggested_questions: blocked ? [] : suggestedQuestions(input, turns),
    suggested_times,
    availability_status: calendarConsented ? "included" : "omitted_no_consent",
    availability_reason: availabilityReason(input),
    calendar_provider: input.calendar?.provider ?? null,
    calendar_account_id: input.calendar?.channel_account_id ?? null,
    calendar_account_display_name: input.calendar?.account_display_name ?? null,
    profile_context: profileContext(input),
    source_refs: sourceRefs(input, turns, latestOutcome),
  };
}

function shouldBlockFollowUp(
  input: MeetingPrepInput,
  inbound: MeetingPrepMessageInput | null,
): boolean {
  return (
    inbound?.intent_class === "unsubscribe" ||
    inbound?.intent_class === "do_not_contact" ||
    input.outcomes.some((outcome) =>
      outcome.kind === "unsubscribe" || outcome.kind === "do_not_contact"
    )
  );
}

function prepSummary(
  input: MeetingPrepInput,
  inbound: MeetingPrepMessageInput | null,
  latestOutcome: MeetingPrepOutcomeInput | null,
  blocked: boolean,
  turns: MeetingPrepThreadTurn[],
): string {
  const person = input.conversation.counterparty_name ?? "the prospect";
  const title = input.conversation.counterparty_title
    ? ` (${input.conversation.counterparty_title})`
    : "";
  const company = input.conversation.company_name ?? "their company";
  if (blocked) {
    return `${person} at ${company} asked not to continue. Do not prepare follow-up.`;
  }
  const signal = input.conversation.signal_title
    ? ` The original Signal was ${input.conversation.signal_title}.`
    : "";
  const outcome = latestOutcome
    ? ` Latest Outcome: ${latestOutcome.kind.replace(/_/g, " ")}.`
    : "";
  const thread = turns.length > 1 ? ` Thread context: ${turns.length} messages captured.` : "";
  const reply = inbound?.body ? ` Latest reply: ${excerpt(inbound.body, 180)}` : "";
  return `${person}${title} at ${company} is ready for a focused follow-up.${signal}${outcome}${thread}${reply}`;
}

function threadSummary(
  input: MeetingPrepInput,
  turns: MeetingPrepThreadTurn[],
): string {
  if (turns.length === 0) return "No message thread has been captured yet.";
  const inboundCount = turns.filter((turn) => turn.direction === "inbound").length;
  const outboundCount = turns.filter((turn) => turn.direction === "outbound").length;
  const latestInbound = [...turns].reverse().find((turn) => turn.direction === "inbound");
  const latestOutbound = [...turns].reverse().find((turn) => turn.direction === "outbound");
  const anchor =
    input.conversation.signal_title ??
    input.conversation.topic ??
    "the conversation topic";
  const latest = latestInbound
    ? ` Latest inbound: ${latestInbound.excerpt}`
    : latestOutbound
      ? ` Latest outbound: ${latestOutbound.excerpt}`
      : "";
  const prior = latestInbound && latestOutbound
    ? ` Prior outbound: ${latestOutbound.excerpt}`
    : "";
  return `Thread has ${turns.length} messages (${inboundCount} inbound, ${outboundCount} outbound) around ${anchor}.${latest}${prior}`;
}

function agendaItems(
  input: MeetingPrepInput,
  inbound: MeetingPrepMessageInput | null,
  outbound: MeetingPrepMessageInput | null,
  turns: MeetingPrepThreadTurn[],
): string[] {
  return [
    input.conversation.signal_title
      ? `Open with the Signal: ${input.conversation.signal_title}`
      : input.conversation.topic
        ? `Anchor on the thread topic: ${input.conversation.topic}`
        : "Anchor on the prospect's latest reply.",
    input.conversation.counterparty_title
      ? `Use the prospect profile: ${input.conversation.counterparty_title}`
      : null,
    input.conversation.company_description
      ? `Ground the business context: ${excerpt(input.conversation.company_description, 120)}`
      : null,
    turns.length > 1 ? `Recap the thread before pitching: ${threadSummary(input, turns)}` : null,
    inbound?.body ? `Confirm what they asked for: ${excerpt(inbound.body, 140)}` : null,
    outbound?.body ? "Reference the specific claim or offer from the prior outbound." : null,
    "End with one clear next step and owner.",
  ].filter((item): item is string => Boolean(item));
}

function suggestedQuestions(
  input: MeetingPrepInput,
  turns: MeetingPrepThreadTurn[],
): string[] {
  const company = input.conversation.company_name ?? "your team";
  const threadText = turns.map((turn) => turn.excerpt).join(" ");
  return [
    input.conversation.signal_kind
      ? `What changed around ${input.conversation.signal_kind.replace(/_/g, " ")} that made this timely?`
      : "What made this relevant right now?",
    input.conversation.counterparty_title
      ? `How does this priority show up for a ${input.conversation.counterparty_title}?`
      : null,
    input.conversation.company_industry
      ? `What matters most for teams in ${input.conversation.company_industry}?`
      : null,
    `What does a good next step look like for ${company}?`,
    threadText && /security|legal|procure|budget/i.test(threadText)
      ? "Who needs to be involved before this can move forward?"
      : "What would make this worth continuing after the first call?",
  ].filter((item): item is string => Boolean(item));
}

function availabilityReason(input: MeetingPrepInput): string {
  if (input.calendar?.reason) return input.calendar.reason;
  return input.calendar?.consented ? "calendar_included" : "no_calendar_consent";
}

function profileContext(input: MeetingPrepInput): MeetingPrepProfileContext {
  return {
    user: {
      user_id: input.user?.user_id ?? null,
      name: input.user?.name ?? null,
      email: input.user?.email ?? null,
      role: input.user?.role ?? null,
    },
    prospect: {
      person_id: input.conversation.counterparty_person_id ?? null,
      name: input.conversation.counterparty_name ?? null,
      title: input.conversation.counterparty_title ?? null,
      linkedin_url: input.conversation.counterparty_linkedin_url ?? null,
    },
    company: {
      company_id: input.conversation.company_id ?? null,
      name: input.conversation.company_name ?? null,
      domain: input.conversation.company_domain ?? null,
      industry: input.conversation.company_industry ?? null,
      description: input.conversation.company_description ?? null,
    },
    rep: {
      rep_id: input.conversation.rep_id ?? null,
      name: input.conversation.rep_name ?? null,
      role: input.conversation.rep_role ?? null,
    },
  };
}

function sourceRefs(
  input: MeetingPrepInput,
  turns: MeetingPrepThreadTurn[],
  latestOutcome: MeetingPrepOutcomeInput | null,
): MeetingPrepSourceRef[] {
  const refs: MeetingPrepSourceRef[] = [{
    type: "conversation",
    id: input.conversation.id,
    label: "Conversation",
  }];
  for (const turn of turns) {
    refs.push({
      type: "message",
      id: turn.message_id,
      label: turn.direction === "inbound"
        ? "Thread inbound reply"
        : turn.direction === "outbound"
          ? "Thread outbound message"
          : "Thread message",
    });
  }
  if (input.conversation.signal_id) {
    refs.push({
      type: "signal",
      id: input.conversation.signal_id,
      label: input.conversation.signal_title ?? "Origin Signal",
      url: sourceUrl(input.conversation.signal_url),
    });
  }
  if (input.conversation.counterparty_person_id) {
    refs.push({
      type: "person",
      id: input.conversation.counterparty_person_id,
      label: input.conversation.counterparty_name ?? "Prospect profile",
      url: sourceUrl(input.conversation.counterparty_linkedin_url),
    });
  }
  if (input.conversation.company_id) {
    refs.push({
      type: "company",
      id: input.conversation.company_id,
      label: input.conversation.company_name ?? "Company profile",
    });
  }
  if (input.conversation.rep_id) {
    refs.push({
      type: "rep",
      id: input.conversation.rep_id,
      label: input.conversation.rep_name ?? "Rep profile",
    });
  }
  if (input.user?.user_id) {
    refs.push({
      type: "user",
      id: input.user.user_id,
      label: input.user.name ?? input.user.email ?? "User profile",
    });
  }
  if (latestOutcome) {
    refs.push({
      type: "outcome",
      id: latestOutcome.id,
      label: latestOutcome.kind.replace(/_/g, " "),
    });
  }
  return dedupeSourceRefs(refs);
}

function latestMessage(
  messages: MeetingPrepMessageInput[],
  direction: string,
): MeetingPrepMessageInput | null {
  return messages
    .filter((message) => message.direction === direction)
    .sort((a, b) => timeMs(a.created_at) - timeMs(b.created_at))
    .at(-1) ?? null;
}

function timeMs(value: string | Date | null | undefined): number {
  return value ? new Date(value).getTime() : 0;
}

function threadTurns(messages: MeetingPrepMessageInput[]): MeetingPrepThreadTurn[] {
  return [...messages]
    .sort((a, b) => timeMs(a.created_at) - timeMs(b.created_at))
    .filter((message) => message.body || message.subject)
    .slice(-8)
    .map((message) => ({
      message_id: message.id,
      direction: message.direction,
      at: isoOrNull(message.created_at),
      intent_class: message.intent_class ?? null,
      excerpt: excerpt(message.body ?? message.subject ?? "", 180),
    }));
}

function isoOrNull(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function excerpt(value: string, max: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function dedupeSourceRefs(refs: MeetingPrepSourceRef[]): MeetingPrepSourceRef[] {
  const seen = new Set<string>();
  const out: MeetingPrepSourceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.type}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

function sourceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

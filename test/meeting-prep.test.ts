import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import {
  runMeetingPrepGraphInWorkflowStep,
  type BombsellLangGraphState,
  type MeetingPrepDecision,
  type MeetingPrepGraphInput,
} from "../core/agents/langgraph/index.ts";
import {
  _resetToolRegistry,
  registerTool,
} from "../core/agents/tools/registry.ts";
import { suggestOutlookMeetingTimes } from "../core/channels/email/index.ts";
import { buildMeetingPrepNote } from "../core/meetings/prep.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";
import { defineWorkflow } from "../core/substrate/workflows/define.ts";
import { createInProcessWorkflowRuntime } from "../core/substrate/workflows/index.ts";

async function until<T>(
  predicate: () => T | Promise<T> | undefined | null | false,
  { timeout = 2000, interval = 5 }: { timeout?: number; interval?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (true) {
    const value = await predicate();
    if (value) return value as T;
    if (Date.now() > deadline) throw new Error("until: timeout");
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

test("meeting prep: positive reply creates a source-referenced prep note", () => {
  const conversation_id = randomUUID();
  const person_id = randomUUID();
  const company_id = randomUUID();
  const rep_id = randomUUID();
  const signal_id = randomUUID();
  const outbound_id = randomUUID();
  const inbound_id = randomUUID();
  const outcome_id = randomUUID();
  const user_id = randomUUID();
  const note = buildMeetingPrepNote({
    conversation: {
      id: conversation_id,
      counterparty_person_id: person_id,
      counterparty_name: "Maya",
      counterparty_title: "VP Sales",
      counterparty_linkedin_url: "https://linkedin.com/in/maya",
      company_id,
      company_name: "Acme",
      company_domain: "acme.example",
      company_industry: "B2B SaaS",
      company_description: "Acme sells workflow tools to enterprise revenue teams.",
      rep_id,
      rep_name: "Outbound agent",
      rep_role: "sdr",
      signal_id,
      signal_title: "Acme is hiring enterprise SDRs",
      signal_kind: "hiring",
      signal_url: "https://example.com/signal",
    },
    user: {
      user_id,
      name: "Ari Founder",
      email: "ari@bombsell.ai",
      role: "owner",
    },
    messages: [
      {
        id: outbound_id,
        direction: "outbound",
        body: "Acme's enterprise SDR hiring suggests pipeline generation is changing.",
        created_at: "2026-06-15T09:00:00.000Z",
      },
      {
        id: inbound_id,
        direction: "inbound",
        body: "This is interesting. Could you send times for next week? Security will want to join.",
        intent_class: "positive",
        created_at: "2026-06-15T10:00:00.000Z",
      },
    ],
    outcomes: [{
      id: outcome_id,
      kind: "positive_reply",
      occurred_at: "2026-06-15T10:01:00.000Z",
    }],
  });

  assert.equal(note.status, "ready");
  assert.equal(note.next_action, "ask_for_times");
  assert.equal(note.availability_status, "omitted_no_consent");
  assert.equal(note.availability_reason, "no_calendar_consent");
  assert.deepEqual(note.suggested_times, []);
  assert.match(note.summary, /Acme is hiring enterprise SDRs/);
  assert.match(note.summary, /VP Sales/);
  assert.match(note.summary, /2 messages captured/);
  assert.match(note.thread_summary, /2 messages/);
  assert.match(note.thread_summary, /Security will want to join/);
  assert.equal(note.thread_turns.length, 2);
  assert.equal(note.thread_turns[0]?.message_id, outbound_id);
  assert.equal(note.thread_turns[1]?.message_id, inbound_id);
  assert.equal(note.profile_context.user.user_id, user_id);
  assert.equal(note.profile_context.user.role, "owner");
  assert.ok(note.agenda.some((item) => /Signal/.test(item)));
  assert.ok(note.agenda.some((item) => /Recap the thread/.test(item)));
  assert.ok(note.suggested_questions.some((item) => /Who needs to be involved/.test(item)));
  assert.equal(note.profile_context.prospect.person_id, person_id);
  assert.equal(note.profile_context.prospect.title, "VP Sales");
  assert.equal(note.profile_context.company.industry, "B2B SaaS");
  assert.equal(note.profile_context.rep.role, "sdr");
  assert.ok(note.source_refs.some((ref) => ref.type === "signal" && ref.id === signal_id));
  assert.ok(note.source_refs.some((ref) => ref.type === "message" && ref.id === inbound_id));
  assert.ok(note.source_refs.some((ref) => ref.type === "message" && ref.id === outbound_id));
  assert.ok(note.source_refs.some((ref) => ref.type === "outcome" && ref.id === outcome_id));
  assert.ok(note.source_refs.some((ref) => ref.type === "person" && ref.id === person_id));
  assert.ok(note.source_refs.some((ref) => ref.type === "company" && ref.id === company_id));
  assert.ok(note.source_refs.some((ref) => ref.type === "rep" && ref.id === rep_id));
  assert.ok(note.source_refs.some((ref) => ref.type === "user" && ref.id === user_id));
});

test("meeting prep: calendar consent includes suggested times", () => {
  const channel_account_id = randomUUID();
  const note = buildMeetingPrepNote({
    conversation: {
      id: randomUUID(),
      counterparty_name: "Maya",
      company_name: "Acme",
    },
    messages: [{
      id: randomUUID(),
      direction: "inbound",
      body: "Happy to talk. Please send times.",
      intent_class: "meeting_intent",
    }],
    outcomes: [{ id: randomUUID(), kind: "positive_reply" }],
    calendar: {
      consented: true,
      provider: "outlook",
      channel_account_id,
      account_display_name: "founder@example.com",
      suggested_times: ["2026-06-16T15:00:00.000Z"],
      reason: "calendar_included",
    },
  });

  assert.equal(note.availability_status, "included");
  assert.equal(note.availability_reason, "calendar_included");
  assert.equal(note.calendar_provider, "outlook");
  assert.equal(note.calendar_account_id, channel_account_id);
  assert.equal(note.calendar_account_display_name, "founder@example.com");
  assert.equal(note.next_action, "prepare_meeting");
  assert.deepEqual(note.suggested_times, ["2026-06-16T15:00:00.000Z"]);
});

test("meeting prep: Outlook free-busy suggestions prefer business-hour free slots", () => {
  const suggestions = suggestOutlookMeetingTimes({
    start: "2026-06-15T08:00:00.000Z",
    availabilityView: "110001",
    intervalMinutes: 30,
    maxSuggestions: 2,
  });

  assert.deepEqual(suggestions, [
    "2026-06-15T09:00:00.000Z",
    "2026-06-15T09:30:00.000Z",
  ]);
});

test("meeting prep: unsubscribe blocks follow-up and omits agenda", () => {
  const note = buildMeetingPrepNote({
    conversation: {
      id: randomUUID(),
      counterparty_name: "Maya",
      company_name: "Acme",
    },
    messages: [{
      id: randomUUID(),
      direction: "inbound",
      body: "Please unsubscribe me.",
      intent_class: "unsubscribe",
    }],
    outcomes: [{ id: randomUUID(), kind: "unsubscribe" }],
  });

  assert.equal(note.status, "blocked");
  assert.equal(note.next_action, "do_not_follow_up");
  assert.deepEqual(note.agenda, []);
  assert.deepEqual(note.suggested_questions, []);
  assert.match(note.summary, /Do not prepare follow-up/);
});

test("meeting prep graph: generates prep without sending outreach", async () => {
  _resetToolRegistry();
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  const workspace_id = randomUUID();
  const user_id = randomUUID();
  const conversation_id = randomUUID();
  const meeting_prep_id = randomUUID();
  const toolCalls: string[] = [];

  registerTool({
    name: "product.meeting.prep.generate",
    description: "Generate meeting prep.",
    kind: "write",
    input: z.object({
      conversation_id: z.string().uuid(),
    }),
    output: meetingPrepOutputSchema,
    async handler(input, ctx) {
      toolCalls.push("product.meeting.prep.generate");
      assert.equal(input.conversation_id, conversation_id);
      assert.equal(ctx.workspace_id, workspace_id);
      assert.equal(ctx.user_id, user_id);
      const result = {
        workspace_id,
        meeting_prep_id,
        conversation_id,
        generated_at: new Date().toISOString(),
        status: "ready" as const,
        next_action: "ask_for_times" as const,
        summary: "Maya at Acme is ready for a focused follow-up.",
        thread_summary: "Thread has 1 messages (1 inbound, 0 outbound) around the conversation topic.",
        thread_turns: [{
          message_id: randomUUID(),
          direction: "inbound",
          at: "2026-06-15T10:00:00.000Z",
          intent_class: "meeting_intent",
          excerpt: "Please send times.",
        }],
        agenda: ["Open with the Signal"],
        suggested_questions: ["What changed now?"],
        suggested_times: [],
        availability_status: "omitted_no_consent" as const,
        availability_reason: "no_calendar_consent",
        calendar_provider: null,
        calendar_account_id: null,
        calendar_account_display_name: null,
        profile_context: {
          user: {
            user_id,
            name: null,
            email: null,
            role: null,
          },
          prospect: {
            person_id: null,
            name: "Maya",
            title: null,
            linkedin_url: null,
          },
          company: {
            company_id: null,
            name: "Acme",
            domain: null,
            industry: null,
            description: null,
          },
          rep: {
            rep_id: null,
            name: null,
            role: null,
          },
        },
        source_refs: [{
          type: "conversation" as const,
          id: conversation_id,
          label: "Conversation",
        }],
      };
      await bus.publish({
        workspace_id,
        event_type: "meeting.prep.generated",
        source: "system",
        producer_ref: "test:meeting-prep",
        correlation_id: ctx.correlation_id,
        causation_id: ctx.causation_id,
        payload: {
          meeting_prep_id,
          conversation_id,
          generated_at: result.generated_at,
          status: result.status,
          next_action: result.next_action,
          summary: result.summary,
          thread_summary: result.thread_summary,
          thread_turns: result.thread_turns,
          agenda: result.agenda,
          suggested_questions: result.suggested_questions,
          suggested_times: result.suggested_times,
          availability_status: result.availability_status,
          availability_reason: result.availability_reason,
          calendar_provider: result.calendar_provider,
          calendar_account_id: result.calendar_account_id,
          calendar_account_display_name: result.calendar_account_display_name,
          profile_context: result.profile_context,
          source_refs: result.source_refs,
        },
      });
      return result;
    },
  });

  runtime.register(
    defineWorkflow<MeetingPrepGraphInput, BombsellLangGraphState>({
      name: "meeting_prep_graph_test",
      version: "1",
      async run(input, ctx) {
        return runMeetingPrepGraphInWorkflowStep({
          ctx,
          input,
          bus,
        });
      },
    }),
  );

  const run = await runtime.start({
    workspace_id,
    workflow_name: "meeting_prep_graph_test",
    input: {
      workspace_id,
      user_id,
      conversation_id,
    },
  });

  await until(async () => (await runtime.get(run.id))?.status === "completed");
  const final = await runtime.get<MeetingPrepGraphInput, BombsellLangGraphState>(run.id);
  const output = final?.output;
  assert.ok(output, "expected graph output");
  const decision = output.attributes?.meeting_prep as MeetingPrepDecision;
  assert.equal(decision.meeting_prep_id, meeting_prep_id);
  assert.equal(decision.next_action, "ask_for_times");
  assert.equal(decision.availability_status, "omitted_no_consent");
  assert.equal(decision.availability_reason, "no_calendar_consent");
  assert.equal(decision.thread_turn_count, 1);
  assert.deepEqual(toolCalls, ["product.meeting.prep.generate"]);
  assert.equal(
    bus.published.some((event) => event.event_type === "meeting.prep.generated"),
    true,
  );
  assert.equal(
    bus.published.some((event) =>
      ["message.queued", "message.sent", "message.deferred"].includes(event.event_type)
    ),
    false,
    "meeting prep must not enqueue or send outreach",
  );

  const spanKinds = new Set(
    bus.published
      .filter((event) => event.event_type === "agent.trace.span.recorded")
      .map((event) => event.payload.kind),
  );
  assert.equal(spanKinds.has("agent.run"), true);
  assert.equal(spanKinds.has("langgraph.node"), true);
  assert.equal(spanKinds.has("tool.call"), true);
});

const sourceRefSchema = z.object({
  type: z.enum(["conversation", "message", "signal", "outcome", "person", "company", "rep", "user"]),
  id: z.string(),
  label: z.string(),
  url: z.string().url().nullable().optional(),
});

const meetingPrepProfileContextSchema = z.object({
  user: z.object({
    user_id: z.string().uuid().nullable(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    role: z.string().nullable(),
  }),
  prospect: z.object({
    person_id: z.string().uuid().nullable(),
    name: z.string().nullable(),
    title: z.string().nullable(),
    linkedin_url: z.string().nullable(),
  }),
  company: z.object({
    company_id: z.string().uuid().nullable(),
    name: z.string().nullable(),
    domain: z.string().nullable(),
    industry: z.string().nullable(),
    description: z.string().nullable(),
  }),
  rep: z.object({
    rep_id: z.string().uuid().nullable(),
    name: z.string().nullable(),
    role: z.string().nullable(),
  }),
});

const meetingPrepOutputSchema = z.object({
  workspace_id: z.string().uuid(),
  meeting_prep_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  generated_at: z.string().datetime(),
  status: z.enum(["ready", "blocked"]),
  next_action: z.enum([
    "prepare_meeting",
    "ask_for_times",
    "wait_for_reply",
    "do_not_follow_up",
  ]),
  summary: z.string(),
  thread_summary: z.string(),
  thread_turns: z.array(z.object({
    message_id: z.string().uuid(),
    direction: z.string(),
    at: z.string().datetime().nullable(),
    intent_class: z.string().nullable(),
    excerpt: z.string(),
  })),
  agenda: z.array(z.string()),
  suggested_questions: z.array(z.string()),
  suggested_times: z.array(z.string()),
  availability_status: z.enum(["included", "omitted_no_consent"]),
  availability_reason: z.string(),
  calendar_provider: z.string().nullable(),
  calendar_account_id: z.string().uuid().nullable(),
  calendar_account_display_name: z.string().nullable(),
  profile_context: meetingPrepProfileContextSchema,
  source_refs: z.array(sourceRefSchema),
});

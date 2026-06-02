import { randomUUID } from "node:crypto";
import { evalGate } from "../agents/eval/gate.ts";
import type { Judge } from "../agents/eval/types.ts";
import type { LLMClient } from "../agents/llm/types.ts";
import type { RepMemory } from "../agents/memory/types.ts";
import {
  createReplyDraftRole,
  createSenderRole,
  type SignalEmailSenderRequest,
} from "../agents/reps/index.ts";
import { composeRep } from "../agents/reps/compose.ts";
import type {
  ReplyDraftBrief,
  ReplyDraftResult,
} from "../agents/reps/roles/replier.ts";
import type { RoleAgent, RoleAgentContext } from "../agents/reps/types.ts";
import type { EmailChannel } from "../channels/email/index.ts";
import type { EventBus } from "../substrate/events/index.ts";
import { defineWorkflow, type RunContext } from "../substrate/workflows/index.ts";
import type { VerticalSliceStore } from "./vertical-store.ts";

export const REPLY_TO_EMAIL_PLAY_WORKFLOW = "play.reply_to_email.v1";

export interface ReplyToEmailPlayInput {
  workspace_id: string;
  play_id?: string | null;
  play_run_id: string;
  rep_id: string;
  conversation_id: string;
  inbound_message_id: string;
  trigger_event_id?: string | null;
  reply_approval?: "none" | "always" | "research_only";
}

export interface ReplyToEmailPlayOutput {
  decision: "sent" | "deferred" | "rejected";
  conversation_id: string;
  inbound_message_id: string;
  message_id?: string;
  intent: string;
  pattern_key?: string;
  eval_score?: number;
}

export interface ReplyToEmailPlayDeps {
  store: VerticalSliceStore;
  memory: RepMemory;
  judge: Judge;
  writerLlm?: LLMClient;
  email: EmailChannel;
  bus: EventBus;
  workspaceContextProvider?: (
    input: ReplyToEmailPlayInput,
  ) => Promise<string | null | undefined>;
}

function outputPayload(output: ReplyToEmailPlayOutput): Record<string, unknown> {
  return output as unknown as Record<string, unknown>;
}

async function publishDeferred(
  ctx: RunContext,
  message_id: string,
  defer_reason: string,
): Promise<void> {
  await ctx.publish("message.deferred", {
    message_id,
    channel: "email",
    defer_reason,
    retry_after: null,
  });
}

export function createReplyToEmailPlayWorkflow(deps: ReplyToEmailPlayDeps) {
  const replier = createReplyDraftRole({ llm: deps.writerLlm });
  const sender = createSenderRole();

  return defineWorkflow<ReplyToEmailPlayInput, ReplyToEmailPlayOutput>({
    name: REPLY_TO_EMAIL_PLAY_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      const conversation = await deps.store.getConversation(input.conversation_id);
      if (!conversation) throw new Error(`Conversation not found: ${input.conversation_id}`);
      const inbound = await deps.store.getMessage(input.inbound_message_id);
      if (!inbound) throw new Error(`Inbound message not found: ${input.inbound_message_id}`);
      if (inbound.direction !== "inbound") {
        throw new Error(`Message is not inbound: ${input.inbound_message_id}`);
      }
      const intent = inbound.intent_class ?? "unknown";
      if (intent !== "positive" && intent !== "neutral") {
        return {
          decision: "deferred",
          conversation_id: conversation.id,
          inbound_message_id: inbound.id,
          intent,
        };
      }
      const rep = await deps.store.getRep(input.rep_id);
      if (!rep) throw new Error(`Rep not found: ${input.rep_id}`);
      const person = await deps.store.getPerson(conversation.counterparty_person_id);
      if (!person) throw new Error(`Person not found: ${conversation.counterparty_person_id}`);
      const company = await deps.store.getCompany(conversation.counterparty_company_id);
      const priorOutboundId =
        typeof inbound.provenance.matched_outbound_message_id === "string"
          ? inbound.provenance.matched_outbound_message_id
          : null;
      const priorOutbound = priorOutboundId
        ? await deps.store.getMessage(priorOutboundId)
        : null;
      const workspaceContextMarkdown = deps.workspaceContextProvider
        ? await ctx.step("context.workspace_agent", () =>
            deps.workspaceContextProvider!(input),
          )
        : null;

      await ctx.step("play.run.start_event", async () => {
        await ctx.publish("play.run.started", {
          play_id: input.play_id ?? input.play_run_id,
          play_run_id: input.play_run_id,
          workflow_run_id: ctx.run_id,
          trigger_event_id: input.trigger_event_id ?? null,
        });
        return true;
      });

      const composedRep = composeRep(rep, { replier, sender });
      const roleContext: RoleAgentContext = {
        rep,
        tool_context: {
          workspace_id: input.workspace_id,
          rep_id: rep.id,
        },
        memory: deps.memory,
        judge: deps.judge,
        workspace_context_markdown: workspaceContextMarkdown ?? null,
      };
      const replierRole = composedRep.role("replier") as RoleAgent<
        ReplyDraftBrief,
        ReplyDraftResult
      >;

      const draft = await ctx.step("replier.compose_email", async () => {
        const result = await replierRole.invoke(
          {
            conversation: {
              id: conversation.id,
              topic: conversation.topic,
            },
            inbound: {
              message_id: inbound.id,
              subject: inbound.subject,
              body_text: inbound.body ?? "",
              from_email: typeof inbound.provenance.from_email === "string"
                ? inbound.provenance.from_email
                : null,
              intent: intent as "positive" | "neutral",
              intent_reason:
                typeof inbound.eval_notes?.intent_reason === "string"
                  ? inbound.eval_notes.intent_reason
                  : null,
            },
            counterparty: {
              name: person.full_name,
              person_id: person.id,
              given_name: person.given_name,
              title: person.title,
              company_id: company?.id ?? null,
              company_name: company?.name ?? null,
            },
            prior_outbound: priorOutbound
              ? {
                  subject: priorOutbound.subject,
                  body_text: priorOutbound.body,
                }
              : null,
          },
          roleContext,
        );
        await ctx.publish("rep.role.completed", {
          rep_id: rep.id,
          role: "replier",
          action: "draft_email_reply",
          conversation_id: conversation.id,
          message_id: inbound.id,
          play_id: input.play_id ?? null,
          play_run_id: input.play_run_id,
          workflow_run_id: ctx.run_id,
          summary: result.subject,
          output: {
            intent,
            inbound_message_id: inbound.id,
            pattern_key: result.pattern_key,
            exemplar_ids: result.exemplar_ids,
            procedural_exemplar_count: result.procedural_exemplars.length,
            semantic_subjects: result.semantic_subjects,
            semantic_memory_count: result.semantic_memory.length,
          },
          completed_at: new Date().toISOString(),
        });
        return result;
      });

      const message = await ctx.step("message.draft", async () => {
        const event = await ctx.publish("draft.proposed", {
          conversation_id: conversation.id,
          message_id: randomUUID(),
          channel: "email",
          rep_id: rep.id,
          subject: draft.subject,
          body: draft.body,
          provenance: {
            play_id: input.play_id ?? null,
            play_run_id: input.play_run_id,
            inbound_message_id: inbound.id,
            intent,
            pattern_key: draft.pattern_key,
            exemplar_ids: draft.exemplar_ids,
            semantic_subjects: draft.semantic_subjects,
          },
          properties: {
            reply_to_message_id: inbound.id,
          },
        });
        const row = await deps.store.projectMessageLifecycleEvent(event);
        if (!row) throw new Error(`Reply draft projection failed: ${event.payload.message_id}`);
        return row;
      });

      const gate = await ctx.step("eval.hot_path", () =>
        evalGate(
          { judge: deps.judge, bus: deps.bus },
          {
            workspace_id: input.workspace_id,
            rep,
            message_id: message.id,
            artifact: {
              kind: "draft",
              channel: "email",
              subject: draft.subject,
              body: draft.body,
            },
            context: {
              signal_summary: [
                conversation.topic ?? "Inbound email reply",
                `Inbound intent: ${intent}.`,
                inbound.body ? `Inbound reply: ${inbound.body}` : null,
              ].filter(Boolean).join("\n"),
              counterparty_summary: `${person.full_name}${company ? ` at ${company.name}` : ""}`,
              procedural_exemplars: draft.procedural_exemplars,
              semantic_memory: draft.semantic_memory,
              workspace_context_markdown: workspaceContextMarkdown ?? null,
            },
          },
        ),
      );

      if (gate.decision === "reject") {
        await publishDeferred(ctx, message.id, gate.rejection_reason ?? "eval_rejected");
        const output: ReplyToEmailPlayOutput = {
          decision: "rejected",
          conversation_id: conversation.id,
          inbound_message_id: inbound.id,
          message_id: message.id,
          intent,
          pattern_key: draft.pattern_key,
          eval_score: gate.verdict.score,
        };
        await ctx.publish("play.run.completed", {
          play_id: input.play_id ?? input.play_run_id,
          play_run_id: input.play_run_id,
          workflow_run_id: ctx.run_id,
          output: outputPayload(output),
        });
        return output;
      }

      if ((input.reply_approval ?? "always") === "research_only") {
        await publishDeferred(ctx, message.id, "reply_research_only");
        const output: ReplyToEmailPlayOutput = {
          decision: "deferred",
          conversation_id: conversation.id,
          inbound_message_id: inbound.id,
          message_id: message.id,
          intent,
          pattern_key: draft.pattern_key,
          eval_score: gate.verdict.score,
        };
        await ctx.publish("play.run.completed", {
          play_id: input.play_id ?? input.play_run_id,
          play_run_id: input.play_run_id,
          workflow_run_id: ctx.run_id,
          output: outputPayload(output),
        });
        return output;
      }

      let sendDraft = {
        subject: draft.subject,
        body: draft.body,
        eval_score: gate.verdict.score,
      };
      if ((input.reply_approval ?? "always") === "always") {
        const decision = await ctx.requestApproval({
          kind: "inbound.email.reply",
          reason: `${rep.name} drafted a reply to ${person.full_name}`,
          payload: {
            conversation_id: conversation.id,
            inbound_message_id: inbound.id,
            message_id: message.id,
            channel: "email",
            intent,
            pattern_key: draft.pattern_key,
            subject: draft.subject,
            body: draft.body,
            eval_score: gate.verdict.score,
          },
        });
        if (decision.decision !== "approved") {
          await publishDeferred(ctx, message.id, `approval_${decision.decision}`);
          const output: ReplyToEmailPlayOutput = {
            decision: "deferred",
            conversation_id: conversation.id,
            inbound_message_id: inbound.id,
            message_id: message.id,
            intent,
            pattern_key: draft.pattern_key,
            eval_score: gate.verdict.score,
          };
          await ctx.publish("play.run.completed", {
            play_id: input.play_id ?? input.play_run_id,
            play_run_id: input.play_run_id,
            workflow_run_id: ctx.run_id,
            output: outputPayload(output),
          });
          return output;
        }
        const override = parseApprovalDraftOverride(decision.note);
        if (override) {
          const edited = await ctx.step("approval.apply_draft_edits", async () => {
            if (!deps.store.updateDraftMessage) {
              throw new Error("Draft edits require a store that can update draft messages");
            }
            const row = await deps.store.updateDraftMessage(message.id, {
              subject: override.subject,
              body: override.body,
              properties: { human_edited: true },
            });
            await ctx.publish("draft.proposed", {
              conversation_id: conversation.id,
              message_id: row.id,
              channel: "email",
              rep_id: rep.id,
              subject: row.subject,
              body: row.body,
              provenance: row.provenance,
              properties: { ...row.properties, human_edited: true },
            });
            return row;
          });
          const editedGate = await ctx.step("eval.hot_path.approval_edit", () =>
            evalGate(
              { judge: deps.judge, bus: deps.bus },
              {
                workspace_id: input.workspace_id,
                rep,
                message_id: edited.id,
                artifact: {
                  kind: "draft",
                  channel: "email",
                  subject: edited.subject,
                  body: edited.body ?? "",
                },
                context: {
                  signal_summary: [
                    conversation.topic ?? "Inbound email reply",
                    `Inbound intent: ${intent}.`,
                    inbound.body ? `Inbound reply: ${inbound.body}` : null,
                  ].filter(Boolean).join("\n"),
                  counterparty_summary: `${person.full_name}${company ? ` at ${company.name}` : ""}`,
                  procedural_exemplars: draft.procedural_exemplars,
                  semantic_memory: draft.semantic_memory,
                  workspace_context_markdown: workspaceContextMarkdown ?? null,
                },
              },
            ),
          );
          if (editedGate.decision === "reject") {
            await publishDeferred(
              ctx,
              edited.id,
              editedGate.rejection_reason ?? "eval_rejected_after_edit",
            );
            const output: ReplyToEmailPlayOutput = {
              decision: "rejected",
              conversation_id: conversation.id,
              inbound_message_id: inbound.id,
              message_id: edited.id,
              intent,
              pattern_key: draft.pattern_key,
              eval_score: editedGate.verdict.score,
            };
            await ctx.publish("play.run.completed", {
              play_id: input.play_id ?? input.play_run_id,
              play_run_id: input.play_run_id,
              workflow_run_id: ctx.run_id,
              output: outputPayload(output),
            });
            return output;
          }
          sendDraft = {
            subject: edited.subject ?? "",
            body: edited.body ?? "",
            eval_score: editedGate.verdict.score,
          };
        }
      }

      const senderRole = composedRep.role("sender") as RoleAgent<
        SignalEmailSenderRequest,
        Awaited<ReturnType<EmailChannel["send"]>>
      >;
      const send = await ctx.step("sender.email", async () => {
        const result = await senderRole.invoke(
          {
            conversation: {
              id: conversation.id,
              workspace_id: input.workspace_id,
              rep_id: rep.id,
              counterparty_person_id: person.id,
              counterparty_email:
                typeof inbound.provenance.from_email === "string"
                  ? inbound.provenance.from_email
                  : person.emails[0] ?? null,
              topic: conversation.topic,
            },
            draft: {
              message_id: message.id,
              channel: "email",
              subject: sendDraft.subject,
              body: sendDraft.body,
              eval_passed: true,
              eval_score: sendDraft.eval_score,
            },
            email: deps.email,
            bus: deps.bus,
            correlation_id: ctx.correlation_id,
          },
          roleContext,
        );
        await ctx.publish("rep.role.completed", {
          rep_id: rep.id,
          role: "sender",
          action: "send_email_reply",
          conversation_id: conversation.id,
          message_id: message.id,
          play_id: input.play_id ?? null,
          play_run_id: input.play_run_id,
          workflow_run_id: ctx.run_id,
          summary: result.status,
          output: { status: result.status },
          completed_at: new Date().toISOString(),
        });
        return result;
      });

      const output: ReplyToEmailPlayOutput = {
        decision: send.status === "deferred" ? "deferred" : "sent",
        conversation_id: conversation.id,
        inbound_message_id: inbound.id,
        message_id: message.id,
        intent,
        pattern_key: draft.pattern_key,
        eval_score: sendDraft.eval_score,
      };
      await ctx.publish("play.run.completed", {
        play_id: input.play_id ?? input.play_run_id,
        play_run_id: input.play_run_id,
        workflow_run_id: ctx.run_id,
        output: outputPayload(output),
      });
      return output;
    },
  });
}

function parseApprovalDraftOverride(
  note: string | undefined,
): { subject: string | null; body: string } | null {
  if (!note) return null;
  try {
    const parsed = JSON.parse(note) as {
      type?: unknown;
      subject?: unknown;
      body?: unknown;
    };
    if (parsed.type !== "draft_override") return null;
    const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
    if (!body) return null;
    return {
      subject:
        typeof parsed.subject === "string" && parsed.subject.trim()
          ? parsed.subject.trim()
          : null,
      body,
    };
  } catch {
    return null;
  }
}

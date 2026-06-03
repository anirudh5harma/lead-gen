import { randomUUID } from "node:crypto";
import { defineWorkflow, type RunContext } from "../substrate/workflows/index.ts";
import type { EventBus } from "../substrate/events/index.ts";
import type { Judge } from "../agents/eval/types.ts";
import type { LLMClient } from "../agents/llm/types.ts";
import type { RepMemory } from "../agents/memory/types.ts";
import { evalGate } from "../agents/eval/gate.ts";
import {
  composeRep,
  createLinkedInSenderRole,
  createLinkedInWriterRole,
  createResearcherRole,
  type LinkedInSenderRequest,
  type SignalLinkedInWriterBrief,
  type SignalLinkedInWriterDraft,
} from "../agents/reps/index.ts";
import type { ResearchBrief, ResearchResult } from "../agents/reps/roles/researcher.ts";
import type { RoleAgent, RoleAgentContext } from "../agents/reps/types.ts";
import type { LinkedInChannel, LinkedInChannelName } from "../channels/linkedin/index.ts";
import type { VerticalSliceStore } from "./vertical-store.ts";
import { exaInfluenceFromSignal } from "./exa-influence.ts";
import {
  applyDraftGrounding,
  buildDraftGroundingQuery,
  draftGroundingProvenance,
  shouldGroundDraftWithExa,
  type DraftGroundingProvider,
} from "./exa-draft-grounding.ts";
import {
  isDailyCapExceeded,
  nextDailyWindow,
  shouldRequestApproval,
  type PlayChannelPolicy,
} from "./autonomy.ts";

export const SIGNAL_TO_LINKEDIN_PLAY_WORKFLOW = "play.signal_to_linkedin.v1";

export interface SignalToLinkedInPlayInput {
  workspace_id: string;
  play_id: string;
  play_run_id: string;
  rep_id: string;
  signal_id: string;
  person_id: string;
  company_id?: string | null;
  trigger_event_id?: string | null;
  action?: LinkedInChannelName;
  linkedin_approval?: "none" | "approve_first" | "always" | "research_only";
  play_channel_policy?: PlayChannelPolicy | null;
  simulate_outcome_kind?: "positive_reply" | "meeting_booked" | null;
}

export interface SignalToLinkedInPlayOutput {
  decision: "sent" | "deferred" | "rejected";
  conversation_id: string;
  message_id: string;
  outcome_id?: string;
  eval_score: number;
  pattern_key: string;
  channel: LinkedInChannelName;
}

export interface SignalToLinkedInPlayDeps {
  store: VerticalSliceStore;
  memory: RepMemory;
  judge: Judge;
  writerLlm?: LLMClient;
  linkedin: LinkedInChannel;
  bus: EventBus;
  workspaceContextProvider?: (
    input: SignalToLinkedInPlayInput,
  ) => Promise<string | null | undefined>;
  draftGroundingProvider?: DraftGroundingProvider;
}

function playRunOutputPayload(output: SignalToLinkedInPlayOutput): Record<string, unknown> {
  return output as unknown as Record<string, unknown>;
}

async function publishPlayDeferred(
  ctx: RunContext,
  message_id: string,
  channel: LinkedInChannelName,
  defer_reason: string,
  retry_after: string | null,
): Promise<void> {
  await ctx.publish("message.deferred", {
    message_id,
    channel,
    defer_reason,
    retry_after,
  });
}

export function createSignalToLinkedInPlayWorkflow(deps: SignalToLinkedInPlayDeps) {
  const researcher = createResearcherRole();
  const writer = createLinkedInWriterRole({ llm: deps.writerLlm });
  const sender = createLinkedInSenderRole({ linkedin: deps.linkedin, bus: deps.bus });
  return defineWorkflow<SignalToLinkedInPlayInput, SignalToLinkedInPlayOutput>({
    name: SIGNAL_TO_LINKEDIN_PLAY_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      const action = input.action ?? (deps.linkedin.name as LinkedInChannelName);
      const rep = await deps.store.getRep(input.rep_id);
      if (!rep) throw new Error(`Rep not found: ${input.rep_id}`);
      const composedRep = composeRep(rep, { researcher, writer, sender });
      const signal = await deps.store.getSignal(input.signal_id);
      if (!signal) throw new Error(`Signal not found: ${input.signal_id}`);
      const exaInfluence = exaInfluenceFromSignal(signal);
      const person = await deps.store.getPerson(input.person_id);
      if (!person) throw new Error(`Person not found: ${input.person_id}`);
      const company = await deps.store.getCompany(input.company_id ?? signal.related_company_id);
      const workspaceContextMarkdown = deps.workspaceContextProvider
        ? await ctx.step("context.workspace_agent", () =>
            deps.workspaceContextProvider!(input),
          )
        : null;

      await ctx.step("play.run.start_event", async () => {
        await ctx.publish("play.run.started", {
          play_id: input.play_id,
          play_run_id: input.play_run_id,
          workflow_run_id: ctx.run_id,
          trigger_event_id: input.trigger_event_id ?? null,
        });
        return true;
      });

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

      const conversation = await ctx.step("conversation.open", async () => {
        const event = await ctx.publish("conversation.opened", {
          conversation_id: randomUUID(),
          rep_id: rep.id,
          counterparty_person_id: person.id,
          counterparty_company_id: company?.id ?? null,
          origin_signal_id: signal.id,
          topic: signal.title,
          properties: {
            play_id: input.play_id,
            play_run_id: input.play_run_id,
            channel: action,
          },
        });
        const row = await deps.store.projectConversationLifecycleEvent(event);
        if (!row) throw new Error(`Conversation projection failed: ${event.payload.conversation_id}`);
        return row;
      });

      const researchRole = composedRep.role("researcher") as RoleAgent<ResearchBrief, ResearchResult>;
      const writerRole = composedRep.role("writer") as RoleAgent<
        SignalLinkedInWriterBrief,
        SignalLinkedInWriterDraft
      >;
      const senderRole = composedRep.role("sender") as RoleAgent<
        LinkedInSenderRequest,
        Awaited<ReturnType<LinkedInChannel["send"]>>
      >;

      const research = await ctx.step("research.signal_context", async () => {
        const result = await researchRole.invoke({ signal, person, company }, roleContext);
        await ctx.publish("rep.role.completed", {
          rep_id: rep.id,
          role: "researcher",
          action: "signal_context",
          conversation_id: conversation.id,
          signal_id: signal.id,
          play_id: input.play_id,
          play_run_id: input.play_run_id,
          workflow_run_id: ctx.run_id,
          summary: result.signal_summary,
          output: {
            pattern_key: result.pattern_key,
            counterparty_summary: result.counterparty_summary,
          },
          completed_at: new Date().toISOString(),
        });
        return result;
      });
      const draftGrounding = deps.draftGroundingProvider &&
        shouldGroundDraftWithExa(signal, exaInfluence)
        ? await ctx.step("exa.draft_grounding", async () =>
            deps.draftGroundingProvider!({
              workspace_id: input.workspace_id,
              play_id: input.play_id,
              play_run_id: input.play_run_id,
              rep_id: rep.id,
              signal,
              person,
              company,
              channel: "linkedin",
              query: buildDraftGroundingQuery({
                workspace_id: input.workspace_id,
                play_id: input.play_id,
                play_run_id: input.play_run_id,
                rep_id: rep.id,
                signal,
                person,
                company,
                channel: "linkedin",
              }),
            }) ?? null)
        : null;
      const groundedResearch = applyDraftGrounding(research, draftGrounding);
      const patternKey = `${research.pattern_key}|channel:${action}`;

      const draft = await ctx.step("writer.compose_linkedin", async () => {
        const result = await writerRole.invoke({
          action,
          pattern_key: patternKey,
          research: groundedResearch,
          person,
          company,
        }, roleContext);
        await ctx.publish("rep.role.completed", {
          rep_id: rep.id,
          role: "writer",
          action: "compose_linkedin",
          conversation_id: conversation.id,
          signal_id: signal.id,
          play_id: input.play_id,
          play_run_id: input.play_run_id,
          workflow_run_id: ctx.run_id,
          summary: result.body.slice(0, 140),
          output: {
            channel: action,
            exemplar_ids: result.exemplar_ids,
            procedural_exemplar_count: result.procedural_exemplars.length,
          },
          completed_at: new Date().toISOString(),
        });
        return result;
      });

      const message = await ctx.step("message.draft", async () => {
        const event = await ctx.publish("draft.proposed", {
          conversation_id: conversation.id,
          message_id: randomUUID(),
          channel: action,
          rep_id: rep.id,
          subject: null,
          body: draft.body,
          provenance: {
            pattern_key: patternKey,
            exemplar_ids: draft.exemplar_ids,
            play_id: input.play_id,
            play_run_id: input.play_run_id,
            ...(exaInfluence ? { exa_influence: exaInfluence } : {}),
            ...(draftGrounding ? { exa_grounding: draftGroundingProvenance(draftGrounding) } : {}),
          },
        });
        const row = await deps.store.projectMessageLifecycleEvent(event);
        if (!row) throw new Error(`Draft projection failed: ${event.payload.message_id}`);
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
              channel: action,
              subject: null,
              body: draft.body,
            },
            context: {
              signal_summary: groundedResearch.signal_summary,
              counterparty_summary: research.counterparty_summary,
              procedural_exemplars: draft.procedural_exemplars,
              workspace_context_markdown: workspaceContextMarkdown ?? null,
            },
          },
        ),
      );

      if (gate.decision === "reject") {
        await publishPlayDeferred(
          ctx,
          message.id,
          action,
          gate.rejection_reason ?? "eval_rejected",
          null,
        );
        const output: SignalToLinkedInPlayOutput = {
          decision: "rejected",
          conversation_id: conversation.id,
          message_id: message.id,
          eval_score: gate.verdict.score,
          pattern_key: patternKey,
          channel: action,
        };
        await ctx.publish("play.run.completed", {
          play_id: input.play_id,
          play_run_id: input.play_run_id,
          workflow_run_id: ctx.run_id,
          output: playRunOutputPayload(output),
        });
        return output;
      }

      const policy = input.play_channel_policy ?? {
        channel: action,
        daily_cap: Number.MAX_SAFE_INTEGER,
        approval: input.linkedin_approval ?? "none",
      };
      if (policy.approval === "research_only") {
        const output: SignalToLinkedInPlayOutput = {
          decision: "deferred",
          conversation_id: conversation.id,
          message_id: message.id,
          eval_score: gate.verdict.score,
          pattern_key: patternKey,
          channel: action,
        };
        await publishPlayDeferred(ctx, message.id, action, "play_research_only", null);
        await ctx.publish("play.run.completed", {
          play_id: input.play_id,
          play_run_id: input.play_run_id,
          workflow_run_id: ctx.run_id,
          output: playRunOutputPayload(output),
        });
        return output;
      }

      const dailySendCount = await ctx.step("autonomy.play_linkedin_daily_count", async () =>
        deps.store.countPlayChannelMessages({
          workspace_id: input.workspace_id,
          play_id: input.play_id,
          channel: action,
          statuses: ["queued", "sent", "delivered", "replied", "bounced"],
          since: new Date(Date.now() - 24 * 60 * 60 * 1000),
        }),
      );
      if (isDailyCapExceeded(policy, dailySendCount)) {
        const output: SignalToLinkedInPlayOutput = {
          decision: "deferred",
          conversation_id: conversation.id,
          message_id: message.id,
          eval_score: gate.verdict.score,
          pattern_key: patternKey,
          channel: action,
        };
        await publishPlayDeferred(
          ctx,
          message.id,
          action,
          "play_channel_daily_cap",
          nextDailyWindow(),
        );
        await ctx.publish("play.run.completed", {
          play_id: input.play_id,
          play_run_id: input.play_run_id,
          workflow_run_id: ctx.run_id,
          output: playRunOutputPayload(output),
        });
        return output;
      }

      let sendDraft: { body: string; eval_score: number } = {
        body: draft.body,
        eval_score: gate.verdict.score,
      };
      const priorSendCount = await ctx.step("autonomy.play_linkedin_prior_count", async () =>
        deps.store.countPlayChannelMessages({
          workspace_id: input.workspace_id,
          play_id: input.play_id,
          channel: action,
          statuses: ["queued", "sent", "delivered", "replied", "bounced"],
          since: null,
        }),
      );
      if (shouldRequestApproval(policy, priorSendCount)) {
        const decision = await ctx.requestApproval({
          kind: "outbound.linkedin.send",
          reason: `${rep.name} wants to ${labelLinkedInAction(action)} ${person.full_name} about ${signal.title}`,
          payload: {
            conversation_id: conversation.id,
            message_id: message.id,
            channel: action,
            body: draft.body,
            eval_score: gate.verdict.score,
            policy: policy.approval,
            daily_cap: policy.daily_cap,
            sent_today: dailySendCount,
          },
        });
        if (decision.decision !== "approved") {
          const output: SignalToLinkedInPlayOutput = {
            decision: "deferred",
            conversation_id: conversation.id,
            message_id: message.id,
            eval_score: gate.verdict.score,
            pattern_key: patternKey,
            channel: action,
          };
          await publishPlayDeferred(
            ctx,
            message.id,
            action,
            `approval_${decision.decision}`,
            null,
          );
          await ctx.publish("play.run.completed", {
            play_id: input.play_id,
            play_run_id: input.play_run_id,
            workflow_run_id: ctx.run_id,
            output: playRunOutputPayload(output),
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
              subject: null,
              body: override.body,
              properties: { human_edited: true },
            });
            await ctx.publish("draft.proposed", {
              conversation_id: conversation.id,
              message_id: row.id,
              channel: action,
              rep_id: rep.id,
              subject: null,
              body: row.body,
              provenance: row.provenance,
              properties: { human_edited: true },
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
                  channel: action,
                  subject: null,
                  body: edited.body ?? "",
                },
                context: {
                  signal_summary: research.signal_summary,
                  counterparty_summary: research.counterparty_summary,
                  procedural_exemplars: draft.procedural_exemplars,
                  workspace_context_markdown: workspaceContextMarkdown ?? null,
                },
              },
            ),
          );
          if (editedGate.decision === "reject") {
            await publishPlayDeferred(
              ctx,
              edited.id,
              action,
              editedGate.rejection_reason ?? "eval_rejected_after_edit",
              null,
            );
            const output: SignalToLinkedInPlayOutput = {
              decision: "rejected",
              conversation_id: conversation.id,
              message_id: edited.id,
              eval_score: editedGate.verdict.score,
              pattern_key: patternKey,
              channel: action,
            };
            await ctx.publish("play.run.completed", {
              play_id: input.play_id,
              play_run_id: input.play_run_id,
              workflow_run_id: ctx.run_id,
              output: playRunOutputPayload(output),
            });
            return output;
          }
          sendDraft = {
            body: edited.body ?? "",
            eval_score: editedGate.verdict.score,
          };
        }
      }

      const send = await ctx.step("sender.linkedin", async () => {
        const result = await senderRole.invoke(
          {
            conversation: {
              id: conversation.id,
              workspace_id: input.workspace_id,
              rep_id: rep.id,
              counterparty_person_id: person.id,
              counterparty_linkedin_url: person.linkedin_url,
              topic: conversation.topic,
            },
            draft: {
              message_id: message.id,
              channel: action,
              subject: null,
              body: sendDraft.body,
              eval_passed: true,
              eval_score: sendDraft.eval_score,
            },
            correlation_id: ctx.correlation_id,
          },
          roleContext,
        );
        await ctx.publish("rep.role.completed", {
          rep_id: rep.id,
          role: "sender",
          action: "send_linkedin",
          conversation_id: conversation.id,
          message_id: message.id,
          signal_id: signal.id,
          play_id: input.play_id,
          play_run_id: input.play_run_id,
          workflow_run_id: ctx.run_id,
          summary: result.status,
          output: {
            channel: action,
            status: result.status,
          },
          completed_at: new Date().toISOString(),
        });
        return result;
      });

      let outcome_id: string | undefined;
      if (send.status === "sent" && input.simulate_outcome_kind) {
        outcome_id = await ctx.step("outcome.record", async () => {
          const outcomeId = randomUUID();
          await ctx.publish("outcome.recorded", {
            outcome_id: outcomeId,
            kind: input.simulate_outcome_kind!,
            score: input.simulate_outcome_kind === "meeting_booked" ? 1 : 0.8,
            conversation_id: conversation.id,
            attributed_play_id: input.play_id,
            attributed_play_run_id: input.play_run_id,
            attributed_message_id: message.id,
            attributed_signal_id: signal.id,
            attributed_rep_id: rep.id,
            properties: {
              pattern_key: patternKey,
              exemplar_ids: draft.exemplar_ids,
              ...(exaInfluence ? { exa_influence: exaInfluence } : {}),
            },
            provenance: {
              source: "signal-linkedin-play",
              ...(exaInfluence ? { exa_influence: exaInfluence } : {}),
            },
            occurred_at: new Date().toISOString(),
          });
          return outcomeId;
        });
      }

      const output: SignalToLinkedInPlayOutput = {
        decision: send.status === "deferred" ? "deferred" : "sent",
        conversation_id: conversation.id,
        message_id: message.id,
        outcome_id,
        eval_score: sendDraft.eval_score,
        pattern_key: patternKey,
        channel: action,
      };
      await ctx.publish("play.run.completed", {
        play_id: input.play_id,
        play_run_id: input.play_run_id,
        workflow_run_id: ctx.run_id,
        output: playRunOutputPayload(output),
      });
      return output;
    },
  });
}

function labelLinkedInAction(action: LinkedInChannelName): string {
  if (action === "linkedin_connection") return "send a LinkedIn connection request to";
  if (action === "linkedin_comment") return "comment for";
  return "send a LinkedIn DM to";
}

function parseApprovalDraftOverride(note: string | undefined): { body: string } | null {
  if (!note) return null;
  try {
    const parsed = JSON.parse(note) as { type?: unknown; body?: unknown };
    if (parsed.type !== "draft_override") return null;
    const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
    if (!body) return null;
    return { body };
  } catch {
    return null;
  }
}

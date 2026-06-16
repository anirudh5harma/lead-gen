import { randomUUID } from "node:crypto";
import { defineWorkflow, type RunContext } from "../substrate/workflows/index.ts";
import type { EventBus } from "../substrate/events/index.ts";
import type { Judge } from "../agents/eval/types.ts";
import type { LLMClient } from "../agents/llm/types.ts";
import { evalGate } from "../agents/eval/gate.ts";
import type { RepMemory } from "../agents/memory/types.ts";
import type { GraphCompany, GraphPerson } from "../graph/types.ts";
import type { Signal } from "../primitives/index.ts";
import {
  createResearcherRole,
  createSenderRole,
  createWriterRole,
} from "../agents/reps/index.ts";
import type { EmailChannel } from "../channels/email/index.ts";
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
import {
  createSelectedOutreachSkill,
  outreachSkillProvenance,
  type SelectedOutreachSkill,
} from "../agents/skills/outreach.ts";
import type { SignalEmailWriterDraft } from "../agents/reps/index.ts";

export const SIGNAL_TO_EMAIL_PLAY_WORKFLOW = "play.signal_to_email.v1";

export interface SignalToEmailPlayInput {
  workspace_id: string;
  play_id: string;
  play_run_id: string;
  rep_id: string;
  signal_id: string;
  person_id: string;
  company_id?: string | null;
  trigger_event_id?: string | null;
  email_approval?: "none" | "approve_first" | "always" | "research_only";
  play_channel_policy?: PlayChannelPolicy | null;
  simulate_outcome_kind?: "positive_reply" | "meeting_booked" | null;
  skill_key?: string | null;
  skill_version?: string | null;
  segment_key?: string | null;
  campaign_strategy?: {
    recommendation_id?: string | null;
    variant_key: string;
    matched_variant_key?: string | null;
    recommendation: string;
    allocation_weight: number;
    reason: string;
  } | null;
}

export interface SignalToEmailPlayOutput {
  decision: "sent" | "deferred" | "rejected";
  conversation_id: string;
  message_id: string;
  outcome_id?: string;
  eval_score: number;
  pattern_key: string;
  seed_pattern_key?: string | null;
  skill_key?: string;
  skill_version?: string;
}

export interface SignalToEmailPlayDeps {
  store: VerticalSliceStore;
  memory: RepMemory;
  judge: Judge;
  writerLlm?: LLMClient;
  email: EmailChannel;
  bus: EventBus;
  workspaceContextProvider?: (
    input: SignalToEmailPlayInput,
  ) => Promise<string | null | undefined>;
  draftGroundingProvider?: DraftGroundingProvider;
}

function playRunOutputPayload(output: SignalToEmailPlayOutput): Record<string, unknown> {
  return output as unknown as Record<string, unknown>;
}

function buildEmailPersonalizationContext(input: {
  signal: Signal;
  person: GraphPerson;
  company: GraphCompany | null;
  workspaceContextMarkdown?: string | null;
  draftGrounding?: { summary: string } | null;
}): string {
  const signalDate = formatIsoDate(input.signal.freshness_at);
  const workspaceContext = compactMarkdown(input.workspaceContextMarkdown, 700);
  return [
    "## Targeting Company",
    workspaceContext
      ? workspaceContext
      : "- Workspace profile/context was not available for this run.",
    "",
    "## Targeted Company And Contact",
    `- Company: ${input.company?.name ?? "unknown"}${input.company?.domain ? ` (${input.company.domain})` : ""}`,
    input.company?.industry ? `- Industry: ${input.company.industry}` : null,
    input.company?.size_bucket ? `- Size: ${input.company.size_bucket}` : null,
    input.company?.description ? `- Description: ${input.company.description}` : null,
    `- Contact: ${input.person.full_name}${input.person.title ? `, ${input.person.title}` : ""}`,
    input.person.linkedin_url ? `- LinkedIn: ${input.person.linkedin_url}` : null,
    input.person.emails.length ? `- Email evidence: ${emailEvidence(input.person.properties, input.person.emails[0]!)}` : null,
    "",
    "## Signal Timing And Why Now",
    `- Signal kind: ${input.signal.kind}`,
    `- Signal freshness: ${signalDate}`,
    `- Signal title: ${input.signal.title}`,
    input.signal.content ? `- Signal content: ${input.signal.content}` : null,
    input.signal.url ? `- Signal source: ${input.signal.url}` : null,
    input.signal.match_reason ? `- Match reason: ${input.signal.match_reason}` : null,
    input.signal.match_score != null ? `- Match score: ${input.signal.match_score.toFixed(2)}` : null,
    input.signal.novelty_score != null ? `- Novelty score: ${input.signal.novelty_score.toFixed(2)}` : null,
    typeof input.signal.audience_hint.rationale === "string"
      ? `- ICP rationale: ${input.signal.audience_hint.rationale}`
      : null,
    typeof input.signal.audience_hint.icp_segment === "string"
      ? `- ICP segment: ${input.signal.audience_hint.icp_segment}`
      : null,
    "",
    "## Fresh Evidence",
    input.draftGrounding?.summary ? input.draftGrounding.summary : "- No extra Exa draft grounding was required.",
  ].filter((line): line is string => line !== null).join("\n");
}

async function publishPlayDeferred(
  ctx: RunContext,
  message_id: string,
  defer_reason: string,
  retry_after: string | null,
): Promise<void> {
  await ctx.publish("message.deferred", {
    message_id,
    channel: "email",
    defer_reason,
    retry_after,
  });
}

export function createSignalToEmailPlayWorkflow(deps: SignalToEmailPlayDeps) {
  const researcher = createResearcherRole();
  const writer = createWriterRole({ llm: deps.writerLlm });
  const sender = createSenderRole();

  return defineWorkflow<SignalToEmailPlayInput, SignalToEmailPlayOutput>({
    name: SIGNAL_TO_EMAIL_PLAY_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      const rep = await deps.store.getRep(input.rep_id);
      if (!rep) throw new Error(`Rep not found: ${input.rep_id}`);
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

      const roleContext = {
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
          },
        });
        const row = await deps.store.projectConversationLifecycleEvent(event);
        if (!row) throw new Error(`Conversation projection failed: ${event.payload.conversation_id}`);
        return row;
      });

      const research = await ctx.step("research.signal_context", async () => {
        const result = await researcher.invoke({ signal, person, company }, roleContext);
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
        ? (await ctx.step("exa.draft_grounding", async () =>
            deps.draftGroundingProvider!({
              workspace_id: input.workspace_id,
              play_id: input.play_id,
              play_run_id: input.play_run_id,
              rep_id: rep.id,
              signal,
              person,
              company,
              channel: "email",
              query: buildDraftGroundingQuery({
                workspace_id: input.workspace_id,
                play_id: input.play_id,
                play_run_id: input.play_run_id,
                rep_id: rep.id,
                signal,
                person,
                company,
                channel: "email",
              }),
            }) ?? null, {
              on_failure: "skip",
              retry: { max_attempts: 1, backoff: "fixed" },
            })) ?? null
        : null;
      const groundedResearch = applyDraftGrounding(research, draftGrounding);
      const personalizationContextMarkdown = buildEmailPersonalizationContext({
        signal,
        person,
        company,
        workspaceContextMarkdown: workspaceContextMarkdown ?? null,
        draftGrounding,
      });
      const selectedSkill = createSelectedOutreachSkill({
        channel: "email",
        stage: "cold_open",
        signal_kind: signal.kind,
        person_title: person.title,
        preferred_skill_key: input.skill_key,
        preferred_skill_version: input.skill_version,
        base_pattern_key: research.pattern_key,
        slot_values: emailSkillSlotValues({
          signal,
          research: groundedResearch,
          person,
          company,
          workspaceContextMarkdown,
          draftGrounding,
        }),
      });

      const draft = await ctx.step("writer.compose_email", async () => {
        const result = await writer.invoke(
          {
            channel: "email",
            research: groundedResearch,
            recipient_name: person.given_name ?? person.full_name.split(" ")[0] ?? person.full_name,
            personalization_context_markdown: personalizationContextMarkdown,
            skill: selectedSkill,
          },
          roleContext,
        );
        await ctx.publish("rep.role.completed", {
          rep_id: rep.id,
          role: "writer",
          action: "compose_email",
          conversation_id: conversation.id,
          signal_id: signal.id,
          play_id: input.play_id,
          play_run_id: input.play_run_id,
          workflow_run_id: ctx.run_id,
          summary: result.subject,
          output: {
            pattern_key: result.pattern_key,
            seed_pattern_key: result.seed_pattern_key,
            skill_key: result.skill?.skill_key ?? null,
            skill_version: result.skill?.version ?? null,
            exemplar_ids: result.exemplar_ids,
            procedural_exemplar_count: result.procedural_exemplars.length,
          },
          completed_at: new Date().toISOString(),
        });
        return result;
      });

      const message = await ctx.step("message.draft", async () => {
        const message_id = randomUUID();
        const personalized_at = new Date().toISOString();
        const provenance = {
          pattern_key: draft.pattern_key,
          ...(draft.seed_pattern_key ? { seed_pattern_key: draft.seed_pattern_key } : {}),
          exemplar_ids: draft.exemplar_ids,
          play_id: input.play_id,
          play_run_id: input.play_run_id,
          ...outreachSkillProvenance(draft.skill, {
            pattern_key: draft.pattern_key,
            seed_pattern_key: draft.seed_pattern_key,
          }),
          personalization_context: {
            signal_id: signal.id,
            person_id: person.id,
            company_id: company?.id ?? null,
            generated_at: personalized_at,
          },
          ...(exaInfluence ? { exa_influence: exaInfluence } : {}),
          ...(draftGrounding ? { exa_grounding: draftGroundingProvenance(draftGrounding) } : {}),
        };
        await ctx.publish("message.personalized", {
          conversation_id: conversation.id,
          message_id,
          channel: "email",
          rep_id: rep.id,
          play_id: input.play_id,
          play_run_id: input.play_run_id,
          signal_id: signal.id,
          person_id: person.id,
          company_id: company?.id ?? null,
          subject: draft.subject,
          body: draft.body,
          personalization_context_markdown: personalizationContextMarkdown,
          skill: draft.skill ? { ...draft.skill } : null,
          provenance,
          personalized_at,
        });
        const event = await ctx.publish("draft.proposed", {
          conversation_id: conversation.id,
          message_id,
          channel: "email",
          rep_id: rep.id,
          subject: draft.subject,
          body: draft.body,
          properties: {
            personalization_context_markdown: personalizationContextMarkdown,
          },
          provenance,
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
              channel: "email",
              subject: draft.subject,
              body: draft.body,
            },
            context: {
              signal_summary: groundedResearch.signal_summary,
              counterparty_summary: research.counterparty_summary,
              procedural_exemplars: draft.procedural_exemplars,
              personalization_context_markdown: personalizationContextMarkdown,
              workspace_context_markdown: workspaceContextMarkdown ?? null,
              outreach_skill: outreachSkillJudgeContext(draft),
            },
          },
        ),
      );

      if (gate.decision === "reject") {
        await publishPlayDeferred(
          ctx,
          message.id,
          gate.rejection_reason ?? "eval_rejected",
          null,
        );
        const output: SignalToEmailPlayOutput = {
          decision: "rejected",
          conversation_id: conversation.id,
          message_id: message.id,
          eval_score: gate.verdict.score,
          pattern_key: draft.pattern_key,
          seed_pattern_key: draft.seed_pattern_key,
          ...skillOutput(draft.skill),
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
        channel: "email",
        daily_cap: Number.MAX_SAFE_INTEGER,
        approval: input.email_approval ?? "none",
      };
      if (policy.approval === "research_only") {
        const output: SignalToEmailPlayOutput = {
          decision: "deferred",
          conversation_id: conversation.id,
          message_id: message.id,
          eval_score: gate.verdict.score,
          pattern_key: draft.pattern_key,
          seed_pattern_key: draft.seed_pattern_key,
          ...skillOutput(draft.skill),
        };
        await publishPlayDeferred(ctx, message.id, "play_research_only", null);
        await ctx.publish("play.run.completed", {
          play_id: input.play_id,
          play_run_id: input.play_run_id,
          workflow_run_id: ctx.run_id,
          output: playRunOutputPayload(output),
        });
        return output;
      }

      const dailySendCount = await ctx.step("autonomy.play_email_daily_count", async () =>
        deps.store.countPlayChannelMessages({
          workspace_id: input.workspace_id,
          play_id: input.play_id,
          channel: "email",
          statuses: ["queued", "sent", "delivered", "replied", "bounced"],
          since: new Date(Date.now() - 24 * 60 * 60 * 1000),
        }),
      );
      if (isDailyCapExceeded(policy, dailySendCount)) {
        const output: SignalToEmailPlayOutput = {
          decision: "deferred",
          conversation_id: conversation.id,
          message_id: message.id,
          eval_score: gate.verdict.score,
          pattern_key: draft.pattern_key,
          seed_pattern_key: draft.seed_pattern_key,
          ...skillOutput(draft.skill),
        };
        await publishPlayDeferred(
          ctx,
          message.id,
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

      let sendDraft: { subject: string; body: string; eval_score: number } = {
        subject: draft.subject,
        body: draft.body,
        eval_score: gate.verdict.score,
      };
      const priorSendCount = await ctx.step("autonomy.play_email_prior_count", async () =>
        deps.store.countPlayChannelMessages({
          workspace_id: input.workspace_id,
          play_id: input.play_id,
          channel: "email",
          statuses: ["queued", "sent", "delivered", "replied", "bounced"],
          since: null,
        }),
      );
      if (shouldRequestApproval(policy, priorSendCount)) {
        const decision = await ctx.requestApproval({
          kind: "outbound.email.send",
          reason: `${rep.name} wants to email ${person.full_name} about ${signal.title}`,
          payload: {
            conversation_id: conversation.id,
            message_id: message.id,
            channel: "email",
            subject: draft.subject,
            body: draft.body,
            eval_score: gate.verdict.score,
            policy: policy.approval,
            daily_cap: policy.daily_cap,
            sent_today: dailySendCount,
            personalization_context_markdown: personalizationContextMarkdown,
            skill_key: draft.skill?.skill_key ?? null,
            skill_version: draft.skill?.version ?? null,
          },
        });
        if (decision.decision !== "approved") {
          const output: SignalToEmailPlayOutput = {
            decision: "deferred",
            conversation_id: conversation.id,
            message_id: message.id,
            eval_score: gate.verdict.score,
            pattern_key: draft.pattern_key,
            seed_pattern_key: draft.seed_pattern_key,
            ...skillOutput(draft.skill),
          };
          await publishPlayDeferred(
            ctx,
            message.id,
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
              properties: {
                human_edited: true,
                personalization_context_markdown: personalizationContextMarkdown,
              },
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
                  signal_summary: groundedResearch.signal_summary,
                  counterparty_summary: research.counterparty_summary,
                  procedural_exemplars: draft.procedural_exemplars,
                  personalization_context_markdown: personalizationContextMarkdown,
                  workspace_context_markdown: workspaceContextMarkdown ?? null,
                  outreach_skill: outreachSkillJudgeContext(draft),
                },
              },
            ),
          );
          if (editedGate.decision === "reject") {
            await publishPlayDeferred(
              ctx,
              edited.id,
              editedGate.rejection_reason ?? "eval_rejected_after_edit",
              null,
            );
            const output: SignalToEmailPlayOutput = {
              decision: "rejected",
              conversation_id: conversation.id,
              message_id: edited.id,
              eval_score: editedGate.verdict.score,
              pattern_key: draft.pattern_key,
              seed_pattern_key: draft.seed_pattern_key,
              ...skillOutput(draft.skill),
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
            subject: edited.subject ?? "",
            body: edited.body ?? "",
            eval_score: editedGate.verdict.score,
          };
        }
      }

      const send = await ctx.step("sender.email", async () => {
        const result = await sender.invoke(
          {
            conversation: {
              id: conversation.id,
              workspace_id: input.workspace_id,
              rep_id: rep.id,
              counterparty_person_id: person.id,
              counterparty_email: person.emails[0] ?? null,
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
          action: "send_email",
          conversation_id: conversation.id,
          message_id: message.id,
          signal_id: signal.id,
          play_id: input.play_id,
          play_run_id: input.play_run_id,
          workflow_run_id: ctx.run_id,
          summary: result.status,
          output: {
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
              pattern_key: draft.pattern_key,
              ...(draft.seed_pattern_key ? { seed_pattern_key: draft.seed_pattern_key } : {}),
              ...skillOutput(draft.skill),
              exemplar_ids: draft.exemplar_ids,
              ...(exaInfluence ? { exa_influence: exaInfluence } : {}),
            },
            provenance: {
              source: "signal-email-play",
              ...(exaInfluence ? { exa_influence: exaInfluence } : {}),
            },
            occurred_at: new Date().toISOString(),
          });
          return outcomeId;
        });
      }

      const output: SignalToEmailPlayOutput = {
        decision: send.status === "deferred" ? "deferred" : "sent",
        conversation_id: conversation.id,
        message_id: message.id,
        outcome_id,
        eval_score: sendDraft.eval_score,
        pattern_key: draft.pattern_key,
        seed_pattern_key: draft.seed_pattern_key,
        ...skillOutput(draft.skill),
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

function compactMarkdown(markdown: string | null | undefined, maxLength: number): string | null {
  const cleaned = markdown?.trim();
  if (!cleaned) return null;
  return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, maxLength).trim()}...`;
}

function emailSkillSlotValues(input: {
  signal: Signal;
  research: { signal_summary: string; counterparty_summary: string };
  person: GraphPerson;
  company: GraphCompany | null;
  workspaceContextMarkdown?: string | null;
  draftGrounding?: { summary: string } | null;
}): Record<string, string> {
  const whyNow = [
    input.signal.match_reason,
    input.signal.audience_hint.rationale,
    input.signal.freshness_at ? `Fresh as of ${formatIsoDate(input.signal.freshness_at)}.` : null,
  ].filter((part): part is string => Boolean(part));
  return {
    signal_hook: input.research.signal_summary,
    why_now: whyNow.join(" ") || input.signal.title,
    inferred_problem:
      input.signal.match_reason ??
      `${input.person.title ?? "This contact"} may care because ${input.signal.kind.replace(/_/g, " ")} changed the timing.`,
    proof_or_relevance:
      compactMarkdown(input.draftGrounding?.summary, 240) ??
      compactMarkdown(input.workspaceContextMarkdown, 240) ??
      "Use Bombsell's workspace context only if it is directly relevant.",
    peer_pattern:
      compactMarkdown(input.workspaceContextMarkdown, 240) ??
      "No outcome-backed peer proof available yet; avoid inventing proof.",
    counterparty_context: [
      input.person.full_name,
      input.person.title,
      input.company?.name,
      input.company?.industry,
    ].filter(Boolean).join(", "),
    reply_question: "Ask whether this is worth comparing notes on now.",
  };
}

function outreachSkillJudgeContext(draft: SignalEmailWriterDraft) {
  if (!draft.skill) return null;
  return {
    skill_key: draft.skill.skill_key,
    version: draft.skill.version,
    name: draft.skill.name,
    framework: draft.skill.framework,
    judge_focus: draft.skill.judge_focus,
    slot_values: draft.skill.slot_values,
    pattern_key: draft.pattern_key,
    seed_pattern_key: draft.seed_pattern_key,
  };
}

function skillOutput(skill: SelectedOutreachSkill | null): {
  skill_key?: string;
  skill_version?: string;
} {
  if (!skill) return {};
  return {
    skill_key: skill.skill_key,
    skill_version: skill.version,
  };
}

function formatIsoDate(value: string): string {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
}

function emailEvidence(properties: Record<string, unknown>, email: string): string {
  const verification = recordValue(properties.email_verification);
  const byEmail = recordValue(verification?.[email.toLowerCase()]);
  const status = typeof byEmail?.status === "string" ? byEmail.status : "unverified";
  const provider = typeof byEmail?.provider === "string" ? ` via ${byEmail.provider}` : "";
  return `${email} (${status}${provider})`;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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

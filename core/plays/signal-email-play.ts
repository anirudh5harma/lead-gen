import { defineWorkflow } from "../substrate/workflows/index.ts";
import type { EventBus } from "../substrate/events/index.ts";
import type { Judge } from "../agents/eval/types.ts";
import type { LLMClient } from "../agents/llm/types.ts";
import { evalGate } from "../agents/eval/gate.ts";
import type { RepMemory } from "../agents/memory/types.ts";
import {
  createResearcherRole,
  createSenderRole,
  createWriterRole,
} from "../agents/reps/index.ts";
import type { EmailChannel } from "../channels/email/index.ts";
import type { VerticalSliceStore } from "./vertical-store.ts";
import {
  isDailyCapExceeded,
  nextDailyWindow,
  shouldRequestApproval,
  type PlayChannelPolicy,
} from "./autonomy.ts";

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
}

export interface SignalToEmailPlayOutput {
  decision: "sent" | "deferred" | "rejected";
  conversation_id: string;
  message_id: string;
  outcome_id?: string;
  eval_score: number;
  pattern_key: string;
}

export interface SignalToEmailPlayDeps {
  store: VerticalSliceStore;
  memory: RepMemory;
  judge: Judge;
  writerLlm?: LLMClient;
  email: EmailChannel;
  bus: EventBus;
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
      const person = await deps.store.getPerson(input.person_id);
      if (!person) throw new Error(`Person not found: ${input.person_id}`);
      const company = await deps.store.getCompany(input.company_id ?? signal.related_company_id);

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
      };

      const conversation = await ctx.step("conversation.open", async () => {
        const row = await deps.store.createConversation({
          workspace_id: input.workspace_id,
          rep_id: rep.id,
          counterparty_person_id: person.id,
          counterparty_company_id: company?.id ?? null,
          origin_signal_id: signal.id,
          topic: signal.title,
        });
        await ctx.publish("conversation.opened", {
          conversation_id: row.id,
          rep_id: rep.id,
          counterparty_person_id: person.id,
          origin_signal_id: signal.id,
        });
        return row;
      });

      const research = await ctx.step("research.signal_context", () =>
        researcher.invoke({ signal, person, company }, roleContext),
      );

      const draft = await ctx.step("writer.compose_email", () =>
        writer.invoke(
          {
            channel: "email",
            research,
            recipient_name: person.given_name ?? person.full_name.split(" ")[0] ?? person.full_name,
          },
          roleContext,
        ),
      );

      const message = await ctx.step("message.draft", async () => {
        const row = await deps.store.createDraftMessage({
          workspace_id: input.workspace_id,
          conversation_id: conversation.id,
          subject: draft.subject,
          body: draft.body,
          provenance: {
            pattern_key: research.pattern_key,
            exemplar_ids: draft.exemplar_ids,
            play_id: input.play_id,
            play_run_id: input.play_run_id,
          },
        });
        await ctx.publish("draft.proposed", {
          conversation_id: conversation.id,
          message_id: row.id,
          channel: "email",
          rep_id: rep.id,
        });
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
              signal_summary: research.signal_summary,
              counterparty_summary: research.counterparty_summary,
              procedural_exemplars: draft.procedural_exemplars,
            },
          },
        ),
      );
      await deps.store.markMessageJudged(
        message.id,
        gate.verdict.score,
        gate.verdict.passed,
        gate.verdict.notes as unknown as Record<string, unknown>,
      );

      if (gate.decision === "reject") {
        await deps.store.markMessageDeferred(message.id, gate.rejection_reason ?? "eval_rejected");
        const output: SignalToEmailPlayOutput = {
          decision: "rejected",
          conversation_id: conversation.id,
          message_id: message.id,
          eval_score: gate.verdict.score,
          pattern_key: research.pattern_key,
        };
        await ctx.publish("play.run.completed", {
          play_id: input.play_id,
          play_run_id: input.play_run_id,
          workflow_run_id: ctx.run_id,
          output,
        });
        return output;
      }

      const policy = input.play_channel_policy ?? {
        channel: "email",
        daily_cap: Number.MAX_SAFE_INTEGER,
        approval: input.email_approval ?? "none",
      };
      if (policy.approval === "research_only") {
        await deps.store.markMessageDeferred(message.id, "play_research_only");
        const output: SignalToEmailPlayOutput = {
          decision: "deferred",
          conversation_id: conversation.id,
          message_id: message.id,
          eval_score: gate.verdict.score,
          pattern_key: research.pattern_key,
        };
        await ctx.publish("message.deferred", {
          message_id: message.id,
          channel: "email",
          defer_reason: "play_research_only",
          retry_after: null,
        });
        await ctx.publish("play.run.completed", {
          play_id: input.play_id,
          play_run_id: input.play_run_id,
          workflow_run_id: ctx.run_id,
          output,
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
        await deps.store.markMessageDeferred(message.id, "play_channel_daily_cap");
        const output: SignalToEmailPlayOutput = {
          decision: "deferred",
          conversation_id: conversation.id,
          message_id: message.id,
          eval_score: gate.verdict.score,
          pattern_key: research.pattern_key,
        };
        await ctx.publish("message.deferred", {
          message_id: message.id,
          channel: "email",
          defer_reason: "play_channel_daily_cap",
          retry_after: nextDailyWindow(),
        });
        await ctx.publish("play.run.completed", {
          play_id: input.play_id,
          play_run_id: input.play_run_id,
          workflow_run_id: ctx.run_id,
          output,
        });
        return output;
      }

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
          },
        });
        if (decision.decision !== "approved") {
          await deps.store.markMessageDeferred(message.id, `approval_${decision.decision}`);
          const output: SignalToEmailPlayOutput = {
            decision: "deferred",
            conversation_id: conversation.id,
            message_id: message.id,
            eval_score: gate.verdict.score,
            pattern_key: research.pattern_key,
          };
          await ctx.publish("message.deferred", {
            message_id: message.id,
            channel: "email",
            defer_reason: `approval_${decision.decision}`,
            retry_after: null,
          });
          await ctx.publish("play.run.completed", {
            play_id: input.play_id,
            play_run_id: input.play_run_id,
            workflow_run_id: ctx.run_id,
            output,
          });
          return output;
        }
      }

      const send = await ctx.step("sender.email", () =>
        sender.invoke(
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
              subject: draft.subject,
              body: draft.body,
              eval_passed: true,
              eval_score: gate.verdict.score,
            },
            email: deps.email,
            bus: deps.bus,
            correlation_id: ctx.correlation_id,
          },
          roleContext,
        ),
      );

      if (send.status === "deferred") {
        await deps.store.markMessageDeferred(message.id, send.defer_reason);
      } else {
        await deps.store.markMessageSent(message.id, send.external_id);
      }

      let outcome_id: string | undefined;
      if (send.status === "sent" && input.simulate_outcome_kind) {
        const outcome = await ctx.step("outcome.record", async () => {
          const row = await deps.store.recordOutcome({
            workspace_id: input.workspace_id,
            kind: input.simulate_outcome_kind!,
            score: input.simulate_outcome_kind === "meeting_booked" ? 1 : 0.8,
            conversation_id: conversation.id,
            attributed_message_id: message.id,
            attributed_signal_id: signal.id,
            attributed_play_id: input.play_id,
            attributed_play_run_id: input.play_run_id,
            attributed_rep_id: rep.id,
            properties: {
              pattern_key: research.pattern_key,
              exemplar_ids: draft.exemplar_ids,
            },
          });
          await ctx.publish("outcome.recorded", {
            outcome_id: row.id,
            kind: row.kind,
            score: row.score,
            conversation_id: row.conversation_id,
            attributed_play_id: row.attributed_play_id,
            attributed_play_run_id: row.attributed_play_run_id,
            attributed_message_id: row.attributed_message_id,
            attributed_rep_id: row.attributed_rep_id,
            properties: row.properties,
          });
          return row;
        });
        outcome_id = outcome.id;
      }

      const output: SignalToEmailPlayOutput = {
        decision: send.status === "deferred" ? "deferred" : "sent",
        conversation_id: conversation.id,
        message_id: message.id,
        outcome_id,
        eval_score: gate.verdict.score,
        pattern_key: research.pattern_key,
      };
      await ctx.publish("play.run.completed", {
        play_id: input.play_id,
        play_run_id: input.play_run_id,
        workflow_run_id: ctx.run_id,
        output,
      });
      return output;
    },
  });
}

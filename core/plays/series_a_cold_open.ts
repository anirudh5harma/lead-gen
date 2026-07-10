import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { EventBus } from "../substrate/events/index.ts";
import type { LLMClient } from "../agents/llm/types.ts";
import type { Judge } from "../agents/eval/types.ts";
import type { RepMemory } from "../agents/memory/types.ts";
import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../substrate/workflows/index.ts";
import { composeRep } from "../agents/reps/compose.ts";
import {
  createDeepSeekWriter,
  type WriterDraft,
} from "../agents/reps/roles/writer.ts";
import { createEmailSender } from "../agents/reps/roles/sender.ts";
import { evalGate } from "../agents/eval/gate.ts";
import { projectMessageLifecycleEvent } from "../channels/message-lifecycle.ts";
import { projectConversationLifecycleEvent } from "../primitives/conversation-lifecycle.ts";
import { deterministicConversationId } from "../primitives/conversation-identity.ts";
import type { EmailChannelDeps, EmailSubChannel } from "../channels/email/index.ts";
import type { Rep } from "../primitives/index.ts";

/**
 * "Series A founder cold open" — the first end-to-end Play.
 *
 * Walks the whole pivot-v2 spine: load signal/person/company context →
 * retrieve procedural exemplars → draft via DeepSeek writer → emit/project
 * conversation + message lifecycle events → eval gate (hot path) → project results →
 * send via the email channel (which enforces eval gate, caps, warmup).
 *
 * Every external effect is wrapped in `ctx.step()` so the Postgres
 * workflow runtime journals + replays on resume. Steps are idempotent
 * via checkpoint reuse on re-execution.
 *
 * Trigger: not wired here. Upstream (signal matcher) starts the workflow
 * once a `signal.matched` event lands; for the smoke test we kick it
 * manually.
 */

export interface ColdOpenInput {
  signal_id: string;
  rep_id: string;
  person_id: string;
  channel_account_id: string;
  sending_domain_id?: string;
}

export type ColdOpenOutput =
  | { status: "sent"; message_id: string; conversation_id: string; external_id: string }
  | {
      status: "rejected";
      message_id: string;
      conversation_id: string;
      reason: string;
      eval_score: number;
    }
  | {
      status: "deferred";
      message_id: string;
      conversation_id: string;
      reason: string;
      detail?: string;
    }
  | {
      /** The signal expired (TTL or upstream dropped) before the Play could
       *  send. Emits no message; the operator dashboard surfaces this via
       *  the parked workflow output. */
      status: "skipped";
      reason: "signal_expired" | "signal_dismissed" | "signal_already_in_play";
      signal_status: string;
    };

export interface SeriesAColdOpenDeps {
  pool: Pool;
  bus: EventBus;
  llm: LLMClient;
  judge: Judge;
  memory: RepMemory;
  /** Email channel deps minus pool/bus — those come from this object's pool/bus. */
  emailChannelDeps: Omit<EmailChannelDeps, "pool" | "bus">;
}

interface LoadedContext {
  rep: Rep;
  person: {
    id: string;
    full_name: string;
    title: string | null;
    emails: string[];
    company_id: string;
  };
  company: {
    id: string;
    name: string;
    industry: string | null;
  };
  signal: {
    id: string;
    kind: string;
    title: string;
    content: string | null;
    url: string | null;
    status: string;
  };
}

async function loadEmailSubChannel(
  pool: Pool,
  workspace_id: string,
  channel_account_id: string,
): Promise<EmailSubChannel> {
  const { rows } = await pool.query<{ kind: string }>(
    `select kind::text as kind
       from channel_accounts
      where id = $1
        and workspace_id = $2`,
    [channel_account_id, workspace_id],
  );
  const kind = rows[0]?.kind;
  if (kind === "oauth_outlook") return "oauth_outlook";
  if (kind === "email_domain") return "owned_domain";
  throw new Error(`channel_account ${channel_account_id} is not a supported email account`);
}

/** Statuses that mean the signal is no longer actionable by a Play. */
const TERMINAL_SIGNAL_STATUSES = new Set(["spent", "dismissed"]);
/** Status the projector sets while another Play is already working it. */
const IN_PLAY_SIGNAL_STATUS = "in_play";

async function loadContext(
  pool: Pool,
  input: ColdOpenInput,
  workspace_id: string,
): Promise<LoadedContext> {
  const repRes = await pool.query<{
    id: string;
    workspace_id: string;
    name: string;
    role: Rep["role"];
    status: Rep["status"];
    persona: Rep["persona"];
    channels: string[];
    autonomy: Rep["autonomy"];
    created_at: Date;
    updated_at: Date;
  }>(
    `select id, workspace_id, name, role, status, persona, channels, autonomy,
            created_at, updated_at
       from reps where id = $1 and workspace_id = $2`,
    [input.rep_id, workspace_id],
  );
  if (!repRes.rows[0]) throw new Error(`rep ${input.rep_id} not found in workspace`);
  const repRow = repRes.rows[0];

  const personRes = await pool.query<{
    id: string;
    full_name: string;
    title: string | null;
    emails: string[];
    company_id: string | null;
  }>(
    `select id, full_name, title, emails::text[] as emails, company_id
       from graph_persons
      where id = $1 and workspace_id = $2`,
    [input.person_id, workspace_id],
  );
  const person = personRes.rows[0];
  if (!person) throw new Error(`person ${input.person_id} not found`);
  if (!person.company_id) {
    throw new Error(
      `person ${input.person_id} has no company; cold-open requires company context`,
    );
  }
  if (person.emails.length === 0) {
    throw new Error(`person ${input.person_id} has no email address`);
  }

  const companyRes = await pool.query<{
    id: string;
    name: string;
    industry: string | null;
  }>(
    `select id, name, industry from graph_companies where id = $1 and workspace_id = $2`,
    [person.company_id, workspace_id],
  );
  if (!companyRes.rows[0]) throw new Error(`company ${person.company_id} not found`);

  const signalRes = await pool.query<{
    id: string;
    kind: string;
    title: string;
    content: string | null;
    url: string | null;
    status: string;
  }>(
    `select id, kind::text as kind, title, content, url, status::text as status
       from signals where id = $1 and workspace_id = $2`,
    [input.signal_id, workspace_id],
  );
  if (!signalRes.rows[0]) throw new Error(`signal ${input.signal_id} not found`);

  return {
    rep: {
      id: repRow.id,
      workspace_id: repRow.workspace_id,
      name: repRow.name,
      role: repRow.role,
      status: repRow.status,
      persona: repRow.persona,
      channels: repRow.channels,
      autonomy: repRow.autonomy,
      created_at: repRow.created_at.toISOString(),
      updated_at: repRow.updated_at.toISOString(),
    },
    person: {
      id: person.id,
      full_name: person.full_name,
      title: person.title,
      emails: person.emails,
      company_id: person.company_id,
    },
    company: companyRes.rows[0],
    signal: signalRes.rows[0],
  };
}

export function createSeriesAColdOpenPlay(
  deps: SeriesAColdOpenDeps,
): WorkflowDefinition<ColdOpenInput, ColdOpenOutput> {
  return defineWorkflow<ColdOpenInput, ColdOpenOutput>({
    name: "series_a_cold_open",
    version: "1",
    async run(input, ctx): Promise<ColdOpenOutput> {
      const workspace_id = ctx.workspace_id;
      if (!workspace_id) {
        throw new Error("series_a_cold_open requires a workspace-scoped invocation");
      }

      // 1. Load signal + person + company + rep into a typed context object.
      const loaded = await ctx.step("load_context", () =>
        loadContext(deps.pool, input, workspace_id),
      );

      // 1a. Signal gate: bail before any LLM / channel work if the signal
      //     has already expired (TTL or upstream dropped), been dismissed
      //     by the classifier, or been claimed by another Play. The
      //     expiry projector flips status to 'spent'; the dismissal
      //     projector to 'dismissed'. Both are terminal for this Play.
      const status = loaded.signal.status;
      if (TERMINAL_SIGNAL_STATUSES.has(status)) {
        return {
          status: "skipped",
          reason: status === "spent" ? "signal_expired" : "signal_dismissed",
          signal_status: status,
        };
      }
      if (status === IN_PLAY_SIGNAL_STATUS) {
        return {
          status: "skipped",
          reason: "signal_already_in_play",
          signal_status: status,
        };
      }

      // 2. Compose the Rep with its role agents. Pure, no side effects;
      //    keep outside ctx.step.
      const rep = composeRep(loaded.rep, {
        writer: createDeepSeekWriter({ llm: deps.llm }),
        sender: createEmailSender({
          emailChannelDeps: {
            ...deps.emailChannelDeps,
            pool: deps.pool,
            bus: deps.bus,
          },
        }),
      });

      const memoryScope = { workspace_id, rep_id: loaded.rep.id };
      const stage = "cold_open";
      const channelLabel = "email" as const;

      // 3. Retrieve procedural exemplars for this pattern.
      const exemplars = await ctx.step("retrieve_exemplars", () =>
        deps.memory.procedural.topForPattern(
          memoryScope,
          buildPatternKeyForStage(loaded, stage, channelLabel),
          3,
        ),
      );

      // 4. Draft via the writer role agent.
      const draft: WriterDraft = await ctx.step("draft", () =>
        rep.role("writer").invoke(
          {
            signal: loaded.signal,
            person: {
              full_name: loaded.person.full_name,
              title: loaded.person.title,
            },
            company: loaded.company,
            channel: channelLabel,
            stage,
            exemplars,
          },
          {
            rep: loaded.rep,
            tool_context: {
              workspace_id,
              rep_id: loaded.rep.id,
              run_id: ctx.run_id,
              correlation_id: ctx.correlation_id,
            },
            memory: deps.memory,
            judge: deps.judge,
          },
        ) as Promise<WriterDraft>,
      );

      // 5. Open (or reuse) the conversation; propose the draft via typed events.
      const { conversation_id, message_id } = await ctx.step(
        "create_conversation_and_message",
        async () => {
          const existing = await deps.pool.query<{ id: string }>(
            `select id from conversations
              where workspace_id = $1 and rep_id = $2 and counterparty_person_id = $3
                and status in ('open', 'awaiting_them', 'awaiting_us')
              order by started_at desc
              limit 1`,
            [workspace_id, loaded.rep.id, loaded.person.id],
          );
          let convId: string;
          if (existing.rows[0]) {
            convId = existing.rows[0].id;
          } else {
            convId = deterministicConversationId({
              workspace_id,
              rep_id: loaded.rep.id,
              counterparty_person_id: loaded.person.id,
              origin_signal_id: loaded.signal.id,
            });
            const conversationEvent = await ctx.publish("conversation.opened", {
              conversation_id: convId,
              rep_id: loaded.rep.id,
              counterparty_person_id: loaded.person.id,
              counterparty_company_id: loaded.company.id,
              origin_signal_id: loaded.signal.id,
              topic: draft.subject,
              properties: { pattern_key: draft.pattern_key },
            });
            await projectConversationLifecycleEvent(deps.pool, conversationEvent);
          }
          const msgId = randomUUID();
          const draftEvent = await ctx.publish("draft.proposed", {
            conversation_id: convId,
            message_id: msgId,
            channel: "email",
            rep_id: loaded.rep.id,
            subject: draft.subject,
            body: draft.body_text,
            provenance: {
              exemplar_ids: draft.exemplar_ids,
              pattern_key: draft.pattern_key,
            },
          });
          await projectMessageLifecycleEvent(deps.pool, draftEvent);
          return { conversation_id: convId, message_id: msgId };
        },
      );

      // 6. Hot-path eval. Emits draft.judged (always) + draft.rejected (when failed).
      const verdict = await ctx.step("eval_gate", () =>
        evalGate(
          { judge: deps.judge, bus: deps.bus },
          {
            workspace_id,
            rep: {
              id: loaded.rep.id,
              name: loaded.rep.name,
              role: loaded.rep.role,
              persona: loaded.rep.persona,
            },
            artifact: {
              kind: "draft",
              channel: channelLabel,
              subject: draft.subject,
              body: draft.body_text,
            },
            message_id,
          },
        ),
      );

      // 7. Materialize the eval events for the read model. The typed event
      //    remains the source of truth; this mirrors the durable projector.
      await ctx.step("project_eval", async () => {
        await projectMessageLifecycleEvent(deps.pool, verdict.events.judged);
        if (verdict.events.rejected) {
          await projectMessageLifecycleEvent(deps.pool, verdict.events.rejected);
        }
      });

      if (verdict.decision !== "pass") {
        return {
          status: "rejected",
          message_id,
          conversation_id,
          reason: verdict.rejection_reason ?? "sub_threshold",
          eval_score: verdict.verdict.score,
        };
      }

      const subChannel = await ctx.step("select_email_sub_channel", () =>
        loadEmailSubChannel(deps.pool, workspace_id, input.channel_account_id),
      );

      // 8. Send via the email channel. The channel re-verifies the eval gate
      //    from the events table — defence in depth — and enforces caps,
      //    warmup, and connected-inbox state before calling the provider.
      const sendResult = await ctx.step("send", () =>
        rep.role("sender").invoke(
          {
            conversation_id,
            message_id,
            channel_account_id: input.channel_account_id,
            sub_channel: subChannel,
            sending_domain_id: subChannel === "owned_domain" ? input.sending_domain_id : undefined,
            draft: {
              to: {
                email: loaded.person.emails[0],
                name: loaded.person.full_name,
              },
              subject: draft.subject,
              body_text: draft.body_text,
            },
          },
          {
            rep: loaded.rep,
            tool_context: {
              workspace_id,
              rep_id: loaded.rep.id,
              run_id: ctx.run_id,
              correlation_id: ctx.correlation_id,
            },
            memory: deps.memory,
            judge: deps.judge,
          },
        ) as Promise<{
          status: "sent" | "deferred";
          external_id?: string;
          reason?: string;
          detail?: string;
        }>,
      );

      if (sendResult.status === "sent" && sendResult.external_id) {
        return {
          status: "sent",
          message_id,
          conversation_id,
          external_id: sendResult.external_id,
        };
      }

      return {
        status: "deferred",
        message_id,
        conversation_id,
        reason: sendResult.reason ?? "unknown",
        detail: sendResult.detail,
      };
    },
  });
}

function buildPatternKeyForStage(
  loaded: LoadedContext,
  stage: string,
  channel: string,
): string {
  const segment = loaded.company.industry
    ? `${loaded.company.industry.toLowerCase().replace(/\s+/g, "_")}-founder`
    : "unknown";
  return `icp:${segment}|signal:${loaded.signal.kind}|channel:${channel}|stage:${stage}`;
}

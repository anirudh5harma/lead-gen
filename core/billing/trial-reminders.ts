import type { Pool } from "pg";
import type {
  DurableEventProjection,
  EventPayload,
  PublishedEvent,
} from "../substrate/events/index.ts";
import { createTransactionalSender, type TransactionalSender } from "../channels/email/index.ts";
import { getWorkspaceBillingState } from "./credits.ts";
import { defineWorkflow } from "../substrate/workflows/index.ts";

const DEFAULT_FROM = "Bombsell <no-reply@mail.bombsell.com>";

interface ReminderRecipient {
  email: string;
  workspace_name: string | null;
}

export interface TrialReminderProjectionDeps {
  pool: Pool;
  enabled?: boolean;
  sender?: TransactionalSender;
  loadRecipient?: (
    pool: Pool,
    workspace_id: string,
  ) => Promise<ReminderRecipient | null>;
  now?: () => Date;
}

export type TrialWeekReminderWorkflowDeps = TrialReminderProjectionDeps;

export async function listDueTrialWeekReminderWorkspaces(
  pool: Pick<Pool, "query">,
  now: Date,
  limit: number,
  cursor: string | null,
): Promise<Array<{ workspace_id: string }>> {
  const { rows } = await pool.query<{ workspace_id: string }>(
    `select id as workspace_id
       from workspaces
      where archived_at is null
        and credits_exhausted_at is not null
        and credits_exhausted_at <= $1::timestamptz - interval '7 days'
        and trial_reminder_week_sent_at is null
        and not (
          subscription_status = 'active'
          or (
            subscription_status = 'canceled'
            and subscription_renews_at > $1::timestamptz
          )
        )
      order by (id > coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)) desc,
               id
      limit $3`,
    [now, cursor, limit],
  );
  return rows;
}

function reminderEnabled(enabled?: boolean): boolean {
  if (typeof enabled === "boolean") return enabled;
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

function getSender(deps: TrialReminderProjectionDeps): TransactionalSender {
  return deps.sender ?? createTransactionalSender({ from: DEFAULT_FROM });
}

async function loadReminderRecipient(
  pool: Pool,
  workspace_id: string,
): Promise<ReminderRecipient | null> {
  const { rows } = await pool.query<ReminderRecipient>(
    `select nullif(trim(w.settings->>'owner_email'), '') as email,
            w.name as workspace_name
       from workspaces w
      where w.id = $1
      limit 1`,
    [workspace_id],
  );
  return rows[0]?.email ? rows[0] : null;
}

async function markReminderSent(
  pool: Pool,
  workspace_id: string,
  column:
    | "trial_reminder_low_sent_at"
    | "trial_reminder_zero_sent_at"
    | "trial_reminder_week_sent_at",
  at: Date,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `update workspaces
        set ${column} = $2
      where id = $1
        and ${column} is null`,
    [workspace_id, at.toISOString()],
  );
  return (rowCount ?? 0) > 0;
}

async function wasReminderSent(
  pool: Pool,
  workspace_id: string,
  column:
    | "trial_reminder_low_sent_at"
    | "trial_reminder_zero_sent_at"
    | "trial_reminder_week_sent_at",
): Promise<boolean> {
  const { rows } = await pool.query<{ sent: boolean }>(
    `select ${column} is not null as sent
       from workspaces
      where id = $1`,
    [workspace_id],
  );
  return Boolean(rows[0]?.sent);
}

function workspaceLabel(name: string | null): string {
  return name?.trim() || "your workspace";
}

async function sendLowReminder(
  deps: TrialReminderProjectionDeps,
  event: PublishedEvent<EventPayload<"workspace.trial.low">>,
): Promise<void> {
  if (!reminderEnabled(deps.enabled)) return;
  if (await wasReminderSent(deps.pool, event.workspace_id, "trial_reminder_low_sent_at")) {
    return;
  }
  const state = await getWorkspaceBillingState(deps.pool, event.workspace_id);
  if (state.tier === "pro" || state.frozen) return;
  const recipient =
    await (deps.loadRecipient ?? loadReminderRecipient)(deps.pool, event.workspace_id);
  if (!recipient?.email) return;
  const sender = getSender(deps);
  await sender.send({
    to: recipient.email,
    subject: `5 trial credits left on ${workspaceLabel(recipient.workspace_name)}`,
    text:
      `You have ${event.payload.credits_remaining} of ${event.payload.credits_total} trial credits left on ${workspaceLabel(recipient.workspace_name)}.\n\n` +
      "Each send uses one credit. Upgrade to Pro for unlimited sending before outreach pauses.",
    category: "trial_low_credits",
    idempotency_key: `trial-low:${event.workspace_id}`,
  });
  await markReminderSent(
    deps.pool,
    event.workspace_id,
    "trial_reminder_low_sent_at",
    deps.now?.() ?? new Date(),
  );
}

async function sendExhaustedReminder(
  deps: TrialReminderProjectionDeps,
  event: PublishedEvent<EventPayload<"workspace.trial.exhausted">>,
): Promise<void> {
  if (!reminderEnabled(deps.enabled)) return;
  if (await wasReminderSent(deps.pool, event.workspace_id, "trial_reminder_zero_sent_at")) {
    return;
  }
  const state = await getWorkspaceBillingState(deps.pool, event.workspace_id);
  if (state.tier === "pro") return;
  const recipient =
    await (deps.loadRecipient ?? loadReminderRecipient)(deps.pool, event.workspace_id);
  if (!recipient?.email) return;
  const sender = getSender(deps);
  await sender.send({
    to: recipient.email,
    subject: `Trial credits exhausted for ${workspaceLabel(recipient.workspace_name)}`,
    text:
      `Trial credits are used up for ${workspaceLabel(recipient.workspace_name)}.\n\n` +
      "Signals, drafts, and prep will keep running, but sending is paused until you upgrade to Pro.",
    category: "trial_exhausted",
    idempotency_key: `trial-exhausted:${event.workspace_id}`,
  });
  await markReminderSent(
    deps.pool,
    event.workspace_id,
    "trial_reminder_zero_sent_at",
    deps.now?.() ?? new Date(),
  );
}

export function createTrialReminderProjection(
  deps: TrialReminderProjectionDeps,
): DurableEventProjection {
  return {
    name: "workspace.trial.reminders.v1",
    eventTypes: ["workspace.trial.low", "workspace.trial.exhausted"],
    async apply(event) {
      if (event.event_type === "workspace.trial.low") {
        await sendLowReminder(
          deps,
          event as PublishedEvent<EventPayload<"workspace.trial.low">>,
        );
        return;
      }
      await sendExhaustedReminder(
        deps,
        event as PublishedEvent<EventPayload<"workspace.trial.exhausted">>,
      );
    },
  };
}

export async function sendTrialWeekReminderForWorkspace(
  deps: TrialWeekReminderWorkflowDeps,
  workspace_id: string,
  now = deps.now?.() ?? new Date(),
): Promise<boolean> {
  if (!reminderEnabled(deps.enabled)) return false;
  if (
    await wasReminderSent(
      deps.pool,
      workspace_id,
      "trial_reminder_week_sent_at",
    )
  ) {
    return false;
  }
  const state = await getWorkspaceBillingState(deps.pool, workspace_id);
  if (!state.frozen || state.tier === "pro") return false;
  const recipient = await (deps.loadRecipient ?? loadReminderRecipient)(
    deps.pool,
    workspace_id,
  );
  if (!recipient?.email) return false;
  await getSender(deps).send({
    to: recipient.email,
    subject: `Outreach is still paused for ${workspaceLabel(recipient.workspace_name)}`,
    text:
      `Outreach has been paused for a week on ${workspaceLabel(recipient.workspace_name)} because the trial is exhausted.\n\n` +
      "Upgrade to Pro to resume held sends instantly.",
    category: "trial_week_frozen",
    idempotency_key: `trial-week:${workspace_id}`,
  });
  return markReminderSent(
    deps.pool,
    workspace_id,
    "trial_reminder_week_sent_at",
    now,
  );
}

export function createTrialWeekReminderWorkflow(
  deps: TrialWeekReminderWorkflowDeps,
) {
  return defineWorkflow<
    { workspace_id: string },
    { sent: boolean }
  >({
    name: "billing_trial_week_reminder",
    version: "1",
    async run(input, ctx) {
      if (
        ctx.execution_scope !== "workspace" ||
        !ctx.workspace_id ||
        ctx.workspace_id !== input.workspace_id
      ) {
        throw new Error(
          "input workspace does not match workflow workspace",
        );
      }
      const sent = await ctx.step("send trial week reminder", () =>
        sendTrialWeekReminderForWorkspace(deps, input.workspace_id)
      );
      return { sent };
    },
  });
}

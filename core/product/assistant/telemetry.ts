import type { Pool } from "pg";
import { createJournaledDispatchEventBus } from "../../substrate/events/index.ts";
import { getPool } from "../../substrate/storage/index.ts";
import {
  assistantDailySessionCapDefault,
  assistantDailyToolCapDefault,
} from "./config.ts";
import type { AssistantSessionMode } from "./types.ts";

export class AssistantUsageCapExceededError extends Error {
  readonly cap: number;
  readonly kind: "session" | "tool";
  readonly used: number;

  constructor(input: {
    cap: number;
    kind: "session" | "tool";
    used: number;
  }) {
    const label = input.kind === "session" ? "session" : "tool call";
    super(
      `Assistant daily ${label} cap reached for this workspace (${input.used}/${input.cap} in the last 24 hours).`,
    );
    this.name = "AssistantUsageCapExceededError";
    this.cap = input.cap;
    this.kind = input.kind;
    this.used = input.used;
  }
}

export function isAssistantUsageCapExceededError(
  error: unknown,
): error is AssistantUsageCapExceededError {
  return error instanceof AssistantUsageCapExceededError;
}

function parseNonnegativeCap(value: string | null | undefined, fallback: number): number {
  const parsed = value == null ? NaN : Number(value);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.trunc(parsed))
    : fallback;
}

async function loadAssistantUsageSnapshot(
  workspaceId: string,
  pool: Pool,
): Promise<{
  dailySessionCap: number;
  dailyToolCap: number;
  sessions24h: number;
  tools24h: number;
}> {
  const result = await pool.query<{
    daily_session_cap: string | null;
    daily_tool_cap: string | null;
    sessions_24h: string;
    tools_24h: string;
  }>(
    `select
       coalesce(
         w.settings #>> '{assistant,daily_session_cap}',
         w.settings->>'assistant_daily_session_cap'
       ) as daily_session_cap,
       coalesce(
         w.settings #>> '{assistant,daily_tool_cap}',
         w.settings->>'assistant_daily_tool_cap'
       ) as daily_tool_cap,
       count(*) filter (
         where e.event_type = 'assistant.session.started'
       )::text as sessions_24h,
       count(*) filter (
         where e.event_type = 'assistant.tool.called'
       )::text as tools_24h
     from workspaces w
     left join events e
       on e.workspace_id = w.id
      and e.occurred_at >= now() - interval '24 hours'
      and e.event_type in ('assistant.session.started', 'assistant.tool.called')
    where w.id = $1
    group by w.id`,
    [workspaceId],
  );
  const row = result.rows[0];
  return {
    dailySessionCap: parseNonnegativeCap(
      row?.daily_session_cap,
      assistantDailySessionCapDefault(),
    ),
    dailyToolCap: parseNonnegativeCap(
      row?.daily_tool_cap,
      assistantDailyToolCapDefault(),
    ),
    sessions24h: Number(row?.sessions_24h ?? 0),
    tools24h: Number(row?.tools_24h ?? 0),
  };
}

export async function assertAssistantSessionAllowed(input: {
  pool?: Pool;
  workspaceId: string;
}): Promise<void> {
  const usage = await loadAssistantUsageSnapshot(
    input.workspaceId,
    input.pool ?? getPool(),
  );
  if (usage.sessions24h >= usage.dailySessionCap) {
    throw new AssistantUsageCapExceededError({
      cap: usage.dailySessionCap,
      kind: "session",
      used: usage.sessions24h,
    });
  }
}

export async function assertAssistantToolAllowed(input: {
  pool?: Pool;
  workspaceId: string;
}): Promise<void> {
  const usage = await loadAssistantUsageSnapshot(
    input.workspaceId,
    input.pool ?? getPool(),
  );
  if (usage.tools24h >= usage.dailyToolCap) {
    throw new AssistantUsageCapExceededError({
      cap: usage.dailyToolCap,
      kind: "tool",
      used: usage.tools24h,
    });
  }
}

export async function publishAssistantSessionStarted(input: {
  callId: string | null;
  mode: AssistantSessionMode;
  userId: string;
  voice: string;
  workspaceId: string;
}): Promise<void> {
  const bus = await createJournaledDispatchEventBus({ pool: getPool() });
  await bus.publish({
    workspace_id: input.workspaceId,
    event_type: "assistant.session.started",
    source: "user",
    producer_ref: "assistant:drawer",
    payload: {
      user_id: input.userId,
      mode: input.mode,
      call_id: input.callId,
      output_voice: input.voice,
    },
  });
}

export async function publishAssistantToolCalled(input: {
  callId?: string | null;
  latencyMs: number;
  requestId?: string | null;
  requiresConfirmation: boolean;
  status: "completed" | "confirmation_pending" | "errored";
  toolName: string;
  userId: string;
  workspaceId: string;
}): Promise<void> {
  const bus = await createJournaledDispatchEventBus({ pool: getPool() });
  await bus.publish({
    workspace_id: input.workspaceId,
    event_type: "assistant.tool.called",
    source: "agent",
    producer_ref: "assistant:drawer",
    payload: {
      user_id: input.userId,
      tool_name: input.toolName,
      call_id: input.callId ?? null,
      request_id: input.requestId ?? null,
      status: input.status,
      latency_ms: Math.max(0, Math.round(input.latencyMs)),
      requires_confirmation: input.requiresConfirmation,
    },
  });
}

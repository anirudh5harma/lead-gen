import { createJournaledDispatchEventBus } from "../../substrate/events/index.ts";
import { getPool } from "../../substrate/storage/index.ts";
import type { AssistantSessionMode } from "./types.ts";

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

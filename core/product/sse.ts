import type { PublishedEvent } from "../substrate/events/index.ts";

export interface BriefSseEvent {
  id?: string;
  event?: string;
  retry?: number;
  data?: unknown;
}

function sanitizeEventName(event: string): string {
  return event.replace(/[^\w.-]/g, "_");
}

function line(value: unknown): string {
  return String(value).replace(/\r?\n/g, "\ndata: ");
}

export function formatBriefSseEvent(input: BriefSseEvent): string {
  const parts: string[] = [];
  if (input.id) parts.push(`id: ${line(input.id)}`);
  if (input.event) parts.push(`event: ${sanitizeEventName(input.event)}`);
  if (input.retry) parts.push(`retry: ${input.retry}`);
  parts.push(`data: ${line(JSON.stringify(input.data ?? {}))}`);
  return `${parts.join("\n")}\n\n`;
}

export function briefEventPayload(event: PublishedEvent): Record<string, unknown> {
  return {
    id: event.id,
    workspace_id: event.workspace_id,
    event_type: event.event_type,
    occurred_at: event.occurred_at,
    payload: event.payload,
  };
}

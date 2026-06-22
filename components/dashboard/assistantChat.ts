"use client";

import type {
  AssistantCard,
  AssistantConfirmationRequest,
} from "../../core/product/assistant/types.ts";

/**
 * Client for the DeepSeek-backed assistant brain at POST /api/assistant/chat.
 *
 * The route streams Server-Sent Events. Unlike EventSource (GET-only), we POST
 * the user message + history and parse the `event:`/`data:` framed stream off
 * the fetch body reader ourselves. Voice and text both funnel through here —
 * the only difference upstream is whether `message` came from a mic transcript
 * or the text box.
 */

export interface AssistantChatTurn {
  role: "user" | "assistant";
  text: string;
}

export type AssistantChatEvent =
  | { type: "text-delta"; text: string }
  | { type: "card"; card: AssistantCard }
  | {
      type: "confirmation";
      confirmation: AssistantConfirmationRequest;
      card: AssistantCard;
      callId: string | null;
    }
  | { type: "done"; finishReason: string }
  | { type: "error"; error: string };

function parseChatEvent(name: string, data: string): AssistantChatEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return null;
  }
  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};

  if (name === "text-delta" && typeof record.text === "string") {
    return { type: "text-delta", text: record.text };
  }
  if (name === "card" && record && typeof record === "object") {
    return { type: "card", card: record as unknown as AssistantCard };
  }
  if (name === "confirmation" && record.confirmation) {
    return {
      type: "confirmation",
      confirmation: record.confirmation as AssistantConfirmationRequest,
      card: record.card as AssistantCard,
      callId: typeof record.call_id === "string" ? record.call_id : null,
    };
  }
  if (name === "done") {
    return {
      type: "done",
      finishReason:
        typeof record.finish_reason === "string"
          ? record.finish_reason
          : "stop",
    };
  }
  if (name === "error") {
    return {
      type: "error",
      error:
        typeof record.error === "string"
          ? record.error
          : "Assistant request failed.",
    };
  }
  return null;
}

/**
 * POST the turn and stream parsed events. The async generator yields each SSE
 * event as it arrives; callers render text-delta incrementally and append
 * cards/confirmations. Pass `signal` to cancel an in-flight response.
 */
export async function* streamAssistantChat(input: {
  message: string;
  history?: AssistantChatTurn[];
  signal?: AbortSignal;
}): AsyncGenerator<AssistantChatEvent> {
  const response = await fetch("/api/assistant/chat", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({
      message: input.message,
      history: input.history ?? [],
    }),
    signal: input.signal,
  });

  if (!response.ok || !response.body) {
    let detail = "Assistant request failed.";
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string") detail = body.error;
    } catch {
      /* non-JSON error body */
    }
    yield { type: "error", error: detail };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      let separator = buffer.indexOf("\n\n");
      while (separator !== -1) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        separator = buffer.indexOf("\n\n");

        let eventName = "message";
        const dataLines: string[] = [];
        for (const rawLine of frame.split("\n")) {
          const line = rawLine.replace(/\r$/, "");
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
        if (dataLines.length === 0) continue;
        const parsed = parseChatEvent(eventName, dataLines.join("\n"));
        if (parsed) yield parsed;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

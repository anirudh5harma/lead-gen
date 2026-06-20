import type { AssistantSessionMode } from "./types.ts";
import { assistantOpenAiApiKey, assistantSafetyIdentifier, assistantVoice, buildRealtimeSessionConfig } from "./config.ts";
import { assistantRealtimeTools } from "./tool-surface.ts";

export interface RealtimeSessionStartResult {
  callId: string | null;
  sdp: string;
}

export async function startAssistantRealtimeSession(input: {
  fetchImpl?: typeof fetch;
  mode: AssistantSessionMode;
  sdp: string;
  userId: string;
}): Promise<RealtimeSessionStartResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const form = new FormData();
  form.set("sdp", input.sdp);
  form.set(
    "session",
    JSON.stringify(
      buildRealtimeSessionConfig(input.mode, assistantRealtimeTools()),
    ),
  );

  const response = await fetchImpl("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${assistantOpenAiApiKey()}`,
      "OpenAI-Safety-Identifier": assistantSafetyIdentifier(input.userId),
    },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `OpenAI Realtime session failed (${response.status}): ${detail || "unknown error"}`,
    );
  }

  const location = response.headers.get("Location");
  return {
    callId: location?.split("/").pop() ?? null,
    sdp: await response.text(),
  };
}

export { assistantVoice };


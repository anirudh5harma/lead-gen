import type { AssistantSessionMode } from "./types.ts";
import { assistantOpenAiApiKey, assistantSafetyIdentifier, assistantVoice, buildRealtimeSessionConfig } from "./config.ts";

export interface RealtimeSessionStartResult {
  callId: string | null;
  sdp: string;
}

const REALTIME_CALL_URL = "https://api.openai.com/v1/realtime/calls";
const REALTIME_TIMEOUT_MS = 25_000;
const REALTIME_MAX_ATTEMPTS = 3;
const REALTIME_RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startAssistantRealtimeSession(input: {
  fetchImpl?: typeof fetch;
  mode: AssistantSessionMode;
  sdp: string;
  userId: string;
}): Promise<RealtimeSessionStartResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const apiKey = assistantOpenAiApiKey();
  const safetyId = assistantSafetyIdentifier(input.userId);
  const sessionConfig = JSON.stringify(buildRealtimeSessionConfig(input.mode));

  let lastError = "unknown error";
  for (let attempt = 1; attempt <= REALTIME_MAX_ATTEMPTS; attempt += 1) {
    // FormData is rebuilt per attempt so a retried request carries a fresh body.
    const form = new FormData();
    form.set("sdp", input.sdp);
    form.set("session", sessionConfig);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REALTIME_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetchImpl(REALTIME_CALL_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "OpenAI-Safety-Identifier": safetyId,
        },
        body: form,
        signal: controller.signal,
      });
    } catch (error) {
      lastError =
        error instanceof Error && error.name === "AbortError"
          ? "request timed out"
          : error instanceof Error
            ? error.message
            : "network error";
      if (attempt < REALTIME_MAX_ATTEMPTS) {
        await delay(400 * attempt);
        continue;
      }
      throw new Error(`OpenAI Realtime session failed (timeout): ${lastError}`);
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      const location = response.headers.get("Location");
      return {
        callId: location?.split("/").pop() ?? null,
        sdp: await response.text(),
      };
    }

    lastError = (await response.text()) || "unknown error";
    if (
      attempt < REALTIME_MAX_ATTEMPTS &&
      REALTIME_RETRYABLE_STATUS.has(response.status)
    ) {
      await delay(400 * attempt);
      continue;
    }
    throw new Error(
      `OpenAI Realtime session failed (${response.status}): ${lastError}`,
    );
  }

  throw new Error(`OpenAI Realtime session failed: ${lastError}`);
}

export { assistantVoice };

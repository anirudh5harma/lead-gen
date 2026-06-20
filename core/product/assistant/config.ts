import { createHash } from "node:crypto";
import type { AssistantRealtimeFunctionTool, AssistantSessionMode } from "./types.ts";
import { buildAssistantInstructions } from "./instructions.ts";

export function assistantOpenAiApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY is required for the voice assistant.");
  }
  return key;
}

export function assistantConfirmationSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error("SESSION_SECRET is required for assistant confirmations.");
  }
  return secret;
}

export function assistantVoice(): string {
  return "marin";
}

function readNonnegativeIntEnv(
  key: string,
  fallback: number,
): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.trunc(parsed))
    : fallback;
}

export function assistantDailySessionCapDefault(): number {
  return readNonnegativeIntEnv("BOMBSELL_ASSISTANT_DAILY_SESSION_CAP", 50);
}

export function assistantDailyToolCapDefault(): number {
  return readNonnegativeIntEnv("BOMBSELL_ASSISTANT_DAILY_TOOL_CAP", 500);
}

export function assistantSafetyIdentifier(userId: string): string {
  return createHash("sha256").update(`bombsell:${userId}`).digest("hex");
}

export function buildRealtimeSessionConfig(
  mode: AssistantSessionMode,
  tools: AssistantRealtimeFunctionTool[],
): Record<string, unknown> {
  const voice = assistantVoice();
  const audioInput =
    mode === "voice"
      ? {
          noise_reduction: { type: "near_field" },
          transcription: {
            model: "gpt-realtime-whisper",
            language: "en",
            delay: "low",
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.55,
            prefix_padding_ms: 250,
            silence_duration_ms: 450,
          },
        }
      : undefined;

  return {
    type: "realtime",
    model: "gpt-realtime-2",
    instructions: buildAssistantInstructions(),
    reasoning: { effort: "low" },
    audio: {
      output: { voice },
      ...(audioInput ? { input: audioInput } : {}),
    },
    output_modalities: ["audio", "text"],
    tools,
    tool_choice: "auto",
  };
}

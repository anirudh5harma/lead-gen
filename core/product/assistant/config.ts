import { createHash } from "node:crypto";
import type { AssistantSessionMode } from "./types.ts";

export function assistantOpenAiApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY is required for Realtime voice transcription.");
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
  return "transcription_only";
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
): Record<string, unknown> {
  const audioInput = {
    noise_reduction: { type: "near_field" },
    transcription: {
      model: "gpt-4o-transcribe",
      language: "en",
    },
    turn_detection: {
      type: "server_vad",
      threshold: 0.55,
      prefix_padding_ms: mode === "voice" ? 250 : 0,
      silence_duration_ms: mode === "voice" ? 450 : 300,
    },
  };

  // Transcription-only Realtime session: OpenAI requires `type: "transcription"`
  // here (a realtime *response* model must NOT be set as the session model — the
  // transcription model lives under audio.input.transcription.model). We only
  // consume input-audio transcription events; the assistant brain is DeepSeek.
  return {
    type: "transcription",
    audio: {
      input: audioInput,
    },
  };
}

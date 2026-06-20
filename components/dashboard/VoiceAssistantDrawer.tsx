"use client";

import Link from "next/link";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Icon from "../Icon";
import type {
  AssistantCard,
  AssistantConfirmationRequest,
  AssistantToolName,
  AssistantToolRequest,
  AssistantToolRouteResponse,
} from "../../core/product/assistant/types.ts";
import {
  connectAssistantRealtime,
  type AssistantRealtimeConnection,
  type AssistantRealtimeEvent,
  type AssistantReplayMessage,
} from "./assistantTransport.ts";

type ConnectionState = "idle" | "connecting" | "connected";
type MicState = "unknown" | "ready" | "blocked";

interface MessageEntry {
  kind: "message";
  id: string;
  live: boolean;
  role: "assistant" | "user";
  source: "text" | "voice";
  text: string;
  realtimeItemId?: string;
}

interface CardEntry {
  kind: "card";
  id: string;
  card: AssistantCard;
}

interface ConfirmationEntry {
  kind: "confirmation";
  id: string;
  callId: string;
  confirmation: AssistantConfirmationRequest;
  status: "pending" | "working" | "resolved";
  textOnly: boolean;
  card: AssistantCard;
}

type TimelineEntry = MessageEntry | CardEntry | ConfirmationEntry;

const STARTERS = [
  "Show me the operating brief.",
  "Why is launch blocked right now?",
  "What are the top qualified signals?",
  "Summarize the company brain.",
] as const;

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function cardToneClasses(tone: AssistantCard["tone"]): string {
  if (tone === "success") {
    return "border-emerald-200/80 bg-emerald-50/80 text-emerald-900";
  }
  if (tone === "warning") {
    return "border-amber-200/90 bg-amber-50/90 text-amber-950";
  }
  if (tone === "error") {
    return "border-rose-200/90 bg-rose-50/90 text-rose-950";
  }
  return "border-[var(--color-line-1)] bg-white/88 text-[var(--color-text-1)]";
}

function extractMessageText(item: Record<string, unknown>): string | null {
  const content = Array.isArray(item.content) ? item.content : [];
  const parts = content
    .map((entry) => {
      const part = asRecord(entry);
      return asString(part?.transcript) ?? asString(part?.text) ?? null;
    })
    .filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(" ").trim() : null;
}

function messageSourceFromItem(
  item: Record<string, unknown>,
): "text" | "voice" {
  const content = Array.isArray(item.content) ? item.content : [];
  return content.some((entry) => {
    const part = asRecord(entry);
    return (
      part?.type === "output_audio" ||
      typeof part?.transcript === "string"
    );
  })
    ? "voice"
    : "text";
}

function replayableEntries(entries: TimelineEntry[]): AssistantReplayMessage[] {
  return entries
    .filter((entry): entry is MessageEntry => entry.kind === "message")
    .filter((entry) => !entry.live && entry.text.trim().length > 0)
    .map((entry) => ({
      id: entry.realtimeItemId ?? entry.id,
      role: entry.role,
      text: entry.text,
    }));
}

function assistantCardEntry(card: AssistantCard): CardEntry {
  return {
    kind: "card",
    id: `card:${card.id}:${crypto.randomUUID()}`,
    card,
  };
}

export default function VoiceAssistantDrawer() {
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [draft, setDraft] = useState("");
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [holdActive, setHoldActive] = useState(false);
  const [micState, setMicState] = useState<MicState>("unknown");
  const [sessionMode, setSessionMode] = useState<"text" | "voice" | null>(null);

  const connectionRef = useRef<AssistantRealtimeConnection | null>(null);
  const entriesRef = useRef<TimelineEntry[]>([]);
  const itemEntryIdsRef = useRef<Map<string, string>>(new Map());
  const responseTextOnlyRef = useRef<Map<string, boolean>>(new Map());
  const holdRequestedRef = useRef(false);
  const sessionModeRef = useRef<"text" | "voice" | null>(null);
  const micStateRef = useRef<MicState>("unknown");

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    sessionModeRef.current = sessionMode;
  }, [sessionMode]);

  useEffect(() => {
    micStateRef.current = micState;
  }, [micState]);

  const appendLocalStatus = useEffectEvent(
    (input: Pick<AssistantCard, "title" | "body" | "tone">) => {
      setEntries((current) => [
        ...current,
        assistantCardEntry({
          id: createId("status"),
          kind: "status",
          tone: input.tone,
          title: input.title,
          body: input.body,
        }),
      ]);
    },
  );

  const upsertMessage = useEffectEvent((input: {
    itemId: string;
    role: "assistant" | "user";
    source: "text" | "voice";
    text?: string;
    append?: string;
    live?: boolean;
  }) => {
    setEntries((current) => {
      const entryId = itemEntryIdsRef.current.get(input.itemId);
      const nextText = input.text ?? input.append ?? "";

      if (!entryId) {
        const created: MessageEntry = {
          kind: "message",
          id: createId("message"),
          realtimeItemId: input.itemId,
          role: input.role,
          source: input.source,
          text: input.text ?? input.append ?? "",
          live: input.live ?? false,
        };
        itemEntryIdsRef.current.set(input.itemId, created.id);
        return [...current, created];
      }

      return current.map((entry) => {
        if (entry.kind !== "message" || entry.id !== entryId) return entry;
        return {
          ...entry,
          source: input.source,
          live: input.live ?? entry.live,
          text:
            input.text !== undefined
              ? input.text
              : `${entry.text}${nextText}`,
        };
      });
    });
  });

  const finalizeMessagesFromResponse = useEffectEvent((event: AssistantRealtimeEvent) => {
    const response = asRecord(event.response);
    const output = Array.isArray(response?.output) ? response.output : [];

    for (const candidate of output) {
      const item = asRecord(candidate);
      if (!item || item.role !== "assistant") continue;
      const itemId = asString(item.id);
      const text = extractMessageText(item);
      if (!itemId || !text) continue;
      upsertMessage({
        itemId,
        role: "assistant",
        source: messageSourceFromItem(item),
        text,
        live: false,
      });
    }
  });

  const appendToolEntries = useEffectEvent((input: {
    callId: string;
    result: AssistantToolRouteResponse;
    textOnly: boolean;
  }) => {
    setEntries((current) => {
      const next = [...current];
      if (input.result.status === "requires_confirmation" && input.result.confirmation) {
        const confirmationCard =
          input.result.cards[0] ??
          ({
            id: createId("confirmation"),
            kind: "confirmation",
            tone: "warning",
            title: input.result.confirmation.title,
            body: input.result.confirmation.body,
          } satisfies AssistantCard);

        next.push({
          kind: "confirmation",
          id: createId("confirm"),
          callId: input.callId,
          confirmation: input.result.confirmation,
          status: "pending",
          textOnly: input.textOnly,
          card: confirmationCard,
        });

        for (const card of input.result.cards.slice(1)) {
          next.push(assistantCardEntry(card));
        }
        return next;
      }

      for (const card of input.result.cards) {
        next.push(assistantCardEntry(card));
      }
      return next;
    });
  });

  const updateConfirmation = useEffectEvent((entryId: string, status: ConfirmationEntry["status"]) => {
    setEntries((current) =>
      current.map((entry) =>
        entry.kind === "confirmation" && entry.id === entryId
          ? { ...entry, status }
          : entry,
      ),
    );
  });

  const markAssistantIdle = useEffectEvent(() => {
    setAssistantBusy(false);
    setHoldActive(false);
  });

  const handleRealtimeEvent = useEffectEvent((event: AssistantRealtimeEvent) => {
    if (event.type === "session.created") {
      setConnectionState("connected");
      return;
    }

    if (event.type === "response.created") {
      const response = asRecord(event.response);
      const responseId = asString(response?.id);
      const outputModalities = Array.isArray(response?.output_modalities)
        ? response.output_modalities
        : [];
      if (responseId) {
        responseTextOnlyRef.current.set(
          responseId,
          outputModalities.length > 0 &&
            outputModalities.every((value) => value === "text"),
        );
      }
      setAssistantBusy(true);
      return;
    }

    if (event.type === "response.output_text.delta") {
      const itemId = asString(event.item_id);
      const delta = asString(event.delta);
      if (itemId && delta) {
        upsertMessage({
          itemId,
          role: "assistant",
          source: "text",
          append: delta,
          live: true,
        });
      }
      return;
    }

    if (event.type === "response.output_audio_transcript.delta") {
      const itemId = asString(event.item_id);
      const delta = asString(event.delta);
      if (itemId && delta) {
        upsertMessage({
          itemId,
          role: "assistant",
          source: "voice",
          append: delta,
          live: true,
        });
      }
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.delta") {
      const itemId = asString(event.item_id);
      const delta = asString(event.delta);
      if (itemId && delta) {
        upsertMessage({
          itemId,
          role: "user",
          source: "voice",
          append: delta,
          live: true,
        });
      }
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.completed") {
      const itemId = asString(event.item_id);
      const transcript = asString(event.transcript);
      if (itemId && transcript) {
        upsertMessage({
          itemId,
          role: "user",
          source: "voice",
          text: transcript,
          live: false,
        });
      }
      return;
    }

    if (event.type === "input_audio_buffer.speech_started") {
      const itemId = asString(event.item_id);
      if (itemId) {
        upsertMessage({
          itemId,
          role: "user",
          source: "voice",
          text: "",
          live: true,
        });
      }
      setAssistantBusy(false);
      return;
    }

    if (event.type === "input_audio_buffer.speech_stopped") {
      setHoldActive(false);
      return;
    }

    if (event.type === "conversation.item.created") {
      const item = asRecord(event.item);
      if (!item) return;
      const itemId = asString(item.id);
      const role =
        item.role === "assistant" || item.role === "user"
          ? item.role
          : null;
      const text = extractMessageText(item);
      if (itemId && role && text) {
        upsertMessage({
          itemId,
          role,
          source: role === "assistant" ? "text" : "text",
          text,
          live: false,
        });
      }
      return;
    }

    if (event.type === "response.function_call_arguments.done") {
      const callId = asString(event.call_id);
      const toolName = asString(event.name);
      const responseId = asString(event.response_id);
      if (!callId || !toolName) return;

      const textOnly = responseId
        ? responseTextOnlyRef.current.get(responseId) ?? false
        : sessionModeRef.current !== "voice";

      void (async () => {
        try {
          const rawArguments = asString(event.arguments) ?? "{}";
          const parsedArguments = JSON.parse(rawArguments) as Record<string, unknown>;
          const body: AssistantToolRequest = {
            action: "invoke",
            // Tool name arrives from the realtime model as an untrusted string;
            // the /api/assistant/tool route revalidates it against the allowed
            // tool surface (400 on unknown), so a boundary cast is safe here.
            tool_name: toolName as AssistantToolName,
            call_id: callId,
            request_id: responseId ?? null,
            arguments: parsedArguments,
          };
          const response = await fetch("/api/assistant/tool", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          const result =
            (await response.json()) as AssistantToolRouteResponse | { error?: string };

          if (!response.ok && response.status !== 422) {
            throw new Error(asString((result as { error?: string }).error) ?? "Assistant tool failed.");
          }

          const toolResult = result as AssistantToolRouteResponse;
          appendToolEntries({
            callId,
            result: toolResult,
            textOnly,
          });

          if (toolResult.status === "requires_confirmation") return;

          connectionRef.current?.sendFunctionOutput(
            callId,
            toolResult.tool_output ?? {
              status: toolResult.status,
              error: toolResult.error ?? null,
              tool_name: toolResult.tool_name,
            },
          );
          connectionRef.current?.requestResponse({ textOnly });
        } catch (error) {
          appendLocalStatus({
            title: "Tool call failed",
            body:
              error instanceof Error
                ? error.message
                : "The assistant could not finish that tool call.",
            tone: "error",
          });
          connectionRef.current?.sendFunctionOutput(callId, {
            status: "errored",
            tool_name: toolName,
            error:
              error instanceof Error
                ? error.message
                : "The assistant could not finish that tool call.",
          });
          connectionRef.current?.requestResponse({ textOnly });
        }
      })();
      return;
    }

    if (event.type === "response.done") {
      finalizeMessagesFromResponse(event);
      const response = asRecord(event.response);
      const responseId = asString(response?.id);
      if (responseId) {
        responseTextOnlyRef.current.delete(responseId);
      }
      markAssistantIdle();
      return;
    }

    if (event.type === "error") {
      const detail = asRecord(event.error);
      setErrorMessage(
        asString(detail?.message) ?? "The assistant hit a realtime error.",
      );
      markAssistantIdle();
    }
  });

  async function disconnectAssistant() {
    connectionRef.current?.close();
    connectionRef.current = null;
    setConnectionState("idle");
    setSessionMode(null);
    setAssistantBusy(false);
    setHoldActive(false);
  }

  async function ensureConnection(
    targetMode: "text" | "voice",
  ): Promise<AssistantRealtimeConnection> {
    if (
      connectionRef.current &&
      sessionModeRef.current === targetMode
    ) {
      return connectionRef.current;
    }

    if (connectionRef.current) {
      await disconnectAssistant();
    }

    setConnectionState("connecting");
    setErrorMessage(null);

    let liveConnection: AssistantRealtimeConnection | null = null;

    try {
      liveConnection = await connectAssistantRealtime({
        mode: targetMode,
        onClose: () => {
          if (connectionRef.current === liveConnection) {
            connectionRef.current = null;
            setConnectionState("idle");
            setSessionMode(null);
            setAssistantBusy(false);
          }
        },
        onEvent: handleRealtimeEvent,
      });

      const history = replayableEntries(entriesRef.current);
      if (history.length > 0) {
        liveConnection.replayHistory(history);
      }

      connectionRef.current = liveConnection;
      setConnectionState("connected");
      setSessionMode(targetMode);
      if (targetMode === "voice") {
        setMicState("ready");
      }
      return liveConnection;
    } catch (error) {
      setConnectionState("idle");
      setSessionMode(null);
      if (targetMode === "voice") {
        setMicState("blocked");
      }
      throw error;
    }
  }

  async function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    setErrorMessage(null);
    const itemId = createId("user");
    upsertMessage({
      itemId,
      role: "user",
      source: "text",
      text: trimmed,
      live: false,
    });

    const preferredMode =
      sessionModeRef.current ??
      (micStateRef.current === "ready" ? "voice" : "text");

    try {
      const connection = await ensureConnection(preferredMode);
      connection.interrupt();
      connection.sendText({ itemId, text: trimmed });
      connection.requestResponse({ textOnly: true });
      setAssistantBusy(true);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Assistant connection failed.",
      );
      appendLocalStatus({
        title: "Assistant offline",
        body:
          error instanceof Error
            ? error.message
            : "Assistant connection failed.",
        tone: "error",
      });
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = draft;
    setDraft("");
    await sendText(next);
  }

  async function beginVoiceTurn(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    holdRequestedRef.current = true;
    setHoldActive(true);
    setErrorMessage(null);

    try {
      const connection = await ensureConnection("voice");
      connection.interrupt();
      if (holdRequestedRef.current) {
        connection.setMicrophoneEnabled(true);
      }
    } catch (error) {
      holdRequestedRef.current = false;
      setHoldActive(false);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Microphone access is required for voice.",
      );
      appendLocalStatus({
        title: "Voice unavailable",
        body:
          error instanceof Error
            ? error.message
            : "Microphone access is required for voice.",
        tone: "warning",
      });
    }
  }

  function endVoiceTurn() {
    holdRequestedRef.current = false;
    setHoldActive(false);
    connectionRef.current?.setMicrophoneEnabled(false);
  }

  async function resolveConfirmation(entry: ConfirmationEntry, approve: boolean) {
    const preferredMode =
      sessionModeRef.current ??
      (micStateRef.current === "ready" ? "voice" : "text");

    let connection: AssistantRealtimeConnection | null = null;
    try {
      connection = await ensureConnection(preferredMode);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Assistant connection failed.";
      setErrorMessage(message);
      appendLocalStatus({
        title: "Assistant offline",
        body: message,
        tone: "error",
      });
      return;
    }

    updateConfirmation(entry.id, approve ? "working" : "resolved");

    if (!approve) {
      connection.sendFunctionOutput(entry.callId, {
        status: "cancelled_by_user",
        tool_name: "confirmation",
        message: "The user declined the action.",
      });
      connection.requestResponse({ textOnly: entry.textOnly });
      appendLocalStatus({
        title: "Action canceled",
        body: "The assistant did not apply that change.",
        tone: "warning",
      });
      return;
    }

    try {
      const body: AssistantToolRequest = {
        action: "confirm",
        confirmation_token: entry.confirmation.token,
      };
      const response = await fetch("/api/assistant/tool", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result =
        (await response.json()) as AssistantToolRouteResponse | { error?: string };

      if (!response.ok && response.status !== 422) {
        throw new Error(asString((result as { error?: string }).error) ?? "Confirmation failed.");
      }

      const toolResult = result as AssistantToolRouteResponse;
      appendToolEntries({
        callId: entry.callId,
        result: toolResult,
        textOnly: entry.textOnly,
      });
      connection.sendFunctionOutput(
        entry.callId,
        toolResult.tool_output ?? {
          status: toolResult.status,
          error: toolResult.error ?? null,
          tool_name: toolResult.tool_name,
        },
      );
      connection.requestResponse({ textOnly: entry.textOnly });
      updateConfirmation(entry.id, "resolved");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Confirmation failed.";
      updateConfirmation(entry.id, "pending");
      setErrorMessage(message);
      appendLocalStatus({
        title: "Confirmation failed",
        body: message,
        tone: "error",
      });
    }
  }

  useEffect(() => {
    if (!drawerOpen) {
      void disconnectAssistant();
    }
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return undefined;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDrawerOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  useEffect(() => {
    return () => {
      void disconnectAssistant();
    };
  }, []);

  const voiceLabel =
    holdActive || assistantBusy
      ? "Release to send"
      : sessionMode === "voice"
        ? "Hold to talk"
        : "Push to talk";

  return (
    <>
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        aria-label="Open voice assistant"
        className="inline-flex h-12 items-center gap-2 rounded-full bg-[var(--color-ink-0)]/90 px-4 text-[13.5px] font-medium tracking-[-0.01em] text-[var(--color-text-2)] backdrop-blur-md ring-1 ring-[var(--color-line-1)] transition hover:bg-[var(--color-ink-2)] hover:text-[var(--color-text-1)]"
      >
        <span className="relative inline-flex size-7 items-center justify-center rounded-full bg-[var(--color-ink-2)] text-[var(--color-text-1)]">
          <Icon name="mic" size={14} />
          {connectionState === "connected" ? (
            <span className="assistant-live-pulse absolute inset-0 rounded-full" />
          ) : null}
        </span>
        <span className="hidden sm:inline">Assistant</span>
      </button>

      <div
        aria-hidden={!drawerOpen}
        className={
          "fixed inset-0 z-[70] transition " +
          (drawerOpen
            ? "pointer-events-auto bg-[rgba(16,24,27,0.18)] backdrop-blur-[2px]"
            : "pointer-events-none bg-transparent")
        }
        onClick={() => setDrawerOpen(false)}
      />

      <aside
        aria-label="Voice assistant drawer"
        className="drawer-panel assistant-drawer-grid fixed inset-y-0 right-0 z-[80] flex w-full max-w-[560px] flex-col border-l border-[var(--color-line-1)] shadow-[0_24px_80px_rgba(16,24,27,0.18)]"
        data-open={drawerOpen}
      >
        <header className="border-b border-[var(--color-line-1)] px-5 pb-4 pt-5 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line-1)] bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-3)]">
                <span className="agent-status-dot bg-[var(--color-pos)]" />
                Drawer copilot
              </div>
              <h2
                className="mt-3 text-[25px] font-semibold tracking-[-0.03em] text-[var(--color-text-1)]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Talk to Bombsell
              </h2>
              <p className="mt-2 max-w-md text-[13.5px] leading-[1.6] tracking-[-0.01em] text-[var(--color-text-3)]">
                Ask about signals, channel blockers, approvals, company memory,
                conversation proof, and meeting prep.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close voice assistant"
              className="grid size-11 shrink-0 place-items-center rounded-full border border-[var(--color-line-1)] bg-white/72 text-[var(--color-text-3)] transition hover:text-[var(--color-text-1)]"
            >
              <Icon name="close" size={16} />
            </button>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-[16px] border border-[var(--color-line-1)] bg-white/76 px-3.5 py-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--color-text-4)]">
                Session
              </p>
              <p className="mt-1.5 text-[14px] font-semibold tracking-[-0.02em] text-[var(--color-text-1)]">
                {connectionState === "connected"
                  ? sessionMode === "voice"
                    ? "Voice ready"
                    : "Text ready"
                  : connectionState === "connecting"
                    ? "Connecting"
                    : "Idle"}
              </p>
            </div>
            <div className="rounded-[16px] border border-[var(--color-line-1)] bg-white/76 px-3.5 py-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--color-text-4)]">
                Voice
              </p>
              <p className="mt-1.5 text-[14px] font-semibold tracking-[-0.02em] text-[var(--color-text-1)]">
                {micState === "ready"
                  ? holdActive
                    ? "Listening"
                    : "Armed"
                  : micState === "blocked"
                    ? "Text fallback"
                    : "Tap to enable"}
              </p>
            </div>
            <div className="rounded-[16px] border border-[var(--color-line-1)] bg-white/76 px-3.5 py-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--color-text-4)]">
                Scope
              </p>
              <p className="mt-1.5 text-[14px] font-semibold tracking-[-0.02em] text-[var(--color-text-1)]">
                Account + data
              </p>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {errorMessage ? (
            <div className="assistant-entry mb-4 rounded-[16px] border border-rose-200 bg-rose-50/90 px-4 py-3 text-[13px] text-rose-900">
              {errorMessage}
            </div>
          ) : null}

          {entries.length === 0 ? (
            <div className="grid gap-4">
              <div className="assistant-entry rounded-[20px] border border-[var(--color-line-1)] bg-white/84 p-5 shadow-[0_10px_32px_rgba(16,24,27,0.05)]">
                <p className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--color-text-1)]">
                  Try a live operating question
                </p>
                <p className="mt-2 text-[13.5px] leading-[1.6] text-[var(--color-text-3)]">
                  The assistant can read your quantitative surfaces and pull
                  qualitative evidence from company memory, conversation proof,
                  and launch readiness.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {STARTERS.map((starter) => (
                    <button
                      key={starter}
                      type="button"
                      onClick={() => void sendText(starter)}
                      className="rounded-full border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3.5 py-2 text-left text-[12.5px] font-medium tracking-[-0.01em] text-[var(--color-text-2)] transition hover:border-[var(--color-line-2)] hover:text-[var(--color-text-1)]"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              {entries.map((entry) => {
                if (entry.kind === "message") {
                  const isAssistant = entry.role === "assistant";
                  return (
                    <div
                      key={entry.id}
                      className={
                        "assistant-entry flex " +
                        (isAssistant ? "justify-start" : "justify-end")
                      }
                    >
                      <div
                        className={
                          "max-w-[88%] rounded-[22px] px-4 py-3 text-[14px] leading-[1.6] shadow-[0_10px_28px_rgba(16,24,27,0.05)] " +
                          (isAssistant
                            ? "rounded-tl-[8px] border border-[var(--color-line-1)] bg-white/88 text-[var(--color-text-1)]"
                            : "rounded-tr-[8px] bg-[var(--color-cta-bg)] text-[var(--color-cta-text)]")
                        }
                      >
                        <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] opacity-70">
                          <span>{isAssistant ? "Assistant" : "You"}</span>
                          <span className="text-[10px]">
                            {entry.source === "voice" ? "Voice" : "Text"}
                          </span>
                        </div>
                        <p className={entry.live && !entry.text ? "italic opacity-70" : ""}>
                          {entry.text || (entry.live ? "Listening..." : "")}
                        </p>
                      </div>
                    </div>
                  );
                }

                if (entry.kind === "confirmation") {
                  return (
                    <div
                      key={entry.id}
                      className={`assistant-entry rounded-[22px] border px-4 py-4 shadow-[0_10px_28px_rgba(16,24,27,0.05)] ${cardToneClasses(entry.card.tone)}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 rounded-full bg-white/70 p-2">
                          <Icon name="warning" size={16} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-semibold tracking-[-0.02em]">
                            {entry.card.title}
                          </p>
                          <p className="mt-2 text-[13.5px] leading-[1.6]">
                            {entry.card.body}
                          </p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={entry.status !== "pending"}
                              onClick={() => void resolveConfirmation(entry, true)}
                              className="btn-solid-sm disabled:cursor-wait"
                            >
                              {entry.status === "working"
                                ? "Confirming"
                                : entry.confirmation.confirm_label}
                            </button>
                            <button
                              type="button"
                              disabled={entry.status !== "pending"}
                              onClick={() => void resolveConfirmation(entry, false)}
                              className="btn-quiet-sm"
                            >
                              {entry.confirmation.cancel_label}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={entry.id}
                    className={`assistant-entry rounded-[22px] border px-4 py-4 shadow-[0_10px_28px_rgba(16,24,27,0.05)] ${cardToneClasses(entry.card.tone)}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-full bg-white/70 p-2">
                        <Icon
                          name={
                            entry.card.tone === "success"
                              ? "check_circle"
                              : entry.card.tone === "warning"
                                ? "warning"
                                : entry.card.tone === "error"
                                  ? "error"
                                  : "auto_awesome"
                          }
                          size={16}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-semibold tracking-[-0.02em]">
                          {entry.card.title}
                        </p>
                        <p className="mt-2 text-[13.5px] leading-[1.6]">
                          {entry.card.body}
                        </p>

                        {entry.card.metrics?.length ? (
                          <div className="mt-4 grid gap-2 sm:grid-cols-2">
                            {entry.card.metrics.map((metric) => (
                              <div
                                key={`${entry.id}:${metric.label}`}
                                className="rounded-[16px] border border-black/5 bg-white/66 px-3 py-2.5"
                              >
                                <p className="text-[11px] uppercase tracking-[0.16em] opacity-60">
                                  {metric.label}
                                </p>
                                <p className="mt-1 text-[17px] font-semibold tracking-[-0.03em]">
                                  {metric.value}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {entry.card.actions?.length ? (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {entry.card.actions.map((action) =>
                              action.href ? (
                                <Link
                                  key={`${entry.id}:${action.label}:${action.href}`}
                                  href={action.href}
                                  className={
                                    action.variant === "quiet"
                                      ? "btn-quiet-sm"
                                      : "btn-solid-sm"
                                  }
                                >
                                  {action.label}
                                </Link>
                              ) : (
                                <span
                                  key={`${entry.id}:${action.label}`}
                                  className={
                                    action.variant === "quiet"
                                      ? "btn-quiet-sm"
                                      : "btn-solid-sm"
                                  }
                                >
                                  {action.label}
                                </span>
                              ),
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <footer className="border-t border-[var(--color-line-1)] bg-white/72 px-5 pb-5 pt-4 backdrop-blur-sm sm:px-6">
          <div className="mb-3 flex items-center justify-between gap-3 text-[12px] tracking-[-0.01em] text-[var(--color-text-3)]">
            <span>
              {voiceLabel}
            </span>
            <span>
              {assistantBusy
                ? "Working through your workspace"
                : "Direct access to Bombsell tools"}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <label className="sr-only" htmlFor="assistant-draft">
                Message Bombsell assistant
              </label>
              <input
                id="assistant-draft"
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
                placeholder="Ask about approvals, signals, blockers, or meeting prep..."
                className="h-12 min-w-0 rounded-full border border-[var(--color-line-1)] bg-white px-4 text-[14px] text-[var(--color-text-1)] outline-none transition focus:border-[var(--color-line-2)]"
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                className="btn-solid h-12 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Icon name="send" size={15} />
                Send
              </button>
            </form>

            <button
              type="button"
              onPointerDown={(event) => void beginVoiceTurn(event)}
              onPointerUp={endVoiceTurn}
              onPointerCancel={endVoiceTurn}
              onPointerLeave={() => {
                if (holdRequestedRef.current) endVoiceTurn();
              }}
              className={
                "inline-flex h-12 items-center justify-center gap-2 rounded-full px-5 text-[13px] font-semibold tracking-[-0.01em] transition " +
                (holdActive
                  ? "bg-[var(--color-cta-bg)] text-[var(--color-cta-text)] shadow-[0_12px_28px_rgba(33,33,33,0.18)]"
                  : "border border-[var(--color-line-1)] bg-white text-[var(--color-text-1)]")
              }
            >
              <Icon name={micState === "blocked" ? "mic_off" : "mic"} size={16} />
              {holdActive ? "Listening" : "Hold to talk"}
            </button>
          </div>
        </footer>
      </aside>
    </>
  );
}

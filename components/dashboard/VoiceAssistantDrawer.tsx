"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Icon from "../Icon";
import type {
  AssistantCard,
  AssistantConfirmationRequest,
  AssistantToolRouteResponse,
} from "../../core/product/assistant/types.ts";
import {
  connectAssistantTranscription,
  type AssistantTranscriptionConnection,
} from "./assistantTransport.ts";
import {
  streamAssistantChat,
  type AssistantChatTurn,
} from "./assistantChat.ts";

type MicState = "unknown" | "ready" | "blocked";

interface MessageEntry {
  kind: "message";
  id: string;
  live: boolean;
  role: "assistant" | "user";
  source: "text" | "voice";
  text: string;
}

interface CardEntry {
  kind: "card";
  id: string;
  card: AssistantCard;
}

interface ConfirmationEntry {
  kind: "confirmation";
  id: string;
  confirmation: AssistantConfirmationRequest;
  status: "pending" | "working" | "resolved";
  card: AssistantCard;
}

type TimelineEntry = MessageEntry | CardEntry | ConfirmationEntry;

const HISTORY_LIMIT = 12;

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
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

function assistantCardEntry(card: AssistantCard): CardEntry {
  return {
    kind: "card",
    id: `card:${card.id}:${crypto.randomUUID()}`,
    card,
  };
}

function historyFromEntries(entries: TimelineEntry[]): AssistantChatTurn[] {
  return entries
    .filter((entry): entry is MessageEntry => entry.kind === "message")
    .filter((entry) => !entry.live && entry.text.trim().length > 0)
    .slice(-HISTORY_LIMIT)
    .map((entry) => ({ role: entry.role, text: entry.text }));
}

export default function VoiceAssistantDrawer() {
  const [draft, setDraft] = useState("");
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [holdActive, setHoldActive] = useState(false);
  const [micState, setMicState] = useState<MicState>("unknown");

  const micRef = useRef<AssistantTranscriptionConnection | null>(null);
  const entriesRef = useRef<TimelineEntry[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const holdRequestedRef = useRef(false);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  function appendLocalStatus(
    input: Pick<AssistantCard, "title" | "body" | "tone">,
  ) {
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
  }

  /**
   * Run one user turn end to end: record the user message, stream the
   * assistant response (text + cards + confirmations) from /api/assistant/chat,
   * and finalize. Voice and text both land here — `source` only affects the
   * label on the user bubble.
   */
  async function streamTurn(rawMessage: string, source: "text" | "voice") {
    const message = rawMessage.trim();
    if (!message || assistantBusy) return;

    setErrorMessage(null);
    setAssistantBusy(true);

    // Cancel any in-flight stream before starting a new turn.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const history = historyFromEntries(entriesRef.current);

    const assistantId = createId("assistant");
    setEntries((current) => [
      ...current,
      {
        kind: "message",
        id: createId("user"),
        role: "user",
        source,
        text: message,
        live: false,
      },
      {
        kind: "message",
        id: assistantId,
        role: "assistant",
        source: "text",
        text: "",
        live: true,
      },
    ]);

    const appendAssistantText = (delta: string) => {
      setEntries((current) =>
        current.map((entry) =>
          entry.kind === "message" && entry.id === assistantId
            ? { ...entry, text: entry.text + delta }
            : entry,
        ),
      );
    };

    const finalizeAssistant = () => {
      setEntries((current) =>
        current
          .map((entry) =>
            entry.kind === "message" && entry.id === assistantId
              ? { ...entry, live: false }
              : entry,
          )
          // Drop an assistant bubble that never received text (answer was
          // delivered entirely as cards).
          .filter(
            (entry) =>
              !(
                entry.kind === "message" &&
                entry.id === assistantId &&
                entry.text.trim().length === 0
              ),
          ),
      );
    };

    try {
      for await (const event of streamAssistantChat({
        message,
        history,
        signal: controller.signal,
      })) {
        if (event.type === "text-delta") {
          appendAssistantText(event.text);
        } else if (event.type === "card") {
          setEntries((current) => [...current, assistantCardEntry(event.card)]);
        } else if (event.type === "confirmation") {
          setEntries((current) => [
            ...current,
            {
              kind: "confirmation",
              id: createId("confirm"),
              confirmation: event.confirmation,
              status: "pending",
              card: event.card,
            },
          ]);
        } else if (event.type === "error") {
          setErrorMessage(event.error);
          appendLocalStatus({
            title: "Assistant error",
            body: event.error,
            tone: "error",
          });
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const detail =
          error instanceof Error ? error.message : "Assistant request failed.";
        setErrorMessage(detail);
        appendLocalStatus({
          title: "Assistant offline",
          body: detail,
          tone: "error",
        });
      }
    } finally {
      finalizeAssistant();
      if (abortRef.current === controller) {
        abortRef.current = null;
        setAssistantBusy(false);
      }
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = draft;
    setDraft("");
    await streamTurn(next, "text");
  }

  async function ensureMic(): Promise<AssistantTranscriptionConnection> {
    if (micRef.current) return micRef.current;

    setErrorMessage(null);
    try {
      const connection = await connectAssistantTranscription({
        onTranscript: (text) => {
          void streamTurn(text, "voice");
        },
        onError: (detail) => setErrorMessage(detail),
        onClose: () => {
          if (micRef.current) {
            micRef.current = null;
            setMicState("unknown");
          }
        },
      });
      micRef.current = connection;
      setMicState("ready");
      return connection;
    } catch (error) {
      setMicState("blocked");
      throw error;
    }
  }

  async function beginVoiceTurn(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (assistantBusy) return;
    holdRequestedRef.current = true;
    setHoldActive(true);
    setErrorMessage(null);

    try {
      const connection = await ensureMic();
      if (holdRequestedRef.current) {
        connection.setMicrophoneEnabled(true);
      }
    } catch (error) {
      holdRequestedRef.current = false;
      setHoldActive(false);
      const detail =
        error instanceof Error
          ? error.message
          : "Microphone access is required for voice.";
      setErrorMessage(detail);
      appendLocalStatus({
        title: "Voice unavailable",
        body: detail,
        tone: "warning",
      });
    }
  }

  function endVoiceTurn() {
    holdRequestedRef.current = false;
    setHoldActive(false);
    micRef.current?.setMicrophoneEnabled(false);
  }

  async function resolveConfirmation(entry: ConfirmationEntry, approve: boolean) {
    if (entry.status !== "pending") return;

    if (!approve) {
      setEntries((current) =>
        current.map((item) =>
          item.kind === "confirmation" && item.id === entry.id
            ? { ...item, status: "resolved" }
            : item,
        ),
      );
      appendLocalStatus({
        title: "Action canceled",
        body: "The assistant did not apply that change.",
        tone: "warning",
      });
      return;
    }

    setEntries((current) =>
      current.map((item) =>
        item.kind === "confirmation" && item.id === entry.id
          ? { ...item, status: "working" }
          : item,
      ),
    );

    try {
      const response = await fetch("/api/assistant/tool", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "confirm",
          confirmation_token: entry.confirmation.token,
        }),
      });
      const result = (await response.json()) as
        | AssistantToolRouteResponse
        | { error?: string };

      if (!response.ok && response.status !== 422) {
        const detail =
          typeof (result as { error?: unknown }).error === "string"
            ? (result as { error: string }).error
            : "Confirmation failed.";
        throw new Error(detail);
      }

      const toolResult = result as AssistantToolRouteResponse;
      setEntries((current) => [
        ...current.map((item) =>
          item.kind === "confirmation" && item.id === entry.id
            ? { ...item, status: "resolved" as const }
            : item,
        ),
        ...toolResult.cards.map((card) => assistantCardEntry(card)),
      ]);
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Confirmation failed.";
      setEntries((current) =>
        current.map((item) =>
          item.kind === "confirmation" && item.id === entry.id
            ? { ...item, status: "pending" }
            : item,
        ),
      );
      setErrorMessage(detail);
      appendLocalStatus({
        title: "Confirmation failed",
        body: detail,
        tone: "error",
      });
    }
  }

  function teardown() {
    abortRef.current?.abort();
    abortRef.current = null;
    micRef.current?.close();
    micRef.current = null;
    setAssistantBusy(false);
    setHoldActive(false);
    holdRequestedRef.current = false;
    setMicState("unknown");
  }

  useEffect(() => {
    if (!drawerOpen) teardown();
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  useEffect(() => {
    return () => teardown();
  }, []);

  const voiceLabel = holdActive ? "Release to send" : "Hold to talk";

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
          {micState === "ready" ? (
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
                Ask about metrics, today&apos;s work, companies targeted, reply
                rate, qualified signals, and meeting prep.
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
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {errorMessage ? (
            <div className="assistant-entry mb-4 rounded-[16px] border border-rose-200 bg-rose-50/90 px-4 py-3 text-[13px] text-rose-900">
              {errorMessage}
            </div>
          ) : null}

          {entries.length === 0 ? (
            <div className="px-1 py-1 text-[13.5px] leading-[1.6] text-[var(--color-text-3)]">
              The assistant reads your live metrics and pulls qualitative
              evidence from the knowledge graph, company memory, and
              conversation proof.
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
                          {entry.text || (entry.live ? "Thinking..." : "")}
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
            <span>{voiceLabel}</span>
            <span>
              {assistantBusy
                ? "Querying your workspace"
                : "Assistant over your live data"}
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
                placeholder="Ask about metrics, signals, blockers, or meeting prep..."
                className="h-12 min-w-0 rounded-full border border-[var(--color-line-1)] bg-white px-4 text-[14px] text-[var(--color-text-1)] outline-none transition focus:border-[var(--color-line-2)]"
              />
              <button
                type="submit"
                disabled={!draft.trim() || assistantBusy}
                className="btn-solid h-12 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Icon name="send" size={15} />
                Send
              </button>
            </form>

            <button
              type="button"
              disabled={assistantBusy}
              onPointerDown={(event) => void beginVoiceTurn(event)}
              onPointerUp={endVoiceTurn}
              onPointerCancel={endVoiceTurn}
              onPointerLeave={() => {
                if (holdRequestedRef.current) endVoiceTurn();
              }}
              className={
                "inline-flex h-12 items-center justify-center gap-2 rounded-full px-5 text-[13px] font-semibold tracking-[-0.01em] transition disabled:cursor-not-allowed disabled:opacity-60 " +
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

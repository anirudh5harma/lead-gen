"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";

type LiveState = "connecting" | "live" | "stale" | "off";
type ConnectionState = Exclude<LiveState, "off">;

export function LiveIndicator({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const state: LiveState = enabled ? connectionState : "off";

  useEffect(() => {
    if (!enabled) return;

    const events = new EventSource("/brief/events");

    function scheduleRefresh(eventType: string) {
      setLastEvent(eventType);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        router.refresh();
      }, 300);
    }

    events.addEventListener("brief.connected", () => setConnectionState("live"));
    events.addEventListener("brief.heartbeat", () => setConnectionState("live"));
    events.onerror = () => setConnectionState("stale");

    const refreshOn = [
      "signal.ingested",
      "play.run.started",
      "play.run.completed",
      "play.run.failed",
      "workflow.step.failed",
      "workflow.run.failed",
      "workflow.run.retried",
      "approval.requested",
      "approval.decided",
      "draft.proposed",
      "draft.judged",
      "draft.rejected",
      "message.queued",
      "message.sent",
      "message.deferred",
      "reply.received",
      "reply.unmatched",
      "reply.classified",
      "outcome.recorded",
      "rep.memory.procedural.updated",
    ];

    for (const eventType of refreshOn) {
      events.addEventListener(eventType, () => scheduleRefresh(eventType));
    }

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      events.close();
    };
  }, [enabled, router]);

  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-[var(--color-line-1)] px-3 py-2 text-sm text-[var(--color-text-2)]">
      <Icon
        name={state === "live" ? "sensors" : state === "stale" ? "sync_problem" : "sensors_off"}
        size={18}
        fill={state === "live"}
      />
      <span className="font-semibold capitalize">{state}</span>
      {lastEvent ? (
        <span className="hidden max-w-40 truncate font-mono text-xs text-[var(--color-text-3)] sm:inline">
          {lastEvent}
        </span>
      ) : null}
    </div>
  );
}

import type { AssistantCard } from "./types.ts";

function card(
  input: Omit<AssistantCard, "id"> & { id?: string },
): AssistantCard {
  return {
    id:
      input.id ??
      `${input.kind}:${input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    kind: input.kind,
    tone: input.tone,
    title: input.title,
    body: input.body,
    metrics: input.metrics,
    actions: input.actions,
  };
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function presentToolResult(
  toolName: string,
  result: Record<string, unknown>,
): AssistantCard[] {
  if (toolName === "get_brief") {
    const windows = (result.windows ?? {}) as Record<string, unknown>;
    const lastDay = (windows.last_24h ?? {}) as Record<string, unknown>;
    const lastWeek = (windows.last_7d ?? {}) as Record<string, unknown>;
    const next = (result.next_action ?? {}) as Record<string, unknown>;
    return [
      card({
        kind: "summary",
        tone: "default",
        title: "Operating brief",
        body:
          asString((next.detail ?? next.label) as unknown) ??
          "Current Bombsell operating summary.",
        metrics: [
          {
            label: "Signals 24h",
            value: String(asNumber(lastDay.qualified_signals) ?? 0),
          },
          {
            label: "Signals 7d",
            value: String(asNumber(lastWeek.qualified_signals) ?? 0),
          },
          {
            label: "Replies 7d",
            value: String(asNumber(lastWeek.replies) ?? 0),
          },
          {
            label: "Meetings 7d",
            value: String(asNumber(lastWeek.meetings) ?? 0),
          },
        ],
        actions: asString(next.href)
          ? [{ label: asString(next.label) ?? "Open next action", href: asString(next.href)!, variant: "solid" }]
          : [{ label: "Open Brief", href: "/dashboard/brief", variant: "solid" }],
      }),
    ];
  }

  if (toolName === "get_launch_readiness") {
    const blockers = Array.isArray(result.blockers) ? result.blockers : [];
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    const checks = Array.isArray(result.checks) ? result.checks : [];
    const firstAction = checks.find((check) =>
      check &&
      typeof check === "object" &&
      check.action &&
      typeof check.action === "object" &&
      typeof (check.action as { surface?: unknown }).surface === "string"
    ) as
      | {
          action?: { label?: string; surface?: string };
        }
      | undefined;
    return [
      card({
        kind: "summary",
        tone: result.launch_ready ? "success" : "warning",
        title: result.launch_ready ? "Launch ready" : "Launch blockers",
        body: result.launch_ready
          ? "Profile, channels, and outreach gates are ready for autonomous work."
          : String(blockers[0] ?? warnings[0] ?? "Bombsell found a launch blocker."),
        metrics: [
          { label: "Checks", value: String(checks.length) },
          { label: "Blockers", value: String(blockers.length) },
          { label: "Warnings", value: String(warnings.length) },
        ],
        actions: firstAction?.action?.surface
          ? [
              {
                label: firstAction.action.label ?? "Open fix",
                href: firstAction.action.surface,
                variant: "solid",
              },
            ]
          : [{ label: "Open Profile", href: "/dashboard/profile", variant: "solid" }],
      }),
    ];
  }

  if (toolName === "list_qualified_signals") {
    const stats = (result.stats ?? {}) as Record<string, unknown>;
    const signals = Array.isArray(result.signals) ? result.signals : [];
    const topTitles = signals
      .slice(0, 3)
      .map((signal) =>
        signal && typeof signal === "object"
          ? asString((signal as { title?: unknown }).title)
          : null
      )
      .filter(Boolean) as string[];
    return [
      card({
        kind: "summary",
        tone: "default",
        title: "Qualified signals",
        body:
          topTitles.length > 0
            ? `Top signals: ${topTitles.join("; ")}`
            : "No qualified signals are ready right now.",
        metrics: [
          { label: "Qualified", value: String(asNumber(stats.qualified) ?? 0) },
          {
            label: "Verified contacts",
            value: String(asNumber(stats.with_verified_contacts) ?? 0),
          },
          {
            label: "Draft-ready",
            value: String(asNumber(stats.ready_for_review) ?? 0),
          },
        ],
        actions: [{ label: "Open Agent", href: "/dashboard/agent#qualified-signals", variant: "solid" }],
      }),
    ];
  }

  if (toolName === "get_workspace_context") {
    const counts = (result.counts ?? {}) as Record<string, unknown>;
    return [
      card({
        kind: "summary",
        tone: "default",
        title: "Workspace context",
        body: "Profile, sources, approvals, conversations, and outcomes are loaded for deeper investigation.",
        metrics: [
          { label: "Reps", value: String(asNumber(counts.reps) ?? 0) },
          { label: "Signals", value: String(asNumber(counts.recent_signals) ?? 0) },
          { label: "Conversations", value: String(asNumber(counts.recent_conversations) ?? 0) },
          { label: "Approvals", value: String(asNumber(counts.pending_approvals) ?? 0) },
        ],
        actions: [
          { label: "Open Profile", href: "/dashboard/profile", variant: "quiet" },
          { label: "Open Agent", href: "/dashboard/agent", variant: "solid" },
        ],
      }),
    ];
  }

  if (toolName === "recall_company_brain") {
    const cards = Array.isArray(result.cards) ? result.cards : [];
    const titles = cards
      .slice(0, 3)
      .map((entry) =>
        entry && typeof entry === "object"
          ? asString((entry as { title?: unknown }).title)
          : null
      )
      .filter(Boolean) as string[];
    return [
      card({
        kind: "summary",
        tone: "default",
        title: "Company brain",
        body:
          titles.length > 0
            ? `Most relevant memory: ${titles.join("; ")}`
            : "Shared company memory is available for deeper context.",
        metrics: [{ label: "Cards", value: String(cards.length) }],
        actions: [{ label: "Open Brief", href: "/dashboard/brief", variant: "solid" }],
      }),
    ];
  }

  if (toolName === "get_conversation_proof") {
    const conversationId = asString(result.conversation_id) ?? asString(result.id);
    return [
      card({
        kind: "summary",
        tone: "default",
        title: "Conversation proof",
        body: "Bombsell loaded the exact signal, draft, channel, and reply trace for this outreach thread.",
        actions: conversationId
          ? [
              {
                label: "Open outreach proof",
                href: `/dashboard/agent/outreach/${conversationId}`,
                variant: "solid",
              },
            ]
          : [{ label: "Open Agent", href: "/dashboard/agent#conversations", variant: "solid" }],
      }),
    ];
  }

  if (toolName === "generate_meeting_prep") {
    const conversationId = asString(result.conversation_id);
    return [
      card({
        kind: "summary",
        tone: result.status === "blocked" ? "warning" : "success",
        title: "Meeting prep",
        body:
          asString(result.summary) ??
          "Bombsell prepared a source-backed meeting brief for this conversation.",
        metrics: [
          {
            label: "Agenda items",
            value: String(Array.isArray(result.agenda) ? result.agenda.length : 0),
          },
          {
            label: "Questions",
            value: String(
              Array.isArray(result.suggested_questions)
                ? result.suggested_questions.length
                : 0,
            ),
          },
        ],
        actions: conversationId
          ? [
              {
                label: "Open outreach proof",
                href: `/dashboard/agent/outreach/${conversationId}`,
                variant: "solid",
              },
            ]
          : [{ label: "Open Agent", href: "/dashboard/agent", variant: "solid" }],
      }),
    ];
  }

  if (toolName === "decide_approval") {
    return [
      card({
        kind: "status",
        tone: "success",
        title: "Approval updated",
        body: "Bombsell recorded the approval decision and kept the existing channel and workflow gates intact.",
        actions: [{ label: "Open review queue", href: "/dashboard/agent#review-queue", variant: "solid" }],
      }),
    ];
  }

  if (toolName === "dispatch_outreach") {
    return [
      card({
        kind: "status",
        tone: "success",
        title: "Outreach dispatched",
        body: `Bombsell started ${String(asNumber(result.dispatched) ?? 0)} outreach workflow${asNumber(result.dispatched) === 1 ? "" : "s"}.`,
        actions: [{ label: "Open Agent", href: "/dashboard/agent#qualified-signals", variant: "solid" }],
      }),
    ];
  }

  return [
    card({
      kind: "status",
      tone: "success",
      title: "Workflow retried",
      body: "Bombsell retried the failed workflow run.",
      actions: [{ label: "Open Health", href: "/dashboard/health", variant: "solid" }],
    }),
  ];
}

export function presentErrorCard(toolName: string, message: string): AssistantCard[] {
  return [
    card({
      kind: "status",
      tone: "error",
      title: `${toolName} failed`,
      body: message,
      actions: [{ label: "Open Agent", href: "/dashboard/agent", variant: "quiet" }],
    }),
  ];
}


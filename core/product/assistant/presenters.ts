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
  const normalizedToolName =
    toolName === "signals_list"
      ? "list_qualified_signals"
      : toolName === "workspace_context"
        ? "get_workspace_context"
        : toolName === "company_brain_recall"
          ? "recall_company_brain"
          : toolName === "conversation_proof"
            ? "get_conversation_proof"
            : toolName === "meeting_prep"
              ? "generate_meeting_prep"
              : toolName;

  if (normalizedToolName === "metrics_get") {
    const metric = asString(result.label) ?? asString(result.metric) ?? "Metric";
    const window = asString(result.window) ?? "selected window";
    const unit = asString(result.unit) ?? "count";
    const numericValue = asNumber(result.value) ?? 0;
    const numerator = asNumber(result.numerator);
    const denominator = asNumber(result.denominator);
    const formattedValue =
      unit === "ratio"
        ? `${Math.round(numericValue * 100)}%`
        : String(Math.round(numericValue));
    return [
      card({
        kind: "summary",
        tone: "default",
        title: metric,
        body: `${metric} for ${window}.`,
        metrics: [
          { label: "Value", value: formattedValue },
          ...(numerator !== null ? [{ label: "Replies", value: String(numerator) }] : []),
          ...(denominator !== null ? [{ label: "Sent", value: String(denominator) }] : []),
        ],
        actions: [{ label: "Open Brief", href: "/dashboard/brief", variant: "solid" }],
      }),
    ];
  }

  if (normalizedToolName === "entities_find") {
    const entityType = asString(result.entity_type) ?? "entity";
    const count = asNumber(result.count) ?? 0;
    const items = Array.isArray(result.items) ? result.items : [];
    const labels = items
      .slice(0, 3)
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        return (
          asString((item as { name?: unknown }).name) ??
          asString((item as { full_name?: unknown }).full_name) ??
          asString((item as { domain?: unknown }).domain)
        );
      })
      .filter(Boolean) as string[];
    return [
      card({
        kind: "summary",
        tone: "default",
        title: `${entityType[0]?.toUpperCase() ?? "E"}${entityType.slice(1)} matches`,
        body:
          labels.length > 0
            ? `Top matches: ${labels.join("; ")}`
            : `No ${entityType} matches found.`,
        metrics: [{ label: "Matches", value: String(count) }],
        actions: [{ label: "Open Agent", href: "/dashboard/agent", variant: "solid" }],
      }),
    ];
  }

  if (normalizedToolName === "entities_get") {
    const entityType = asString(result.entity_type) ?? "entity";
    const entity =
      result.entity && typeof result.entity === "object"
        ? result.entity as Record<string, unknown>
        : null;
    const title =
      (entity &&
        (asString(entity.name) ??
          asString(entity.full_name) ??
          asString(entity.domain))) ||
      `${entityType} details`;
    return [
      card({
        kind: "summary",
        tone: entity ? "default" : "warning",
        title,
        body: entity
          ? `Loaded ${entityType} details from the knowledge graph.`
          : `No ${entityType} found for that id.`,
        actions: [{ label: "Open Agent", href: "/dashboard/agent", variant: "solid" }],
      }),
    ];
  }

  if (normalizedToolName === "get_brief") {
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

  if (normalizedToolName === "get_launch_readiness") {
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

  if (normalizedToolName === "list_qualified_signals") {
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

  if (normalizedToolName === "get_workspace_context") {
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

  if (normalizedToolName === "recall_company_brain") {
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

  if (normalizedToolName === "get_conversation_proof") {
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

  if (normalizedToolName === "generate_meeting_prep") {
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

  if (normalizedToolName === "decide_approval") {
    if (result.ok !== true) {
      return [
        card({
          kind: "status",
          tone: "warning",
          title: "Approval unchanged",
          body: "The approval was missing, already decided, or no longer pending.",
          actions: [{ label: "Open review queue", href: "/dashboard/agent#review-queue", variant: "solid" }],
        }),
      ];
    }
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

  if (normalizedToolName === "update_icp") {
    return [
      card({
        kind: "status",
        tone: "success",
        title: "ICP updated",
        body: "Bombsell updated the ICP text and preserved its matching rules and threshold.",
        actions: [{ label: "Open profile", href: "/dashboard/profile", variant: "solid" }],
      }),
    ];
  }

  if (normalizedToolName === "dispatch_outreach") {
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

import { z } from "zod";
import { invokeTool, registerTool } from "../agents/tools/registry.ts";
import type { ToolContext } from "../agents/tools/types.ts";

const WorkspaceResultSchema = z.object({
  workspace_id: z.string().uuid(),
});

const CountWindowSchema = z.object({
  qualified_signals: z.number().int().nonnegative(),
  emails_sent: z.number().int().nonnegative(),
  linkedin_touches_sent: z.number().int().nonnegative(),
  replies: z.number().int().nonnegative(),
  meetings: z.number().int().nonnegative(),
});

const BombsellBriefSchema = WorkspaceResultSchema.extend({
  generated_at: z.string().datetime(),
  windows: z.object({
    last_24h: CountWindowSchema,
    last_7d: CountWindowSchema.extend({
      useful_outcomes: z.number().int().nonnegative(),
    }),
  }),
  signal_types: z.array(
    z.object({
      kind: z.string(),
      count_24h: z.number().int().nonnegative(),
      count_7d: z.number().int().nonnegative(),
      with_contacts_7d: z.number().int().nonnegative(),
      with_drafts_7d: z.number().int().nonnegative(),
    }),
  ),
  channel_readiness: z.object({
    email_connected: z.boolean(),
    linkedin_connected: z.boolean(),
    connected_count: z.number().int().nonnegative(),
  }),
  operations: z.object({
    pending_reviews: z.number().int().nonnegative(),
    unhealthy_channels: z.number().int().nonnegative(),
    bounced_24h: z.number().int().nonnegative(),
  }),
  next_action: z.object({
    key: z.string(),
    label: z.string(),
    detail: z.string(),
    href: z.string(),
  }),
  source_tool: z.literal("product.brief.get"),
});

const BombsellLaunchCheckSchema = WorkspaceResultSchema.extend({
  checked_at: z.string().datetime(),
  status: z.string(),
  launch_ready: z.boolean(),
  next_action: z.string(),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  checks: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      status: z.string(),
      required: z.boolean(),
      detail: z.string(),
      count: z.number().int().nonnegative(),
      surface: z.string().nullable(),
    }),
  ),
  source_tool: z.literal("product.launch.readiness.get"),
});

const SentOutreachSchema = WorkspaceResultSchema.extend({
  generated_at: z.string().datetime(),
  count: z.number().int().nonnegative(),
  outreach: z.array(
    z.object({
      message_id: z.string().uuid(),
      conversation_id: z.string().uuid(),
      channel: z.string(),
      status: z.string(),
      subject: z.string().nullable(),
      body_preview: z.string().nullable(),
      sent_at: z.string().datetime().nullable(),
      created_at: z.string().datetime(),
      eval_score: z.number().nullable(),
      eval_passed: z.boolean().nullable(),
      person_name: z.string().nullable(),
      company_name: z.string().nullable(),
      signal_title: z.string().nullable(),
      signal_kind: z.string().nullable(),
      href: z.string(),
    }),
  ),
  source_tool: z.literal("product.state.get"),
});

const DraftSchema = WorkspaceResultSchema.extend({
  message: z
    .object({
      message_id: z.string().uuid(),
      conversation_id: z.string().uuid(),
      channel: z.string(),
      direction: z.string(),
      status: z.string(),
      subject: z.string().nullable(),
      body: z.string().nullable(),
      sent_at: z.string().datetime().nullable(),
      created_at: z.string().datetime(),
      eval_score: z.number().nullable(),
      eval_passed: z.boolean().nullable(),
      eval_notes: z.record(z.string(), z.unknown()).nullable(),
      provenance: z.record(z.string(), z.unknown()),
      href: z.string(),
    })
    .nullable(),
  source_tool: z.literal("product.state.get"),
});

const ApprovalListSchema = WorkspaceResultSchema.extend({
  generated_at: z.string().datetime(),
  pending_count: z.number().int().nonnegative(),
  approvals: z.array(
    z.object({
      approval_id: z.string().uuid(),
      run_id: z.string(),
      kind: z.string(),
      reason: z.string().nullable(),
      decision: z.string(),
      created_at: z.string().datetime(),
      payload_keys: z.array(z.string()),
    }),
  ),
  source_tool: z.literal("product.state.get"),
});

const ApprovalDecisionSchema = WorkspaceResultSchema.extend({
  approval_id: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  ok: z.boolean(),
  next_action: z.enum(["refresh_approvals", "inspect_agent"]),
  source_tool: z.literal("product.approval.decide"),
});

const LearningSchema = WorkspaceResultSchema.extend({
  generated_at: z.string().datetime(),
  recent_outcome_count: z.number().int().nonnegative(),
  useful_outcome_count: z.number().int().nonnegative(),
  counts_by_kind: z.record(z.string(), z.number().int().nonnegative()),
  recent_outcomes: z.array(
    z.object({
      outcome_id: z.string().uuid(),
      kind: z.string(),
      score: z.number(),
      conversation_id: z.string().uuid().nullable(),
      attributed_message_id: z.string().uuid().nullable(),
      attributed_signal_id: z.string().uuid().nullable(),
      occurred_at: z.string().datetime(),
      recorded_at: z.string().datetime(),
    }),
  ),
  source_tool: z.literal("product.state.get"),
});

const SignalContactSummarySchema = z.object({
  person_id: z.string().min(1),
  full_name: z.string().min(1),
  title: z.string().nullable(),
  linkedin_url: z.string().nullable(),
  email_verified: z.boolean(),
  email_status: z.string().nullable(),
  linkedin_ready: z.boolean(),
  contact_fit_decision: z.enum(["fit", "unsure", "not_fit"]).nullable(),
  reasons: z.array(z.string()),
});

const SignalDraftSummarySchema = z.object({
  message_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  channel: z.string(),
  status: z.string(),
  subject: z.string().nullable(),
  eval_score: z.number().nullable(),
  eval_passed: z.boolean().nullable(),
  pending_approval_id: z.string().uuid().nullable(),
  defer_reason: z.string().nullable(),
  href: z.string(),
});

const QualifiedSignalSummarySchema = z.object({
  signal_id: z.string().uuid(),
  kind: z.string(),
  status: z.string(),
  title: z.string(),
  company_name: z.string().nullable(),
  company_domain: z.string().nullable(),
  match_score: z.number().nullable(),
  matched_at: z.string().datetime().nullable(),
  contact_source: z.enum(["resolution", "graph", "none"]),
  contact_defer_reason: z.string().nullable(),
  contact_counts: z.object({
    total: z.number().int().nonnegative(),
    email_verified: z.number().int().nonnegative(),
    linkedin_ready: z.number().int().nonnegative(),
    needs_fit_review: z.number().int().nonnegative(),
    blocked_by_fit: z.number().int().nonnegative(),
  }),
  contacts: z.array(SignalContactSummarySchema),
  outreach_draft: SignalDraftSummarySchema.nullable(),
  href: z.string(),
});

const QualifiedSignalsAliasSchema = WorkspaceResultSchema.extend({
  generated_at: z.string().datetime(),
  stats: z.object({
    qualified: z.number().int().nonnegative(),
    with_verified_contacts: z.number().int().nonnegative(),
    with_outreach_draft: z.number().int().nonnegative(),
    with_email_draft: z.number().int().nonnegative(),
    ready_for_review: z.number().int().nonnegative(),
    blocked_by_fit: z.number().int().nonnegative(),
  }),
  signals: z.array(QualifiedSignalSummarySchema),
  source_tool: z.literal("product.qualified_signals.list"),
});

const ContactLanesSchema = WorkspaceResultSchema.extend({
  generated_at: z.string().datetime(),
  lane_counts: z.object({
    email_verified: z.number().int().nonnegative(),
    linkedin_ready: z.number().int().nonnegative(),
    draft_ready: z.number().int().nonnegative(),
    needs_contact_resolution: z.number().int().nonnegative(),
    needs_fit_review: z.number().int().nonnegative(),
    blocked_by_fit: z.number().int().nonnegative(),
  }),
  lanes: z.object({
    email_verified: z.array(QualifiedSignalSummarySchema),
    linkedin_ready: z.array(QualifiedSignalSummarySchema),
    draft_ready: z.array(QualifiedSignalSummarySchema),
    needs_contact_resolution: z.array(QualifiedSignalSummarySchema),
    needs_fit_review: z.array(QualifiedSignalSummarySchema),
    blocked_by_fit: z.array(QualifiedSignalSummarySchema),
  }),
  source_tool: z.literal("product.qualified_signals.list"),
});

interface OperatingBrief {
  workspace_id: string;
  generated_at: string;
  windows: {
    last_24h: z.infer<typeof CountWindowSchema>;
    last_7d: z.infer<typeof CountWindowSchema> & { useful_outcomes: number };
  };
  operations: z.infer<typeof BombsellBriefSchema>["operations"];
  channel_readiness: z.infer<typeof BombsellBriefSchema>["channel_readiness"];
  signal_types: z.infer<typeof BombsellBriefSchema>["signal_types"];
  next_action: z.infer<typeof BombsellBriefSchema>["next_action"];
}

interface ProductState {
  workspace_id?: string;
  bootstrap?: { workspace_id?: string };
  approvals?: Array<{
    id: string;
    run_id: string;
    kind: string;
    reason: string | null;
    payload: Record<string, unknown>;
    decision: string;
    created_at: string;
  }>;
  sendTraces?: Array<{
    message_id: string;
    person_name: string | null;
    company_name: string | null;
    signal_title: string | null;
    signal_kind: string | null;
  }>;
  messages?: Array<{
    id: string;
    conversation_id: string;
    channel: string;
    direction: string;
    status: string;
    subject: string | null;
    body: string | null;
    sent_at: string | null;
    created_at: string;
    eval_score: number | null;
    eval_passed: boolean | null;
    eval_notes: Record<string, unknown> | null;
    provenance: Record<string, unknown>;
  }>;
  outcomes?: Array<{
    id: string;
    kind: string;
    score: number;
    conversation_id: string | null;
    attributed_message_id: string | null;
    attributed_signal_id: string | null;
    occurred_at: string;
    recorded_at: string;
  }>;
}

interface LaunchReadiness {
  workspace_id: string;
  checked_at: string;
  status: string;
  launch_ready: boolean;
  next_action: string;
  blockers: string[];
  warnings: string[];
  checks: Array<{
    id: string;
    label: string;
    status: string;
    required: boolean;
    detail: string;
    count: number;
    action: { surface: string } | null;
  }>;
}

interface QualifiedSignalWorkbenchResult {
  workspace_id: string;
  generated_at: string;
  stats: z.infer<typeof QualifiedSignalsAliasSchema>["stats"];
  signals: Array<{
    id: string;
    kind: string;
    status: string;
    title: string;
    company: {
      name: string | null;
      domain: string | null;
    };
    match_score: number | null;
    matched_at: string | null;
    contact_source: "resolution" | "graph" | "none";
    contact_defer_reason: string | null;
    contacts: Array<{
      person_id: string;
      full_name: string;
      title: string | null;
      linkedin_url: string | null;
      contact_fit_decision: "fit" | "unsure" | "not_fit" | null;
      reasons: string[];
      verification: {
        email_verified?: boolean | null;
        email_status?: string | null;
        linkedin_ready?: boolean | null;
      };
    }>;
    outreach_draft: {
      message_id: string;
      conversation_id: string;
      channel: string;
      status: string;
      subject: string | null;
      eval_score: number | null;
      eval_passed: boolean | null;
      pending_approval_id: string | null;
      defer_reason: string | null;
    } | null;
  }>;
}

let registered = false;

export function registerBombsellAliasTools(): void {
  if (registered) return;
  registered = true;

  registerTool({
    name: "bombsell.brief.get",
    description:
      "Get Bombsell's concise operating Brief for Claude Code: 24h/7d qualified signals, signal types, email/LinkedIn sends, replies, meetings, blockers, and next action.",
    kind: "read",
    input: z.object({}),
    output: BombsellBriefSchema,
    async handler(_input, ctx) {
      const brief = await invokeTool<OperatingBrief>(
        "product.brief.get",
        {},
        ctx,
      );
      return { ...brief, source_tool: "product.brief.get" as const };
    },
  });

  registerTool({
    name: "bombsell.launch.check",
    description:
      "Check whether Bombsell can move from Profile to qualified signals, verified contacts, and judged email/LinkedIn outreach.",
    kind: "read",
    input: z.object({
      required_channel: z.enum(["any", "email", "linkedin", "both"]).optional(),
    }),
    output: BombsellLaunchCheckSchema,
    async handler(input, ctx) {
      const readiness = await invokeTool<LaunchReadiness>(
        "product.launch.readiness.get",
        input,
        ctx,
      );
      return {
        workspace_id: readiness.workspace_id,
        checked_at: readiness.checked_at,
        status: readiness.status,
        launch_ready: readiness.launch_ready,
        next_action: readiness.next_action,
        blockers: readiness.blockers,
        warnings: readiness.warnings,
        checks: readiness.checks.map((check) => ({
          id: check.id,
          label: check.label,
          status: check.status,
          required: check.required,
          detail: check.detail,
          count: check.count,
          surface: check.action?.surface ?? null,
        })),
        source_tool: "product.launch.readiness.get" as const,
      };
    },
  });

  registerTool({
    name: "bombsell.outreach.list_sent",
    description:
      "List recent sent Bombsell email and LinkedIn outreach with contact, signal, judged draft, and dashboard links.",
    kind: "read",
    input: z.object({
      limit: z.number().int().min(1).max(25).optional(),
    }),
    output: SentOutreachSchema,
    async handler(input, ctx) {
      const state = await productState(ctx);
      const tracesByMessage = new Map(
        (state.sendTraces ?? []).map((trace) => [trace.message_id, trace]),
      );
      const outreach = (state.messages ?? [])
        .filter(
          (message) =>
            message.direction === "outbound" &&
            ["sent", "delivered", "replied"].includes(message.status),
        )
        .sort((a, b) =>
          (b.sent_at ?? b.created_at).localeCompare(a.sent_at ?? a.created_at),
        )
        .slice(0, input.limit ?? 10)
        .map((message) => {
          const trace = tracesByMessage.get(message.id);
          return {
            message_id: message.id,
            conversation_id: message.conversation_id,
            channel: message.channel,
            status: message.status,
            subject: message.subject,
            body_preview: preview(message.body),
            sent_at: message.sent_at,
            created_at: message.created_at,
            eval_score: message.eval_score,
            eval_passed: message.eval_passed,
            person_name: trace?.person_name ?? null,
            company_name: trace?.company_name ?? null,
            signal_title: trace?.signal_title ?? null,
            signal_kind: trace?.signal_kind ?? null,
            href: `/dashboard/conversations/${message.conversation_id}?message=${message.id}`,
          };
        });
      return {
        workspace_id: workspaceIdFromState(state, ctx),
        generated_at: new Date().toISOString(),
        count: outreach.length,
        outreach,
        source_tool: "product.state.get" as const,
      };
    },
  });

  registerTool({
    name: "bombsell.draft.get",
    description:
      "Get one Bombsell outreach draft or sent message body by message id, including eval result and dashboard link.",
    kind: "read",
    input: z.object({
      message_id: z.string().uuid(),
    }),
    output: DraftSchema,
    async handler(input, ctx) {
      const state = await productState(ctx);
      const message = (state.messages ?? []).find(
        (row) => row.id === input.message_id,
      );
      return {
        workspace_id: workspaceIdFromState(state, ctx),
        message: message
          ? {
              message_id: message.id,
              conversation_id: message.conversation_id,
              channel: message.channel,
              direction: message.direction,
              status: message.status,
              subject: message.subject,
              body: message.body,
              sent_at: message.sent_at,
              created_at: message.created_at,
              eval_score: message.eval_score,
              eval_passed: message.eval_passed,
              eval_notes: message.eval_notes,
              provenance: message.provenance,
              href: `/dashboard/conversations/${message.conversation_id}?message=${message.id}`,
            }
          : null,
        source_tool: "product.state.get" as const,
      };
    },
  });

  registerTool({
    name: "bombsell.signals.list_qualified",
    description:
      "List qualified Bombsell signals with compact verified-contact and outreach-draft readiness for Claude Code workflows.",
    kind: "read",
    input: z.object({
      limit: z.number().int().min(1).max(25).optional(),
    }),
    output: QualifiedSignalsAliasSchema,
    async handler(input, ctx) {
      const workbench = await qualifiedSignalWorkbench(input.limit, ctx);
      return {
        workspace_id: workbench.workspace_id,
        generated_at: workbench.generated_at,
        stats: workbench.stats,
        signals: summarizeQualifiedSignals(workbench.signals),
        source_tool: "product.qualified_signals.list" as const,
      };
    },
  });

  registerTool({
    name: "bombsell.contact_lanes.get",
    description:
      "Group qualified Bombsell signals into contact lanes: verified email, LinkedIn-ready, draft-ready, needs contact resolution, needs fit review, and blocked by fit.",
    kind: "read",
    input: z.object({
      limit: z.number().int().min(1).max(25).optional(),
    }),
    output: ContactLanesSchema,
    async handler(input, ctx) {
      const workbench = await qualifiedSignalWorkbench(input.limit, ctx);
      const signals = summarizeQualifiedSignals(workbench.signals);
      const lanes = {
        email_verified: signals.filter(
          (signal) => signal.contact_counts.email_verified > 0,
        ),
        linkedin_ready: signals.filter(
          (signal) => signal.contact_counts.linkedin_ready > 0,
        ),
        draft_ready: signals.filter((signal) =>
          isDraftReady(signal.outreach_draft)
        ),
        needs_contact_resolution: signals.filter(
          (signal) => signal.contact_counts.total === 0,
        ),
        needs_fit_review: signals.filter(
          (signal) => signal.contact_counts.needs_fit_review > 0,
        ),
        blocked_by_fit: signals.filter(
          (signal) => signal.contact_counts.blocked_by_fit > 0,
        ),
      };
      return {
        workspace_id: workbench.workspace_id,
        generated_at: workbench.generated_at,
        lane_counts: {
          email_verified: lanes.email_verified.length,
          linkedin_ready: lanes.linkedin_ready.length,
          draft_ready: lanes.draft_ready.length,
          needs_contact_resolution: lanes.needs_contact_resolution.length,
          needs_fit_review: lanes.needs_fit_review.length,
          blocked_by_fit: lanes.blocked_by_fit.length,
        },
        lanes,
        source_tool: "product.qualified_signals.list" as const,
      };
    },
  });

  registerTool({
    name: "bombsell.approvals.list",
    description:
      "List pending Bombsell approval gates for drafts, channel work, and recovery so Claude Code can route the user to the next review.",
    kind: "read",
    input: z.object({
      limit: z.number().int().min(1).max(25).optional(),
    }),
    output: ApprovalListSchema,
    async handler(input, ctx) {
      const state = await productState(ctx);
      const approvals = (state.approvals ?? [])
        .filter((approval) => approval.decision === "pending")
        .slice(0, input.limit ?? 10)
        .map((approval) => ({
          approval_id: approval.id,
          run_id: approval.run_id,
          kind: approval.kind,
          reason: approval.reason,
          decision: approval.decision,
          created_at: approval.created_at,
          payload_keys: Object.keys(approval.payload ?? {}).sort(),
        }));
      return {
        workspace_id: workspaceIdFromState(state, ctx),
        generated_at: new Date().toISOString(),
        pending_count: approvals.length,
        approvals,
        source_tool: "product.state.get" as const,
      };
    },
  });

  registerTool({
    name: "bombsell.approvals.decide",
    description:
      "Approve or reject one Bombsell approval gate from Claude Code. Approvals require confirm_channel_effects=true because approved work can continue through Bombsell's channel, readiness, and eval-gated workflow.",
    kind: "write",
    input: z.object({
      approval_id: z.string().uuid(),
      decision: z.enum(["approved", "rejected"]),
      note: z.string().min(1).max(500).optional(),
      confirm_channel_effects: z.boolean().optional(),
    }),
    output: ApprovalDecisionSchema,
    async handler(input, ctx) {
      if (input.decision === "approved" && input.confirm_channel_effects !== true) {
        throw new Error(
          "Approving a Bombsell gate can continue outreach through channel workflows. Set confirm_channel_effects=true to approve explicitly.",
        );
      }
      const result = await invokeTool<{ ok: true }>(
        "product.approval.decide",
        {
          approval_id: input.approval_id,
          decision: input.decision,
          note: input.note,
        },
        ctx,
      );
      return {
        workspace_id: ctx.workspace_id,
        approval_id: input.approval_id,
        decision: input.decision,
        ok: result.ok,
        next_action: (
          input.decision === "approved" ? "inspect_agent" : "refresh_approvals"
        ) as "inspect_agent" | "refresh_approvals",
        source_tool: "product.approval.decide" as const,
      };
    },
  });

  registerTool({
    name: "bombsell.learning.get",
    description:
      "Summarize recent Bombsell reply and meeting learning so Claude Code can see what signals, channels, and outreach are working.",
    kind: "read",
    input: z.object({
      limit: z.number().int().min(1).max(25).optional(),
    }),
    output: LearningSchema,
    async handler(input, ctx) {
      const state = await productState(ctx);
      const outcomes = (state.outcomes ?? []).slice(0, input.limit ?? 10);
      const counts = outcomes.reduce<Record<string, number>>((acc, outcome) => {
        acc[outcome.kind] = (acc[outcome.kind] ?? 0) + 1;
        return acc;
      }, {});
      return {
        workspace_id: workspaceIdFromState(state, ctx),
        generated_at: new Date().toISOString(),
        recent_outcome_count: outcomes.length,
        useful_outcome_count: outcomes.filter((outcome) => outcome.score > 0)
          .length,
        counts_by_kind: counts,
        recent_outcomes: outcomes.map((outcome) => ({
          outcome_id: outcome.id,
          kind: outcome.kind,
          score: outcome.score,
          conversation_id: outcome.conversation_id,
          attributed_message_id: outcome.attributed_message_id,
          attributed_signal_id: outcome.attributed_signal_id,
          occurred_at: outcome.occurred_at,
          recorded_at: outcome.recorded_at,
        })),
        source_tool: "product.state.get" as const,
      };
    },
  });
}

export function _resetBombsellAliasToolsRegistration(): void {
  registered = false;
}

async function qualifiedSignalWorkbench(
  limit: number | undefined,
  ctx: ToolContext,
): Promise<QualifiedSignalWorkbenchResult> {
  return invokeTool<QualifiedSignalWorkbenchResult>(
    "product.qualified_signals.list",
    { limit },
    ctx,
  );
}

function summarizeQualifiedSignals(
  signals: QualifiedSignalWorkbenchResult["signals"],
): Array<z.infer<typeof QualifiedSignalSummarySchema>> {
  return signals.map((signal) => {
    const contacts = signal.contacts.map(summarizeContact);
    const counts = contactCounts(contacts);
    return {
      signal_id: signal.id,
      kind: signal.kind,
      status: signal.status,
      title: signal.title,
      company_name: signal.company.name,
      company_domain: signal.company.domain,
      match_score: signal.match_score,
      matched_at: signal.matched_at,
      contact_source: signal.contact_source,
      contact_defer_reason: signal.contact_defer_reason,
      contact_counts: counts,
      contacts,
      outreach_draft: summarizeDraft(signal.outreach_draft),
      href: "/dashboard/agent#opportunities",
    };
  });
}

function summarizeContact(
  contact: QualifiedSignalWorkbenchResult["signals"][number]["contacts"][number],
): z.infer<typeof SignalContactSummarySchema> {
  return {
    person_id: contact.person_id,
    full_name: contact.full_name,
    title: contact.title,
    linkedin_url: contact.linkedin_url,
    email_verified: contact.verification.email_verified === true,
    email_status: contact.verification.email_status ?? null,
    linkedin_ready: contact.verification.linkedin_ready === true,
    contact_fit_decision: contact.contact_fit_decision,
    reasons: contact.reasons,
  };
}

function contactCounts(
  contacts: Array<z.infer<typeof SignalContactSummarySchema>>,
): z.infer<typeof QualifiedSignalSummarySchema>["contact_counts"] {
  return {
    total: contacts.length,
    email_verified: contacts.filter((contact) => contact.email_verified).length,
    linkedin_ready: contacts.filter((contact) => contact.linkedin_ready).length,
    needs_fit_review: contacts.filter((contact) =>
      contact.contact_fit_decision === null ||
      contact.contact_fit_decision === "unsure"
    ).length,
    blocked_by_fit: contacts.filter(
      (contact) => contact.contact_fit_decision === "not_fit",
    ).length,
  };
}

function summarizeDraft(
  draft: QualifiedSignalWorkbenchResult["signals"][number]["outreach_draft"],
): z.infer<typeof SignalDraftSummarySchema> | null {
  if (!draft) return null;
  return {
    message_id: draft.message_id,
    conversation_id: draft.conversation_id,
    channel: draft.channel,
    status: draft.status,
    subject: draft.subject,
    eval_score: draft.eval_score,
    eval_passed: draft.eval_passed,
    pending_approval_id: draft.pending_approval_id,
    defer_reason: draft.defer_reason,
    href: `/dashboard/conversations/${draft.conversation_id}?message=${draft.message_id}`,
  };
}

function isDraftReady(
  draft: z.infer<typeof SignalDraftSummarySchema> | null,
): boolean {
  if (!draft || draft.eval_passed === false) return false;
  return Boolean(draft.pending_approval_id) ||
    draft.status === "draft" ||
    draft.status === "deferred";
}

async function productState(ctx: ToolContext): Promise<ProductState> {
  return invokeTool<ProductState>("product.state.get", {}, ctx);
}

function workspaceIdFromState(state: ProductState, ctx: ToolContext): string {
  return state.workspace_id ?? state.bootstrap?.workspace_id ?? ctx.workspace_id;
}

function preview(value: string | null): string | null {
  if (!value) return null;
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= 240) return compact;
  return `${compact.slice(0, 237)}...`;
}

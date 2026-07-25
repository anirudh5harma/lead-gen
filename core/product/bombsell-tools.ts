import { z } from "zod";
import { invokeTool, registerTool } from "../agents/tools/registry.ts";
import type { ToolContext } from "../agents/tools/types.ts";
import {
  buildOutputDestinations,
  OutputDestinationSchema,
} from "./output-destinations.ts";

const WorkspaceResultSchema = z.object({
  workspace_id: z.string().uuid(),
});

const CountWindowSchema = z.object({
  qualified_signals: z.number().int().nonnegative(),
  emails_sent: z.number().int().nonnegative(),
  linkedin_dms_sent: z.number().int().nonnegative(),
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
      approval_id: z.string().min(1).max(2048),
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
  approval_id: z.string().min(1).max(2048),
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

const ProfileSignalKindSchema = z.enum([
  "funding",
  "hiring",
  "leadership_change",
  "product_launch",
  "acquisition",
  "churn_risk",
  "competitor_move",
  "podcast_mention",
  "press_mention",
  "regulation",
  "expansion",
  "layoff",
  "other",
]);

const ProfileProposalSchema = WorkspaceResultSchema.extend({
  generated_at: z.string().datetime(),
  mode: z.literal("proposal_only"),
  profile_patch: z.object({
    company_name: z.string().nullable(),
    website_url: z.string().nullable(),
    industry: z.string().nullable(),
    description: z.string().nullable(),
    value_proposition: z.string().nullable(),
    customer_pain_points: z.string().nullable(),
    target_titles: z.string().nullable(),
    target_markets: z.string().nullable(),
    key_features: z.string().nullable(),
    social_proof: z.string().nullable(),
    signal_keywords: z.string().nullable(),
    competitor_watchlist: z.string().nullable(),
    linkedin_signal_behaviors: z.string().nullable(),
    exclusion_rules: z.string().nullable(),
    preferred_language: z.string().nullable(),
    outreach_goal: z.string().nullable(),
    message_tone: z.string().nullable(),
    profile_source: z.literal("manual"),
  }),
  icp_draft: z.object({
    name: z.string(),
    description: z.string(),
    signal_kind: ProfileSignalKindSchema,
    match_threshold: z.number().min(0).max(1),
    nice_to_haves: z.array(z.string()),
    enabled: z.boolean(),
  }),
  source_recommendations: z.array(
    z.object({
      label: z.string(),
      kind: z.string(),
      reason: z.string(),
      value: z.string(),
    }),
  ),
  apply_plan: z.array(
    z.object({
      tool_name: z.string(),
      requires_confirmation: z.literal(true),
      input: z.record(z.string(), z.unknown()),
    }),
  ),
  missing_context: z.array(z.string()),
  existing_context_excerpt: z.string().nullable(),
  next_action: z.object({
    label: z.string(),
    detail: z.string(),
    href: z.string(),
  }),
  source_tool: z.literal("product.context.get"),
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
  pending_approval_id: z.string().min(1).max(2048).nullable(),
  defer_reason: z.string().nullable(),
  href: z.string(),
});

const SignalNextHandoffSchema = z.object({
  label: z.string(),
  detail: z.string(),
  href: z.string(),
  stage: z.enum([
    "review_draft",
    "email_outreach",
    "linkedin_outreach",
    "verify_email",
    "resolve_contact",
    "review_fit",
    "blocked_by_fit",
  ]),
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
  next_handoff: SignalNextHandoffSchema,
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

const CrmHandoffRecordSchema = z.object({
  signal_id: z.string().uuid(),
  signal_kind: z.string(),
  signal_title: z.string(),
  match_score: z.number().nullable(),
  match_reason: z.string().nullable(),
  company: z.object({
    company_id: z.string().uuid().nullable(),
    name: z.string().nullable(),
    domain: z.string().nullable(),
    industry: z.string().nullable(),
  }),
  contact: z.object({
    person_id: z.string().uuid(),
    full_name: z.string(),
    title: z.string().nullable(),
    email: z.string().nullable(),
    email_verified: z.boolean(),
    email_status: z.string().nullable(),
    linkedin_url: z.string().nullable(),
    linkedin_ready: z.boolean(),
    contact_fit_decision: z.enum(["fit", "unsure", "not_fit"]).nullable(),
  }),
  outreach: z
    .object({
      conversation_id: z.string().uuid(),
      message_id: z.string().uuid(),
      channel: z.string(),
      status: z.string(),
      eval_score: z.number().nullable(),
      eval_passed: z.boolean().nullable(),
      sent_at: z.string().datetime().nullable(),
    })
    .nullable(),
  outcomes: z.array(
    z.object({
      outcome_id: z.string().uuid(),
      kind: z.string(),
      score: z.number(),
      occurred_at: z.string().datetime(),
    }),
  ),
});

const CrmHandoffQueueAliasSchema = WorkspaceResultSchema.extend({
  generated_at: z.string().datetime(),
  handoff_id: z.string().uuid(),
  channel_account_id: z.string().uuid(),
  provider: z.string(),
  sync_mode: z.enum([
    "qualified_contacts",
    "qualified_and_sent",
    "full_loop",
  ]),
  queued_records: z.number().int().nonnegative(),
  skipped_records: z.number().int().nonnegative(),
  event_id: z.string().uuid(),
  records: z.array(CrmHandoffRecordSchema),
  delivery: z.object({
    status: z.enum(["delivered", "failed", "not_configured"]),
    event_id: z.string().uuid().nullable(),
    status_code: z.number().int().nullable(),
    error: z.string().nullable(),
    webhook_url_configured: z.boolean(),
  }),
  next_action: z.object({
    label: z.string(),
    detail: z.string(),
    href: z.string(),
  }),
  source_tool: z.literal("product.crm_handoff.queue"),
});

const IntegrationsAliasSchema = WorkspaceResultSchema.extend({
  generated_at: z.string().datetime(),
  native_channels_ready: z.number().int().nonnegative(),
  launch_ready: z.boolean(),
  next_action: z.object({
    label: z.string(),
    detail: z.string(),
    href: z.string(),
  }),
  destinations: z.array(OutputDestinationSchema),
  source_tools: z.tuple([
    z.literal("product.brief.get"),
    z.literal("product.launch.readiness.get"),
    z.literal("product.state.get"),
  ]),
});

const OutreachPrepareSchema = WorkspaceResultSchema.extend({
  generated_at: z.string().datetime(),
  requested_limit: z.number().int().positive(),
  dispatched: z.number().int().nonnegative(),
  before: z.object({
    qualified: z.number().int().nonnegative(),
    ready_for_review: z.number().int().nonnegative(),
  }),
  after: z.object({
    qualified: z.number().int().nonnegative(),
    ready_for_review: z.number().int().nonnegative(),
    with_outreach_draft: z.number().int().nonnegative(),
  }),
  review_ready_signals: z.array(QualifiedSignalSummarySchema),
  next_action: z.object({
    label: z.string(),
    detail: z.string(),
    href: z.string(),
  }),
  source_tool: z.literal("product.signals.dispatch_plays"),
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
  channelAccounts?: Array<{
    kind: string;
    status: string;
  }>;
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

interface WorkspaceAgentContextSummary {
  workspace_id: string;
  generated_at?: string;
  markdown?: string;
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
      "Get Bombsell's concise operating Brief for Claude Code: 24h/7d qualified signals, signal types, sent emails, sent LinkedIn DMs/InMail, replies, meetings, blockers, and next action.",
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
    name: "bombsell.profile.propose_from_context",
    description:
      "Propose Bombsell Profile, buyer-fit, and source updates from Claude Code repo context. Proposal-only: returns the product tools to apply after user confirmation and does not write workspace state.",
    kind: "read",
    input: z.object({
      repo_context: z.string().min(1).max(12_000),
      company_name: z.string().min(1).optional(),
      website_url: z.string().min(1).optional(),
      industry: z.string().min(1).optional(),
      description: z.string().min(1).optional(),
      value_proposition: z.string().min(1).optional(),
      customer_pain_points: z.string().min(1).optional(),
      target_titles: z.string().min(1).optional(),
      target_markets: z.string().min(1).optional(),
      key_features: z.string().min(1).optional(),
      social_proof: z.string().min(1).optional(),
      signal_keywords: z.string().min(1).optional(),
      competitor_watchlist: z.string().min(1).optional(),
      linkedin_signal_behaviors: z.string().min(1).optional(),
      exclusion_rules: z.string().min(1).optional(),
      preferred_language: z.string().min(1).optional(),
      outreach_goal: z.string().min(1).optional(),
      message_tone: z.string().min(1).optional(),
      integrations: z.array(z.string().min(1)).max(20).optional(),
      source_urls: z.array(z.string().min(1)).max(20).optional(),
    }),
    output: ProfileProposalSchema,
    async handler(input, ctx) {
      const context = await invokeTool<WorkspaceAgentContextSummary>(
        "product.context.get",
        {},
        ctx,
      );
      const profilePatch = {
        company_name: clean(input.company_name),
        website_url: clean(input.website_url),
        industry: clean(input.industry),
        description: clean(input.description) ?? preview(input.repo_context),
        value_proposition: clean(input.value_proposition),
        customer_pain_points: clean(input.customer_pain_points),
        target_titles: clean(input.target_titles),
        target_markets: clean(input.target_markets),
        key_features: clean(input.key_features),
        social_proof: clean(input.social_proof),
        signal_keywords: clean(input.signal_keywords),
        competitor_watchlist: clean(input.competitor_watchlist),
        linkedin_signal_behaviors: clean(input.linkedin_signal_behaviors),
        exclusion_rules: clean(input.exclusion_rules),
        preferred_language: clean(input.preferred_language) ?? "English (US)",
        outreach_goal: clean(input.outreach_goal) ?? "conversations",
        message_tone: clean(input.message_tone) ?? "professional",
        profile_source: "manual" as const,
      };
      const signalKind = inferProfileSignalKind(input);
      const icpDraft = {
        name: profilePatch.target_titles
          ? `${firstLine(profilePatch.target_titles)} buyers`
          : "Primary buyer fit",
        description: [
          profilePatch.customer_pain_points,
          profilePatch.value_proposition,
          profilePatch.target_markets,
        ].filter(Boolean).join(" ") ||
          "Buyer fit inferred from the repository context. Review before applying.",
        signal_kind: signalKind,
        match_threshold: 0.72,
        nice_to_haves: proposalNiceToHaves(input),
        enabled: true,
      };
      const sourceRecommendations = proposalSources(input);
      const applyPlan = proposalApplyPlan(profilePatch, icpDraft, sourceRecommendations);
      return {
        workspace_id: context.workspace_id ?? ctx.workspace_id,
        generated_at: new Date().toISOString(),
        mode: "proposal_only" as const,
        profile_patch: profilePatch,
        icp_draft: icpDraft,
        source_recommendations: sourceRecommendations,
        apply_plan: applyPlan,
        missing_context: missingProfileContext(profilePatch),
        existing_context_excerpt: preview(context.markdown ?? null),
        next_action: {
          label: "Review Profile proposal",
          detail:
            "Review the proposed Profile, buyer fit, and source setup in Profile before applying any workspace changes.",
          href: "/dashboard/profile#profile",
        },
        source_tool: "product.context.get" as const,
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
            href: `/dashboard/conversations/${message.conversation_id}#message-${message.id}`,
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
              href: `/dashboard/conversations/${message.conversation_id}#message-${message.id}`,
            }
          : null,
        source_tool: "product.state.get" as const,
      };
    },
  });

  registerTool({
    name: "bombsell.signals.list_qualified",
    description:
      "List qualified Bombsell signals with compact verified-contact readiness, outreach-draft readiness, and the next handoff for Claude Code workflows.",
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
      "Group qualified Bombsell signals into contact lanes with next handoffs: verified email, LinkedIn-ready, draft-ready, needs contact resolution, needs fit review, and blocked by fit.",
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
    name: "bombsell.crm_handoff.queue",
    description:
      "Queue CRM-ready Bombsell contacts with signal proof, verified email or LinkedIn profile, judged/sent outreach context, and reply or meeting learning. Delivers to the configured CRM webhook when present.",
    kind: "write",
    input: z.object({
      limit: z.number().int().min(1).max(25).optional(),
      confirm_queue: z.boolean().optional(),
    }),
    output: CrmHandoffQueueAliasSchema,
    async handler(input, ctx) {
      const result = await invokeTool<
        Omit<z.infer<typeof CrmHandoffQueueAliasSchema>, "generated_at" | "source_tool">
      >("product.crm_handoff.queue", input, ctx);
      return {
        ...result,
        generated_at: new Date().toISOString(),
        source_tool: "product.crm_handoff.queue" as const,
      };
    },
  });

  registerTool({
    name: "bombsell.integrations.list",
    description:
      "List Bombsell output destinations for qualified signals, verified contacts, sent outreach proof, replies, and meetings so external agents know what is connected, available, planned, or blocked.",
    kind: "read",
    input: z.object({}),
    output: IntegrationsAliasSchema,
    async handler(_input, ctx) {
      const [brief, readiness, state] = await Promise.all([
        invokeTool<OperatingBrief>("product.brief.get", {}, ctx),
        invokeTool<LaunchReadiness>("product.launch.readiness.get", {}, ctx),
        productState(ctx),
      ]);
      const destinations = buildOutputDestinations({
        email_connected: brief.channel_readiness.email_connected,
        linkedin_connected: brief.channel_readiness.linkedin_connected,
        crm_connected: crmConnectedFromState(state),
        launch_ready: readiness.launch_ready,
      });
      return {
        workspace_id: brief.workspace_id,
        generated_at: new Date().toISOString(),
        native_channels_ready: brief.channel_readiness.connected_count,
        launch_ready: readiness.launch_ready,
        next_action: {
          label: readiness.launch_ready
            ? "Route qualified work"
            : "Finish Profile and channel setup",
          detail: readiness.launch_ready
            ? "Native email, LinkedIn, MCP, signal intake, visitor-intent intake, and CRM handoff are active paths; native CRM OAuth and alert sync remain planned evented integrations."
            : readiness.next_action || "Connect required channels before external output destinations can move outreach.",
          href: readiness.launch_ready
            ? "/dashboard/profile#tools"
            : readiness.checks.find((check) => check.action?.surface)?.action?.surface ??
              "/dashboard/profile#tools",
        },
        destinations,
        source_tools: [
          "product.brief.get",
          "product.launch.readiness.get",
          "product.state.get",
        ] as [
          "product.brief.get",
          "product.launch.readiness.get",
          "product.state.get",
        ],
      };
    },
  });

  registerTool({
    name: "bombsell.outreach.prepare",
    description:
      "Prepare judged Bombsell email or LinkedIn outreach from qualified signals without sending. This dispatches the existing durable Agent workflow and returns review-ready drafts for approval.",
    kind: "write",
    input: z.object({
      limit: z.number().int().min(1).max(25).optional(),
      confirm_prepare: z.boolean().optional(),
    }),
    output: OutreachPrepareSchema,
    async handler(input, ctx) {
      if (input.confirm_prepare !== true) {
        throw new Error(
          "Preparing Bombsell outreach can create judged drafts and approval gates. Set confirm_prepare=true to continue without sending.",
        );
      }
      const limit = input.limit ?? 10;
      const before = await qualifiedSignalWorkbench(limit, ctx);
      const result = await invokeTool<{ dispatched: number }>(
        "product.signals.dispatch_plays",
        { limit },
        ctx,
      );
      const after = await qualifiedSignalWorkbench(limit, ctx);
      const reviewReadySignals = summarizeQualifiedSignals(after.signals)
        .filter((signal) => isDraftReady(signal.outreach_draft));
      return {
        workspace_id: after.workspace_id,
        generated_at: new Date().toISOString(),
        requested_limit: limit,
        dispatched: result.dispatched,
        before: {
          qualified: before.stats.qualified,
          ready_for_review: before.stats.ready_for_review,
        },
        after: {
          qualified: after.stats.qualified,
          ready_for_review: after.stats.ready_for_review,
          with_outreach_draft: after.stats.with_outreach_draft,
        },
        review_ready_signals: reviewReadySignals,
        next_action: {
          label: "Review prepared outreach",
          detail: reviewReadySignals.length > 0
            ? `${reviewReadySignals.length} judged draft${reviewReadySignals.length === 1 ? "" : "s"} ready under Agent.`
            : "Preparation started. Check Agent for verified contacts, judged drafts, and approval gates.",
          href: "/dashboard/agent#review-queue",
        },
        source_tool: "product.signals.dispatch_plays" as const,
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
      approval_id: z.string().min(1).max(2048),
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
      const result = await invokeTool<{ ok: boolean }>(
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
      next_handoff: signalNextHandoff(signal, contacts, counts),
      href: "/dashboard/agent#qualified-signals",
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
    href: `/dashboard/conversations/${draft.conversation_id}#message-${draft.message_id}`,
  };
}

function signalNextHandoff(
  signal: QualifiedSignalWorkbenchResult["signals"][number],
  contacts: Array<z.infer<typeof SignalContactSummarySchema>>,
  counts: z.infer<typeof QualifiedSignalSummarySchema>["contact_counts"],
): z.infer<typeof SignalNextHandoffSchema> {
  const draft = summarizeDraft(signal.outreach_draft);
  if (draft && isDraftReady(draft)) {
    return {
      label: "Review prepared outreach",
      detail:
        "Judged outreach exists for this qualified signal; review the draft in Agent before sending.",
      href: draft.href,
      stage: "review_draft",
    };
  }
  if (counts.blocked_by_fit > 0 && counts.blocked_by_fit >= counts.total) {
    return {
      label: "Blocked by fit",
      detail:
        "The available contact is marked not fit. Review fit feedback before preparing outreach.",
      href: "/dashboard/agent#verified-contacts",
      stage: "blocked_by_fit",
    };
  }
  if (counts.needs_fit_review > 0 && counts.needs_fit_review >= counts.total) {
    return {
      label: "Review contact fit",
      detail:
        "A reachable contact exists, but fit review should happen before Agent prepares outreach.",
      href: "/dashboard/agent#verified-contacts",
      stage: "review_fit",
    };
  }
  if (counts.email_verified > 0) {
    return {
      label: "Prepare email outreach",
      detail:
        "A verified email contact can move into judged email outreach once channel readiness and approval gates pass.",
      href: "/dashboard/agent#qualified-signals",
      stage: "email_outreach",
    };
  }
  if (counts.linkedin_ready > 0) {
    return {
      label: "Prepare LinkedIn outreach",
      detail:
        "A LinkedIn-ready contact can move into a connection request, accepted follow-up, DM, or InMail path.",
      href: "/dashboard/agent#qualified-signals",
      stage: "linkedin_outreach",
    };
  }
  const hasUnverifiedEmail = contacts.some((contact) =>
    contact.email_status && contact.email_status !== "missing"
  );
  if (hasUnverifiedEmail) {
    return {
      label: "Verify email",
      detail:
        "An email handle exists, but Bombsell needs verification before the channel can send.",
      href: "/dashboard/profile#contact-quality",
      stage: "verify_email",
    };
  }
  return {
    label: "Resolve contact",
    detail:
      signal.contact_defer_reason
        ? `Contact resolution is blocked by ${signal.contact_defer_reason.replace(/_/g, " ")}.`
        : "Resolve a verified email or LinkedIn profile before outreach can be prepared.",
    href: "/dashboard/agent#verified-contacts",
    stage: "resolve_contact",
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

function inferProfileSignalKind(input: {
  repo_context: string;
  signal_keywords?: string;
  linkedin_signal_behaviors?: string;
}): z.infer<typeof ProfileSignalKindSchema> {
  const text = [
    input.signal_keywords ?? "",
    input.linkedin_signal_behaviors ?? "",
    input.repo_context,
  ].join("\n").toLowerCase();
  if (/\b(funding|series [abc]|raised|investor)\b/.test(text)) return "funding";
  if (/\b(hiring|headcount|jobs?|careers?|recruiting)\b/.test(text)) return "hiring";
  if (/\b(launch|released|shipping|new product|changelog)\b/.test(text)) {
    return "product_launch";
  }
  if (/\b(competitor|alternative|vs\.?|migration)\b/.test(text)) {
    return "competitor_move";
  }
  if (/\b(expansion|new market|enterprise|upmarket)\b/.test(text)) {
    return "expansion";
  }
  if (/\b(podcast|webinar|interview)\b/.test(text)) return "podcast_mention";
  if (/\b(press|news|article|coverage)\b/.test(text)) return "press_mention";
  return "other";
}

function proposalNiceToHaves(input: {
  signal_keywords?: string;
  linkedin_signal_behaviors?: string;
  integrations?: string[];
  source_urls?: string[];
}): string[] {
  return unique([
    ...lines(input.signal_keywords).slice(0, 6),
    ...lines(input.linkedin_signal_behaviors)
      .slice(0, 4)
      .map((value) => `LinkedIn behavior: ${value}`),
    ...(input.integrations ?? []).map((value) => `Uses ${value}`),
    ...(input.source_urls ?? []).slice(0, 3),
  ]).slice(0, 10);
}

function proposalSources(input: {
  website_url?: string;
  signal_keywords?: string;
  competitor_watchlist?: string;
  linkedin_signal_behaviors?: string;
  source_urls?: string[];
}): Array<z.infer<typeof ProfileProposalSchema>["source_recommendations"][number]> {
  const sources: Array<z.infer<typeof ProfileProposalSchema>["source_recommendations"][number]> = [];
  if (clean(input.website_url)) {
    sources.push({
      label: "Company website",
      kind: "website",
      reason: "Use the public site as the anchor for Profile, proof, and source discovery.",
      value: clean(input.website_url)!,
    });
  }
  for (const keyword of lines(input.signal_keywords).slice(0, 5)) {
    sources.push({
      label: `Open-web signal: ${keyword}`,
      kind: "open_web",
      reason: "Track market timing evidence related to the inferred buyer problem.",
      value: keyword,
    });
  }
  for (const competitor of lines(input.competitor_watchlist).slice(0, 5)) {
    sources.push({
      label: `Competitor watch: ${competitor}`,
      kind: "competitor_watch",
      reason: "Watch competitor movement and migration timing signals.",
      value: competitor,
    });
  }
  for (const behavior of lines(input.linkedin_signal_behaviors).slice(0, 5)) {
    sources.push({
      label: `LinkedIn behavior: ${behavior}`,
      kind: "linkedin_behavior",
      reason:
        "Track concrete LinkedIn engagement that can become verified contacts and DM-ready profiles.",
      value: behavior,
    });
  }
  for (const url of (input.source_urls ?? []).slice(0, 5)) {
    sources.push({
      label: "Repository-provided source",
      kind: "source_url",
      reason: "Claude Code found this source while inspecting the project.",
      value: url,
    });
  }
  return sources.slice(0, 12);
}

function proposalApplyPlan(
  profilePatch: z.infer<typeof ProfileProposalSchema>["profile_patch"],
  icpDraft: z.infer<typeof ProfileProposalSchema>["icp_draft"],
  sourceRecommendations: z.infer<typeof ProfileProposalSchema>["source_recommendations"],
): z.infer<typeof ProfileProposalSchema>["apply_plan"] {
  const applyPlan: z.infer<typeof ProfileProposalSchema>["apply_plan"] = [];
  if (profilePatch.company_name && profilePatch.website_url) {
    applyPlan.push({
      tool_name: "product.company.profile.configure",
      requires_confirmation: true,
      input: compactRecord(profilePatch),
    });
  }
  applyPlan.push({
    tool_name: "product.icp.configure",
    requires_confirmation: true,
    input: compactRecord(icpDraft),
  });
  for (const source of sourceRecommendations.slice(0, 5)) {
    applyPlan.push({
      tool_name: "product.source.configure",
      requires_confirmation: true,
      input: {
        name: source.label,
        kind: source.kind,
        config: { value: source.value, reason: source.reason },
      },
    });
  }
  return applyPlan;
}

function crmConnectedFromState(state: ProductState): boolean {
  return Boolean(
    state.channelAccounts?.some(
      (account) => account.kind === "crm" && account.status === "connected",
    ),
  );
}

function missingProfileContext(
  profilePatch: z.infer<typeof ProfileProposalSchema>["profile_patch"],
): string[] {
  const missing: string[] = [];
  if (!profilePatch.company_name) missing.push("company_name");
  if (!profilePatch.website_url) missing.push("website_url");
  if (!profilePatch.value_proposition) missing.push("value_proposition");
  if (!profilePatch.customer_pain_points) missing.push("customer_pain_points");
  if (!profilePatch.target_titles) missing.push("target_titles");
  if (!profilePatch.signal_keywords) missing.push("signal_keywords");
  return missing;
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

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : null;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/)[0]?.trim() || value.trim();
}

function lines(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function compactRecord<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined),
  );
}

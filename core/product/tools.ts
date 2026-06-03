import { z } from "zod";
import { registerTool } from "../agents/tools/registry.ts";
import type { ToolContext } from "../agents/tools/types.ts";
import {
  approveWorkflowApproval,
  configureActivationSetup,
  configureDefaultSignalAggregator,
  configureIcpSegment,
  configureRep,
  configureSignalEmailPlay,
  configureSignalLinkedInPlay,
  configureExaOpenWebSignalSource,
  configureWorkspaceCompanyProfile,
  configureWorkspaceEmailAccount,
  configureWorkspaceSignalSource,
  discoverSignalFromSource,
  dispatchSignalPlaysOnce,
  enrichWorkspaceProfileWithExa,
  getLinkedInAccountConnectIntent,
  getAppState,
  listDeadLetteredEventDispatches,
  researchWorkspaceWithExa,
  redriveDeadLetteredEventDispatch,
  retryFailedWorkflowRun,
  runWorkspaceSignalAggregatorOnce,
  startSendingDomainOperation,
  startWorkspaceExaResearchWorkflow,
  submitManualSignal,
  trackCompanyForWorkspace,
  type ProductWorkspaceSession,
} from "./app.ts";
import {
  analyzeCompanyWebsite,
  normalizeCompanyWebsiteUrl,
} from "./company-profile.ts";
import { getWorkspaceAgentContext } from "./context.ts";
import { getConversationTrustTrace } from "./conversation-trust.ts";
import { checkProductReadiness } from "./health.ts";

const SignalKindSchema = z.enum([
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

const ApprovalSchema = z.enum(["none", "approve_first", "always", "research_only"]);
const ExaResearchIntentSchema = z.enum([
  "rep_research",
  "draft_grounding",
  "content_research",
  "aeo_audit",
]);
const LinkedInActionSchema = z.enum([
  "linkedin_connection",
  "linkedin_dm",
  "linkedin_comment",
]);
const RepRoleSchema = z.enum([
  "sdr",
  "content",
  "replier",
  "researcher",
  "campaign",
  "custom",
]);
const SourceAdapterSchema = z.enum([
  "rss",
  "google_news",
  "hn_front",
  "hn_whos_hiring",
  "product_hunt",
  "reddit",
  "exa",
  "x_search",
  "webhook",
]);

const WorkspaceResultSchema = z.object({
  workspace_id: z.string().uuid(),
});
const ProductReadinessStatusSchema = z.enum(["ok", "degraded", "unconfigured"]);
const ProductReadinessSchema = z.object({
  service: z.literal("bombsell-product"),
  status: ProductReadinessStatusSchema,
  ready: z.boolean(),
  checked_at: z.string().datetime(),
  checks: z.array(
    z.object({
      name: z.string(),
      status: ProductReadinessStatusSchema,
      detail: z.string().optional(),
    }),
  ),
});
const DeadLetteredDispatchSchema = z.object({
  event_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  event_type: z.string(),
  attempts: z.number().int().nonnegative(),
  last_error: z.string().nullable(),
  dead_lettered_at: z.string().datetime(),
  source: z.string(),
  producer_ref: z.string().nullable(),
});

let registered = false;

function sessionFromContext(ctx: ToolContext): ProductWorkspaceSession {
  if (!ctx.user_id) {
    throw new Error("Authenticated user context is required for product tools.");
  }
  return { workspace_id: ctx.workspace_id, user_id: ctx.user_id };
}

export function registerProductTools(): void {
  if (registered) return;
  registered = true;

  registerTool({
    name: "product.state.get",
    description:
      "Read the workspace morning-brief state: Reps, Plays, Signals, Conversations, Outcomes, approvals, sources, deliverability, and event trace.",
    kind: "read",
    input: z.object({}),
    output: z.unknown(),
    async handler(_input, ctx) {
      return getAppState(undefined, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.context.get",
    description:
      "Read prompt-ready dynamic workspace context for Reps and external agents: vocabulary, active resources, recent work, gates, and recovery state.",
    kind: "read",
    input: z.object({}),
    output: z.object({
      workspace_id: z.string().uuid(),
      generated_at: z.string().datetime(),
      markdown: z.string(),
      counts: z.object({
        reps: z.number().int().nonnegative(),
        icps: z.number().int().nonnegative(),
        plays: z.number().int().nonnegative(),
        sources: z.number().int().nonnegative(),
        pending_approvals: z.number().int().nonnegative(),
        recent_signals: z.number().int().nonnegative(),
        recent_conversations: z.number().int().nonnegative(),
        recent_outcomes: z.number().int().nonnegative(),
      }),
    }),
    async handler(_input, ctx) {
      return getWorkspaceAgentContext(sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.readiness.get",
    description:
      "Read the product runtime readiness shown in Ops: environment, provider configuration, durable substrate, database, schema tables, and migrations.",
    kind: "read",
    input: z.object({}),
    output: ProductReadinessSchema,
    async handler(_input, ctx) {
      sessionFromContext(ctx);
      return checkProductReadiness();
    },
  });

  registerTool({
    name: "product.conversation.trust.get",
    description:
      "Read the user-facing proof trace for one Conversation: Signal, messages, judge output, approval gate, workflow steps, send/defer events, and Outcomes.",
    kind: "read",
    input: z.object({ conversation_id: z.string().uuid() }),
    output: z.unknown(),
    async handler(input, ctx) {
      return getConversationTrustTrace({
        workspace_id: ctx.workspace_id,
        conversation_id: input.conversation_id,
      });
    },
  });

  registerTool({
    name: "product.company.website_profile.extract",
    description:
      "Extract a company profile from a public website with Firecrawl and the product LLM. Returns profile data; it does not write workspace state.",
    kind: "external",
    input: z.object({
      website_url: z.string().min(1),
      company_hint: z.string().optional(),
      allowed_industries: z.array(z.string().min(1)).optional(),
    }),
    output: z
      .object({
        company_name: z.string().nullable(),
        website_url: z.string(),
        industry: z.string().nullable(),
        description: z.string().nullable(),
      })
      .nullable(),
    async handler(input) {
      const websiteUrl = normalizeCompanyWebsiteUrl(input.website_url);
      if (!websiteUrl) throw new Error("valid website_url required");
      return analyzeCompanyWebsite({
        websiteUrl,
        companyHint: input.company_hint,
        allowedIndustries: input.allowed_industries,
      });
    },
  });

  registerTool({
    name: "product.company.profile.configure",
    description:
      "Store the workspace company profile as graph memory by emitting workspace.company.profiled and projecting it.",
    kind: "write",
    input: z.object({
      company_name: z.string().min(1),
      website_url: z.string().min(1),
      industry: z.string().optional(),
      description: z.string().optional(),
    }),
    output: WorkspaceResultSchema.extend({ company_id: z.string().uuid() }),
    async handler(input, ctx) {
      return configureWorkspaceCompanyProfile(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.profile.enrich",
    description:
      "Enrich the workspace Profile with Exa public-web evidence, projecting results into graph sources and updating company memory through a typed event.",
    kind: "write",
    input: z.object({
      company_id: z.string().uuid().optional(),
      company_name: z.string().min(1),
      website_url: z.string().optional(),
      industry: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      max_results: z.number().int().positive().max(25).optional(),
    }),
    output: WorkspaceResultSchema.extend({
      company_id: z.string().uuid(),
      evidence_source_ids: z.array(z.string().uuid()),
      summary: z.string(),
    }),
    async handler(input, ctx) {
      return enrichWorkspaceProfileWithExa(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.rep.research",
    description:
      "Let a Rep research the public web with Exa and store evidence in the graph for future context.",
    kind: "write",
    input: z.object({
      query: z.string().min(1),
      num_results: z.number().int().positive().max(25).optional(),
      include_text: z.boolean().optional(),
    }),
    output: WorkspaceResultSchema.extend({
      request_id: z.string().nullable(),
      evidence_source_ids: z.array(z.string().uuid()),
      summary: z.string(),
    }),
    async handler(input, ctx) {
      return researchWorkspaceWithExa(
        { ...input, intent: "rep_research" },
        sessionFromContext(ctx),
      );
    },
  });

  registerTool({
    name: "product.exa.research_workflow.start",
    description:
      "Start a durable Exa research workflow for Rep research, draft grounding, content opportunities, or AEO audit when asynchronous checkpointed execution is preferred.",
    kind: "write",
    input: z.object({
      query: z.string().min(1),
      intent: ExaResearchIntentSchema.default("rep_research"),
      num_results: z.number().int().positive().max(25).optional(),
      include_text: z.boolean().optional(),
    }),
    output: WorkspaceResultSchema.extend({
      workflow_run_id: z.string(),
      workflow_name: z.string(),
    }),
    async handler(input, ctx) {
      return startWorkspaceExaResearchWorkflow(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.draft.ground",
    description:
      "Use Exa to gather factual evidence for a draft before writer/judge steps use it.",
    kind: "write",
    input: z.object({
      query: z.string().min(1),
      num_results: z.number().int().positive().max(25).optional(),
    }),
    output: WorkspaceResultSchema.extend({
      request_id: z.string().nullable(),
      evidence_source_ids: z.array(z.string().uuid()),
      summary: z.string(),
    }),
    async handler(input, ctx) {
      return researchWorkspaceWithExa(
        { ...input, intent: "draft_grounding", include_text: true },
        sessionFromContext(ctx),
      );
    },
  });

  registerTool({
    name: "product.rep.configure",
    description:
      "Create or update a user-facing Rep persona with voice, KPIs, channels, and per-channel autonomy.",
    kind: "write",
    input: z.object({
      name: z.string().min(1),
      role: RepRoleSchema.optional(),
      voice: z.string().min(1),
      story: z.string().optional(),
      daily_cap: z.number().int().nonnegative().optional(),
      approval: ApprovalSchema.optional(),
      do_not: z.array(z.string()).optional(),
      samples: z.array(z.string()).optional(),
    }),
    output: WorkspaceResultSchema.extend({ rep_id: z.string().uuid() }),
    async handler(input, ctx) {
      return configureRep(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.icp.configure",
    description:
      "Create or update an ICP segment used by the signal classifier and Play matching.",
    kind: "write",
    input: z.object({
      name: z.string().min(1),
      description: z.string().min(1),
      signal_kind: SignalKindSchema,
      match_threshold: z.number().min(0).max(1).optional(),
      nice_to_haves: z.array(z.string()).optional(),
      enabled: z.boolean().optional(),
    }),
    output: WorkspaceResultSchema.extend({ icp_id: z.string().uuid() }),
    async handler(input, ctx) {
      return configureIcpSegment(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.play.signal_email.configure",
    description:
      "Create or update a Signal-to-email Play. The Play declaration compiles to the durable workflow path with research, draft, judge, approval, and send steps.",
    kind: "write",
    input: z.object({
      rep_id: z.string().uuid(),
      name: z.string().optional(),
      description: z.string().optional(),
      signal_kind: SignalKindSchema,
      icp_name: z.string().optional(),
      daily_cap: z.number().int().nonnegative().optional(),
      approval: ApprovalSchema.optional(),
    }),
    output: WorkspaceResultSchema.extend({ play_id: z.string().uuid() }),
    async handler(input, ctx) {
      return configureSignalEmailPlay(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.play.signal_linkedin.configure",
    description:
      "Create or update a Signal-to-LinkedIn Play. The Play declaration compiles to the durable workflow path with research, draft, judge, approval, and native LinkedIn channel send steps.",
    kind: "write",
    input: z.object({
      rep_id: z.string().uuid(),
      name: z.string().optional(),
      description: z.string().optional(),
      signal_kind: SignalKindSchema,
      icp_name: z.string().optional(),
      action: LinkedInActionSchema.optional(),
      daily_cap: z.number().int().nonnegative().optional(),
      approval: ApprovalSchema.optional(),
    }),
    output: WorkspaceResultSchema.extend({ play_id: z.string().uuid() }),
    async handler(input, ctx) {
      return configureSignalLinkedInPlay(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.email_account.configure",
    description:
      "Configure the workspace owned-domain email account surface and emit channel.account.configured.",
    kind: "write",
    input: z.object({
      display_name: z.string().min(1),
      daily_cap: z.number().int().nonnegative(),
    }),
    output: WorkspaceResultSchema.extend({ channel_account_id: z.string().uuid() }),
    async handler(input, ctx) {
      return configureWorkspaceEmailAccount(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.linkedin_account.connect_url.get",
    description:
      "Return the workspace-scoped LinkedIn provider authorization URL. Opening this URL starts human OAuth/session handoff; the callback emits typed channel account events.",
    kind: "read",
    input: z.object({}),
    output: WorkspaceResultSchema.extend({
      connect_url: z.string().min(1),
      provider_configured: z.boolean(),
    }),
    async handler(_input, ctx) {
      return getLinkedInAccountConnectIntent(sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.company.track",
    description:
      "Track a company in the workspace graph for catalog ingestion and signal matching.",
    kind: "write",
    input: z.object({
      name: z.string().min(1),
      domain: z.string().optional(),
      industry: z.string().optional(),
      size_bucket: z.string().optional(),
      greenhouse_id: z.string().optional(),
      lever_id: z.string().optional(),
      ashby_id: z.string().optional(),
      workable_id: z.string().optional(),
      career_rss_url: z.string().optional(),
      reason: z.string().optional(),
    }),
    output: WorkspaceResultSchema.extend({ company_id: z.string().uuid() }),
    async handler(input, ctx) {
      return trackCompanyForWorkspace(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.source.configure",
    description:
      "Configure a workspace signal source adapter. Ingestion itself runs through the durable workspace poll workflow.",
    kind: "write",
    input: z.object({
      adapter: SourceAdapterSchema,
      name: z.string().min(1),
      provider: z.string().optional(),
      url: z.string().optional(),
      query: z.string().optional(),
      subreddit: z.string().optional(),
      signal_kind: SignalKindSchema.optional(),
      limit: z.number().int().positive().max(100).optional(),
      max_daily_items: z.number().int().positive().optional(),
      max_daily_calls: z.number().int().positive().optional(),
      monthly_spend_cap_usd: z.number().positive().optional(),
      poll_interval_minutes: z.number().int().positive().optional(),
      enabled: z.boolean().optional(),
    }),
    output: WorkspaceResultSchema.extend({
      rep_id: z.string(),
      play_id: z.string(),
      channel_account_id: z.string(),
      source_id: z.string().uuid().optional(),
    }),
    async handler(input, ctx) {
      return configureWorkspaceSignalSource(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.activation.configure",
    description:
      "Shortcut for the setup screen: compose Rep, ICP, Signal-email Play, optional email account, tracked company, and optional source. Primitive tools remain available for each step.",
    kind: "write",
    input: z.object({
      rep: z.object({
        name: z.string().min(1),
        role: RepRoleSchema.optional(),
        voice: z.string().min(1),
        story: z.string().optional(),
        daily_cap: z.number().int().nonnegative().optional(),
        approval: ApprovalSchema.optional(),
      }),
      icp: z.object({
        name: z.string().min(1),
        description: z.string().min(1),
        signal_kind: SignalKindSchema,
        match_threshold: z.number().min(0).max(1).optional(),
        nice_to_haves: z.array(z.string()).optional(),
      }),
      play: z
        .object({
          name: z.string().optional(),
          description: z.string().optional(),
          daily_cap: z.number().int().nonnegative().optional(),
          approval: ApprovalSchema.optional(),
        })
        .optional(),
      email: z
        .object({
          display_name: z.string().min(1),
          daily_cap: z.number().int().nonnegative(),
        })
        .optional(),
      company: z
        .object({
          name: z.string().min(1),
          domain: z.string().optional(),
          industry: z.string().optional(),
          size_bucket: z.string().optional(),
          greenhouse_id: z.string().optional(),
          lever_id: z.string().optional(),
          ashby_id: z.string().optional(),
          workable_id: z.string().optional(),
          career_rss_url: z.string().optional(),
          reason: z.string().optional(),
        })
        .optional(),
      source: z
        .object({
          name: z.string().min(1),
          url: z.string().min(1),
          signal_kind: SignalKindSchema,
          poll_interval_minutes: z.number().int().positive().optional(),
        })
        .optional(),
    }),
    output: WorkspaceResultSchema.extend({
      rep_id: z.string().uuid(),
      icp_id: z.string().uuid(),
      play_id: z.string().uuid(),
      channel_account_id: z.string().uuid().optional(),
      tracked_company_id: z.string().uuid().optional(),
      source_id: z.string().uuid().optional(),
    }),
    async handler(input, ctx) {
      return configureActivationSetup(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.sources.default_aggregator.configure",
    description:
      "Configure the default real signal aggregator sources for a profiled company: Google News, HN front, HN Who's Hiring, and Product Hunt.",
    kind: "write",
    input: z.object({
      company_name: z.string().min(1),
      website_url: z.string().optional(),
      industry: z.string().optional(),
      description: z.string().optional(),
      signal_kind: SignalKindSchema.optional(),
    }),
    output: WorkspaceResultSchema.extend({ source_count: z.number().int().nonnegative() }),
    async handler(input, ctx) {
      return configureDefaultSignalAggregator(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.signal.discover_open_web",
    description:
      "Configure an Exa open-web Signal source. The durable workspace poll workflow owns fetching, budgets, dedupe, projection, and signal.discovered publication.",
    kind: "write",
    input: z.object({
      query: z.string().min(1),
      source_name: z.string().optional(),
      signal_kind: SignalKindSchema.optional(),
      limit: z.number().int().positive().max(100).optional(),
      max_daily_items: z.number().int().positive().optional(),
      max_daily_calls: z.number().int().positive().optional(),
      monthly_spend_cap_usd: z.number().positive().optional(),
      enabled: z.boolean().optional(),
    }),
    output: WorkspaceResultSchema.extend({
      source_id: z.string().uuid(),
    }),
    async handler(input, ctx) {
      return configureExaOpenWebSignalSource(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.content.opportunities.discover",
    description:
      "Discover content opportunities with Exa, store evidence in the graph, and emit content.opportunity.discovered.",
    kind: "write",
    input: z.object({
      query: z.string().min(1),
      num_results: z.number().int().positive().max(25).optional(),
    }),
    output: WorkspaceResultSchema.extend({
      request_id: z.string().nullable(),
      evidence_source_ids: z.array(z.string().uuid()),
      summary: z.string(),
    }),
    async handler(input, ctx) {
      return researchWorkspaceWithExa(
        { ...input, intent: "content_research", include_text: true },
        sessionFromContext(ctx),
      );
    },
  });

  registerTool({
    name: "product.aeo.audit",
    description:
      "Audit category visibility and answer gaps with Exa, store evidence in the graph, and emit aeo.audit.completed.",
    kind: "write",
    input: z.object({
      query: z.string().min(1),
      num_results: z.number().int().positive().max(25).optional(),
    }),
    output: WorkspaceResultSchema.extend({
      request_id: z.string().nullable(),
      evidence_source_ids: z.array(z.string().uuid()),
      summary: z.string(),
    }),
    async handler(input, ctx) {
      return researchWorkspaceWithExa(
        { ...input, intent: "aeo_audit", include_text: true },
        sessionFromContext(ctx),
      );
    },
  });

  registerTool({
    name: "product.sources.aggregate.run",
    description:
      "Start due workspace source poll workflows and, in local Postgres mode, resume/project the run once for immediate feedback.",
    kind: "write",
    input: z.object({
      limit: z.number().int().positive().max(100).optional(),
      lease_ms: z.number().int().positive().optional(),
      lease_owner: z.string().optional(),
    }),
    output: z.object({
      dispatched: z.number().int().nonnegative(),
      resumed: z.number().int().nonnegative(),
      projected: z.unknown().nullable(),
    }),
    async handler(input, ctx) {
      return runWorkspaceSignalAggregatorOnce(
        {
          limit: input.limit,
          leaseMs: input.lease_ms,
          leaseOwner: input.lease_owner,
        },
        sessionFromContext(ctx),
      );
    },
  });

  registerTool({
    name: "product.signal.discover",
    description:
      "Push a source-backed Signal into the evented aggregator path immediately. This is the push/webhook counterpart to source polling and emits signal.discovered.",
    kind: "write",
    input: z.object({
      source_id: z.string().uuid(),
      external_id: z.string().min(1),
      title: z.string().min(1),
      content: z.string().nullable().optional(),
      url: z.string().nullable().optional(),
      signal_kind: SignalKindSchema.optional(),
      freshness_at: z.string().datetime().optional(),
      structured: z.record(z.string(), z.unknown()).optional(),
      provenance: z.record(z.string(), z.unknown()).optional(),
    }),
    output: WorkspaceResultSchema.extend({
      outcome: z.enum([
        "created",
        "skipped:dedup",
        "skipped:must_haves",
        "skipped:budget",
      ]),
      signal_id: z.string().uuid().optional(),
      event_id: z.string().uuid().optional(),
    }),
    async handler(input, ctx) {
      return discoverSignalFromSource(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.signal.submit",
    description:
      "Submit a manual Signal into the evented ingestion path. Matching and Play dispatch remain separate capabilities.",
    kind: "write",
    input: z.object({
      company_name: z.string().min(1),
      company_domain: z.string().optional(),
      person_name: z.string().min(1),
      person_email: z.string().email(),
      signal_title: z.string().min(1),
      signal_content: z.string().min(1),
      signal_url: z.string().optional(),
      signal_kind: SignalKindSchema.optional(),
      icp_segment: z.string().optional(),
      approval: ApprovalSchema.default("always"),
      match_score: z.number().min(0).max(1).optional(),
      simulate_outcome_kind: z.enum(["positive_reply", "meeting_booked"]).nullable().optional(),
    }),
    output: WorkspaceResultSchema.extend({ signal_id: z.string().uuid() }),
    async handler(input, ctx) {
      return submitManualSignal(input, sessionFromContext(ctx));
    },
  });

  registerTool({
    name: "product.signals.dispatch_plays",
    description:
      "Dispatch durable Play workflows for matched Signals that do not already have a workflow run.",
    kind: "write",
    input: z.object({
      limit: z.number().int().positive().max(100).optional(),
    }),
    output: z.object({ dispatched: z.number().int().nonnegative() }),
    async handler(input, ctx) {
      return {
        dispatched: await dispatchSignalPlaysOnce(
          { limit: input.limit },
          sessionFromContext(ctx),
        ),
      };
    },
  });

  registerTool({
    name: "product.approval.decide",
    description:
      "Approve or reject a pending workflow approval gate. Approved sends still pass through the channel/eval/deliverability state machine.",
    kind: "write",
    input: z.object({
      approval_id: z.string().uuid(),
      decision: z.enum(["approved", "rejected"]),
      note: z.string().optional(),
    }),
    output: z.object({ ok: z.literal(true) }),
    async handler(input, ctx) {
      await approveWorkflowApproval(
        input.approval_id,
        input.decision,
        sessionFromContext(ctx),
        input.note,
      );
      return { ok: true as const };
    },
  });

  registerTool({
    name: "product.workflow.retry",
    description:
      "Retry a failed durable workflow run without mutating domain state directly.",
    kind: "write",
    input: z.object({ run_id: z.string().uuid() }),
    output: z.object({ ok: z.literal(true) }),
    async handler(input, ctx) {
      await retryFailedWorkflowRun(input.run_id, sessionFromContext(ctx));
      return { ok: true as const };
    },
  });

  registerTool({
    name: "product.event_dispatch.dead_letters.list",
    description:
      "List dead-lettered event-bus deliveries for the active workspace so agents can inspect the same Ops recovery queue users see before redriving.",
    kind: "read",
    input: z.object({
      limit: z.number().int().positive().max(500).optional(),
    }),
    output: z.object({
      dead_letters: z.array(DeadLetteredDispatchSchema),
    }),
    async handler(input, ctx) {
      return {
        dead_letters: await listDeadLetteredEventDispatches(
          sessionFromContext(ctx),
          { limit: input.limit },
        ),
      };
    },
  });

  registerTool({
    name: "product.event_dispatch.redrive",
    description:
      "Redrive one dead-lettered event-bus delivery for the active workspace by resetting its NATS dispatch row to pending.",
    kind: "write",
    input: z.object({ event_id: z.string().uuid() }),
    output: z.object({ redriven: z.boolean() }),
    async handler(input, ctx) {
      return {
        redriven: await redriveDeadLetteredEventDispatch(
          input.event_id,
          sessionFromContext(ctx),
        ),
      };
    },
  });

  registerTool({
    name: "product.sending_domain.operate",
    description:
      "Start a durable sending-domain operation: provision, verify, or refresh provider/domain trust state.",
    kind: "write",
    input: z.object({
      operation: z.enum(["provision", "verify", "refresh"]),
    }),
    output: z.object({ ok: z.literal(true) }),
    async handler(input, ctx) {
      await startSendingDomainOperation(input.operation, sessionFromContext(ctx));
      return { ok: true as const };
    },
  });
}

export function _resetProductToolsRegistration(): void {
  registered = false;
}

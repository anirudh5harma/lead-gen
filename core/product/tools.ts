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
  configureWorkspaceCompanyProfile,
  configureWorkspaceEmailAccount,
  configureWorkspaceSignalSource,
  discoverSignalFromSource,
  dispatchSignalPlaysOnce,
  getAppState,
  redriveDeadLetteredEventDispatch,
  retryFailedWorkflowRun,
  runWorkspaceSignalAggregatorOnce,
  startSendingDomainOperation,
  submitManualSignal,
  trackCompanyForWorkspace,
  type ProductWorkspaceSession,
} from "./app.ts";
import {
  analyzeCompanyWebsite,
  normalizeCompanyWebsiteUrl,
} from "./company-profile.ts";

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
  "webhook",
]);

const WorkspaceResultSchema = z.object({
  workspace_id: z.string().uuid(),
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
      url: z.string().optional(),
      query: z.string().optional(),
      subreddit: z.string().optional(),
      signal_kind: SignalKindSchema.optional(),
      poll_interval_minutes: z.number().int().positive().optional(),
      enabled: z.boolean().optional(),
    }),
    output: WorkspaceResultSchema.extend({
      rep_id: z.string(),
      play_id: z.string(),
      channel_account_id: z.string(),
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

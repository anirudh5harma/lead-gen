import { END, START, StateGraph } from "@langchain/langgraph";
import type {
  EventBus,
  EventPayload,
  EventType,
} from "../../../substrate/events/index.ts";
import type { RunContext } from "../../../substrate/workflows/index.ts";
import { normalizeCompanyWebsiteUrl } from "../../../product/company-profile.ts";
import { createLangGraphMemoryCheckpoint } from "../checkpoint.ts";
import {
  type BombsellLangGraphState,
  BombsellGraphStateAnnotation,
} from "../state.ts";
import { invokeLangGraphTool, type LangGraphToolOptions } from "../tools.ts";
import { runLangGraphInWorkflowStep, traceLangGraphNode } from "../runtime.ts";

export const ACTIVATION_SETUP_GRAPH_NAME = "activation.setup_graph.v1";

type SignalKind =
  | "funding"
  | "hiring"
  | "leadership_change"
  | "product_launch"
  | "acquisition"
  | "churn_risk"
  | "competitor_move"
  | "podcast_mention"
  | "press_mention"
  | "regulation"
  | "expansion"
  | "layoff"
  | "other";

type ChecklistStatus = "complete" | "needs_review" | "blocked";

export interface ActivationSetupGraphInput {
  workspace_id?: string;
  user_id: string;
  website_url: string;
  company_hint?: string;
  industry_hint?: string;
  description_hint?: string;
  customer_pain_points?: string;
  key_features?: string;
  social_proof?: string;
  preferred_language?: string;
  outreach_goal?: string;
  message_tone?: string;
  allowed_industries?: string[];
  thread_id?: string;
  run_id?: string;
  correlation_id?: string;
  causation_event_id?: string | null;
}

export interface ActivationProfileDraft {
  company_name: string;
  website_url: string;
  domain: string | null;
  industry: string | null;
  description: string;
  customer_pain_points?: string | null;
  key_features?: string | null;
  social_proof?: string | null;
  preferred_language?: string | null;
  outreach_goal?: string | null;
  message_tone?: string | null;
  profile_source: "firecrawl" | "fallback" | "manual";
  confidence: number;
  evidence: Array<{ label: string; value: string; source_ref?: string | null }>;
  needs_review: string[];
}

export interface ActivationIcpDraft {
  name: string;
  description: string;
  signal_kind: SignalKind;
  match_threshold: number;
  nice_to_haves: string[];
  inferred_from: {
    website_url: string;
    company_name: string;
  };
  needs_review: string[];
}

export interface ActivationRepDraft {
  name: string;
  role: "sdr";
  voice: string;
  story: string;
  daily_cap: number;
  approval: "none";
}

export interface ActivationPlayDraft {
  channel: "email" | "linkedin_dm";
  name: string;
  signal_kind: SignalKind;
  daily_cap: number;
  approval: "none";
}

export interface ActivationSourcePlan {
  adapters: Array<{
    adapter: "google_news" | "hn_front" | "hn_whos_hiring" | "product_hunt";
    signal_kind: SignalKind;
    reason: string;
  }>;
}

export interface ActivationChecklistItem {
  id: string;
  primitive: "Rep" | "Signal" | "Play" | "Conversation" | "Outcome";
  label: string;
  status: ChecklistStatus;
  blocking: boolean;
  detail: string;
  action_url?: string | null;
}

export interface ActivationLaunchChecklist {
  ready_to_launch: boolean;
  send_blocked: boolean;
  items: ActivationChecklistItem[];
}

export interface ActivationSetupGraphOptions {
  bus?: EventBus;
  tools?: Partial<{
    websiteProfileExtract: string;
    companyProfileConfigure: string;
    activationConfigure: string;
    signalLinkedInPlayConfigure: string;
    defaultAggregatorConfigure: string;
    outlookConnectUrlGet: string;
    linkedInConnectUrlGet: string;
  }>;
  toolOptions?: LangGraphToolOptions;
}

interface WebsiteProfileExtractResult {
  company_name: string | null;
  website_url: string;
  industry: string | null;
  description: string | null;
}

interface ActivationConfigureResult {
  workspace_id: string;
  rep_id: string;
  icp_id: string;
  play_id: string;
  channel_account_id?: string;
  tracked_company_id?: string;
  source_id?: string;
}

interface CompanyProfileConfigureResult {
  workspace_id: string;
  company_id: string;
}

interface PlayConfigureResult {
  workspace_id: string;
  play_id: string;
}

interface SourceConfigureResult {
  workspace_id: string;
  source_count: number;
}

interface ConnectIntent {
  workspace_id: string;
  connect_url: string;
  provider_configured: boolean;
}

const DEFAULT_TOOLS = {
  websiteProfileExtract: "product.company.website_profile.extract",
  companyProfileConfigure: "product.company.profile.configure",
  activationConfigure: "product.activation.configure",
  signalLinkedInPlayConfigure: "product.play.signal_linkedin.configure",
  defaultAggregatorConfigure: "product.sources.default_aggregator.configure",
  outlookConnectUrlGet: "product.outlook_account.connect_url.get",
  linkedInConnectUrlGet: "product.linkedin_account.connect_url.get",
} as const;

export function createActivationSetupGraph(
  opts: ActivationSetupGraphOptions = {},
) {
  const tools = { ...DEFAULT_TOOLS, ...opts.tools };
  const toolOptions = { ...opts.toolOptions, bus: opts.bus };

  return new StateGraph(BombsellGraphStateAnnotation)
    .addNode(
      "request",
      traceLangGraphNode({
        graph_name: ACTIVATION_SETUP_GRAPH_NAME,
        node_name: "request",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const input = activationInputFromState(state);
          const website_url = normalizeOrThrow(input.website_url);
          await publishActivationEvent(
            opts.bus,
            state,
            "workspace.activation.requested",
            {
              website_url,
              requested_by: input.user_id,
              graph_name: ACTIVATION_SETUP_GRAPH_NAME,
              run_id: state.run_id,
            },
            "requested",
          );
          return {
            attributes: mergeAttributes(state, {
              website_url,
              user_id: input.user_id,
              company_hint: input.company_hint ?? null,
              industry_hint: input.industry_hint ?? null,
              description_hint: input.description_hint ?? null,
              customer_pain_points: input.customer_pain_points ?? null,
              key_features: input.key_features ?? null,
              social_proof: input.social_proof ?? null,
              preferred_language: input.preferred_language ?? null,
              outreach_goal: input.outreach_goal ?? null,
              message_tone: input.message_tone ?? null,
              allowed_industries: input.allowed_industries ?? [],
            }),
          };
        },
      }),
    )
    .addNode(
      "profile",
      traceLangGraphNode({
        graph_name: ACTIVATION_SETUP_GRAPH_NAME,
        node_name: "profile",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const input = activationInputFromState(state);
          const website_url = normalizedWebsiteFromState(state);
          const profile =
            await invokeLangGraphTool<WebsiteProfileExtractResult | null>(
              tools.websiteProfileExtract,
              {
                website_url,
                company_hint: input.company_hint,
                allowed_industries: input.allowed_industries,
              },
              state,
              toolOptions,
            );
          const fallback = fallbackProfile(website_url, input.company_hint);
          return {
            attributes: mergeAttributes(state, {
              website_profile: profile ?? fallback,
            }),
            tool_results: {
              website_profile_extract: profile ?? fallback,
            },
          };
        },
      }),
    )
    .addNode(
      "draft",
      traceLangGraphNode({
        graph_name: ACTIVATION_SETUP_GRAPH_NAME,
        node_name: "draft",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const profile = profileDraftFromState(state);
          const icp = icpDraftFromProfile(profile);
          const rep = repDraftFromProfile(profile);
          const plays = playDraftsFromProfile(profile);
          const sourcePlan = sourcePlanFromProfile(profile);
          await publishActivationEvent(
            opts.bus,
            state,
            "workspace.profile.drafted",
            {
              company_name: profile.company_name,
              website_url: profile.website_url,
              domain: profile.domain,
              industry: profile.industry,
              description: profile.description,
              profile_source: profile.profile_source,
              confidence: profile.confidence,
              evidence: profile.evidence,
              needs_review: profile.needs_review,
            },
            "profile-drafted",
          );
          await publishActivationEvent(
            opts.bus,
            state,
            "icp.drafted",
            icp,
            "icp-drafted",
          );
          return {
            attributes: mergeAttributes(state, {
              profile_draft: profile,
              icp_draft: icp,
              rep_draft: rep,
              play_drafts: plays,
              source_plan: sourcePlan,
            }),
          };
        },
      }),
    )
    .addNode(
      "configure",
      traceLangGraphNode({
        graph_name: ACTIVATION_SETUP_GRAPH_NAME,
        node_name: "configure",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const profile = getAttribute<ActivationProfileDraft>(
            state,
            "profile_draft",
          );
          const icp = getAttribute<ActivationIcpDraft>(state, "icp_draft");
          const rep = getAttribute<ActivationRepDraft>(state, "rep_draft");
          const plays = getAttribute<ActivationPlayDraft[]>(
            state,
            "play_drafts",
          );
          const companyProfile =
            await invokeLangGraphTool<CompanyProfileConfigureResult>(
              tools.companyProfileConfigure,
              {
                company_name: profile.company_name,
                website_url: profile.website_url,
                industry: profile.industry ?? undefined,
                description: profile.description,
                customer_pain_points: profile.customer_pain_points ?? undefined,
                key_features: profile.key_features ?? undefined,
                social_proof: profile.social_proof ?? undefined,
                preferred_language: profile.preferred_language ?? undefined,
                outreach_goal: profile.outreach_goal ?? undefined,
                message_tone: profile.message_tone ?? undefined,
                profile_source: profile.profile_source,
              },
              state,
              toolOptions,
            );
          const emailPlay =
            plays.find((play) => play.channel === "email") ?? plays[0]!;
          const activation =
            await invokeLangGraphTool<ActivationConfigureResult>(
              tools.activationConfigure,
              {
                rep,
                icp: {
                  name: icp.name,
                  description: icp.description,
                  signal_kind: icp.signal_kind,
                  match_threshold: icp.match_threshold,
                  nice_to_haves: icp.nice_to_haves,
                },
                play: {
                  name: emailPlay.name,
                  daily_cap: emailPlay.daily_cap,
                  approval: emailPlay.approval,
                },
              },
              { ...state, company_id: companyProfile.company_id },
              toolOptions,
            );
          const linkedInPlay = plays.find(
            (play) => play.channel === "linkedin_dm",
          );
          const linkedIn = linkedInPlay
            ? await invokeLangGraphTool<PlayConfigureResult>(
                tools.signalLinkedInPlayConfigure,
                {
                  rep_id: activation.rep_id,
                  name: linkedInPlay.name,
                  signal_kind: linkedInPlay.signal_kind,
                  icp_name: icp.name,
                  action: "linkedin_dm",
                  daily_cap: linkedInPlay.daily_cap,
                  approval: linkedInPlay.approval,
                },
                {
                  ...state,
                  rep_id: activation.rep_id,
                  play_id: activation.play_id,
                  company_id: companyProfile.company_id,
                },
                toolOptions,
              )
            : null;
          const sources = await invokeLangGraphTool<SourceConfigureResult>(
            tools.defaultAggregatorConfigure,
            {
              company_name: profile.company_name,
              website_url: profile.website_url,
              industry: profile.industry,
              description: profile.description,
              signal_kind: icp.signal_kind,
            },
            {
              ...state,
              rep_id: activation.rep_id,
              play_id: linkedIn?.play_id ?? activation.play_id,
              company_id: companyProfile.company_id,
            },
            toolOptions,
          );
          return {
            rep_id: activation.rep_id,
            play_id: linkedIn?.play_id ?? activation.play_id,
            company_id: companyProfile.company_id,
            attributes: mergeAttributes(state, {
              activation_result: activation,
              company_profile_result: companyProfile,
              email_play_id: activation.play_id,
              linkedin_play_id: linkedIn?.play_id ?? null,
              source_result: sources,
            }),
            tool_results: {
              company_profile_configure: companyProfile,
              activation_configure: activation,
              linkedin_play_configure: linkedIn,
              default_aggregator_configure: sources,
            },
          };
        },
      }),
    )
    .addNode(
      "checklist",
      traceLangGraphNode({
        graph_name: ACTIVATION_SETUP_GRAPH_NAME,
        node_name: "checklist",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const profile = getAttribute<ActivationProfileDraft>(
            state,
            "profile_draft",
          );
          const outlook = await invokeLangGraphTool<ConnectIntent>(
            tools.outlookConnectUrlGet,
            {},
            state,
            toolOptions,
          );
          const linkedIn = await invokeLangGraphTool<ConnectIntent>(
            tools.linkedInConnectUrlGet,
            {},
            state,
            toolOptions,
          );
          const checklist = launchChecklistFromState(
            state,
            profile,
            outlook,
            linkedIn,
          );
          return {
            attributes: mergeAttributes(state, {
              launch_checklist: checklist,
              ready_to_launch: checklist.ready_to_launch,
            }),
            tool_results: {
              outlook_connect_url: outlook,
              linkedin_connect_url: linkedIn,
            },
          };
        },
      }),
    )
    .addEdge(START, "request")
    .addEdge("request", "profile")
    .addEdge("profile", "draft")
    .addEdge("draft", "configure")
    .addEdge("configure", "checklist")
    .addEdge("checklist", END)
    .compile({ checkpointer: createLangGraphMemoryCheckpoint() });
}

export async function runActivationSetupGraphInWorkflowStep(opts: {
  ctx: RunContext;
  input: ActivationSetupGraphInput;
  bus?: EventBus;
  graphOptions?: Omit<ActivationSetupGraphOptions, "bus" | "toolOptions"> & {
    toolOptions?: Omit<LangGraphToolOptions, "bus">;
  };
}): Promise<BombsellLangGraphState> {
  const workspace_id = opts.input.workspace_id ?? opts.ctx.workspace_id;
  if (!workspace_id) {
    throw new Error("activation setup graph requires a workspace_id");
  }
  const website_url = normalizeOrThrow(opts.input.website_url);
  const graph = createActivationSetupGraph({
    ...opts.graphOptions,
    bus: opts.bus,
    toolOptions: {
      ...opts.graphOptions?.toolOptions,
      defaultContext: {
        ...opts.graphOptions?.toolOptions?.defaultContext,
        workspace_id,
        user_id: opts.input.user_id,
      },
    },
  });
  return runLangGraphInWorkflowStep({
    graph_name: ACTIVATION_SETUP_GRAPH_NAME,
    graph,
    ctx: opts.ctx,
    bus: opts.bus,
    state: {
      workspace_id,
      thread_id:
        opts.input.thread_id ?? `activation:${workspace_id}:${opts.ctx.run_id}`,
      run_id: opts.input.run_id ?? opts.ctx.run_id,
      correlation_id: opts.input.correlation_id ?? opts.ctx.correlation_id,
      causation_event_id: opts.input.causation_event_id ?? null,
      graph_name: ACTIVATION_SETUP_GRAPH_NAME,
      attributes: {
        website_url,
        user_id: opts.input.user_id,
        company_hint: opts.input.company_hint ?? null,
        allowed_industries: opts.input.allowed_industries ?? [],
      },
      tool_results: {},
      approvals: {},
    },
  });
}

function activationInputFromState(
  state: BombsellLangGraphState,
): ActivationSetupGraphInput {
  return {
    workspace_id: state.workspace_id,
    user_id: String(state.attributes?.user_id ?? ""),
    website_url: String(state.attributes?.website_url ?? ""),
    company_hint: stringOrUndefined(state.attributes?.company_hint),
    industry_hint: stringOrUndefined(state.attributes?.industry_hint),
    description_hint: stringOrUndefined(state.attributes?.description_hint),
    customer_pain_points: stringOrUndefined(state.attributes?.customer_pain_points),
    key_features: stringOrUndefined(state.attributes?.key_features),
    social_proof: stringOrUndefined(state.attributes?.social_proof),
    preferred_language: stringOrUndefined(state.attributes?.preferred_language),
    outreach_goal: stringOrUndefined(state.attributes?.outreach_goal),
    message_tone: stringOrUndefined(state.attributes?.message_tone),
    allowed_industries: arrayOfStrings(state.attributes?.allowed_industries),
    thread_id: state.thread_id,
    run_id: state.run_id,
    correlation_id: state.correlation_id,
    causation_event_id: state.causation_event_id ?? null,
  };
}

function normalizedWebsiteFromState(state: BombsellLangGraphState): string {
  return normalizeOrThrow(state.attributes?.website_url);
}

function normalizeOrThrow(value: unknown): string {
  const website_url = normalizeCompanyWebsiteUrl(value);
  if (!website_url) throw new Error("valid website_url required");
  return website_url;
}

function fallbackProfile(
  website_url: string,
  company_hint?: string,
): WebsiteProfileExtractResult {
  const domain = domainFromUrl(website_url);
  const companyName = company_hint?.trim() || titleizeDomain(domain);
  return {
    company_name: companyName,
    website_url,
    industry: null,
    description: `Public website profile for ${companyName}. Bombsell could not read enough website content automatically, so this setup starts from the domain and should be reviewed before launch.`,
  };
}

function profileDraftFromState(
  state: BombsellLangGraphState,
): ActivationProfileDraft {
  const raw = getAttribute<WebsiteProfileExtractResult>(
    state,
    "website_profile",
  );
  const input = activationInputFromState(state);
  const website_url = normalizeOrThrow(raw.website_url);
  const domain = domainFromUrl(website_url);
  const company_name = raw.company_name?.trim() || titleizeDomain(domain);
  const description =
    input.description_hint?.trim() ||
    raw.description?.trim() ||
    fallbackProfile(website_url, company_name).description!;
  const profile_source = /could not read enough website content/i.test(
    description,
  )
    ? "fallback"
    : "firecrawl";
  return {
    company_name,
    website_url,
    domain,
    industry: input.industry_hint?.trim() || raw.industry?.trim() || null,
    description,
    customer_pain_points: input.customer_pain_points?.trim() || null,
    key_features: input.key_features?.trim() || null,
    social_proof: input.social_proof?.trim() || null,
    preferred_language: input.preferred_language?.trim() || null,
    outreach_goal: input.outreach_goal?.trim() || null,
    message_tone: input.message_tone?.trim() || null,
    profile_source,
    confidence: profile_source === "fallback" ? 0.45 : 0.72,
    evidence: [
      { label: "Website", value: website_url, source_ref: website_url },
      ...(raw.industry ? [{ label: "Industry", value: raw.industry }] : []),
      {
        label: "Description",
        value: description.slice(0, 280),
        source_ref: website_url,
      },
    ],
    needs_review: [
      "Keep company positioning and voice editable before external outreach expands.",
      "Keep ICP assumptions visible before the first Play scales volume.",
    ],
  };
}

function repDraftFromProfile(
  profile: ActivationProfileDraft,
): ActivationRepDraft {
  return {
    name: "Outbound agent",
    role: "sdr",
    voice:
      "Clear, specific, low-hype, and useful. Never pretend to know more than the signal proves.",
    story: `Turns market movement around ${profile.company_name} into careful founder-led conversations.`,
    daily_cap: 15,
    approval: "none",
  };
}

function icpDraftFromProfile(
  profile: ActivationProfileDraft,
): ActivationIcpDraft {
  const market = profile.industry ?? "this market";
  return {
    name: `${profile.company_name} timing signals`,
    description: `${profile.description} Match companies and people showing fresh public momentum, hiring, launches, funding, or competitive movement relevant to ${market}.`,
    signal_kind: "press_mention",
    match_threshold: 0.6,
    nice_to_haves: [
      `Relevant to ${profile.company_name}`,
      profile.industry ? `Mentions ${profile.industry}` : "Clear market timing",
      "Fresh enough to justify outreach",
    ],
    inferred_from: {
      website_url: profile.website_url,
      company_name: profile.company_name,
    },
    needs_review: [
      "Confirm the best buyer persona.",
      "Confirm any companies, roles, or industries Bombsell should not contact.",
    ],
  };
}

function playDraftsFromProfile(
  profile: ActivationProfileDraft,
): ActivationPlayDraft[] {
  return [
    {
      channel: "email",
      name: `${profile.company_name} Signal Email`,
      signal_kind: "press_mention",
      daily_cap: 15,
      approval: "none",
    },
    {
      channel: "linkedin_dm",
      name: `${profile.company_name} Signal LinkedIn DM`,
      signal_kind: "press_mention",
      daily_cap: 8,
      approval: "none",
    },
  ];
}

function sourcePlanFromProfile(
  profile: ActivationProfileDraft,
): ActivationSourcePlan {
  const market = profile.industry ?? "market";
  return {
    adapters: [
      {
        adapter: "google_news",
        signal_kind: "press_mention",
        reason: `Track public market movement around ${profile.company_name} and ${market}.`,
      },
      {
        adapter: "hn_front",
        signal_kind: "product_launch",
        reason: "Catch launch moments that can justify founder-led outreach.",
      },
      {
        adapter: "hn_whos_hiring",
        signal_kind: "hiring",
        reason: "Find hiring changes that imply operational urgency.",
      },
      {
        adapter: "product_hunt",
        signal_kind: "product_launch",
        reason: "Watch new products entering or reshaping the market.",
      },
    ],
  };
}

function launchChecklistFromState(
  state: BombsellLangGraphState,
  profile: ActivationProfileDraft,
  outlook: ConnectIntent,
  linkedIn: ConnectIntent,
): ActivationLaunchChecklist {
  const source = getAttribute<SourceConfigureResult>(state, "source_result");
  const hasSources = source.source_count > 0;
  const items: ActivationChecklistItem[] = [
    {
      id: "company_profile",
      primitive: "Rep",
      label: "Company profile drafted",
      status: "needs_review",
      blocking: false,
      detail: `${profile.company_name} profile is ready for review with source-backed assumptions.`,
    },
    {
      id: "rep",
      primitive: "Rep",
      label: "Rep created",
      status: state.rep_id ? "complete" : "blocked",
      blocking: !state.rep_id,
      detail: "The outbound agent is configured for founder-led email and LinkedIn outreach.",
    },
    {
      id: "signals",
      primitive: "Signal",
      label: "Signal sources configured",
      status: hasSources ? "complete" : "blocked",
      blocking: !hasSources,
      detail: hasSources
        ? `${source.source_count} free-source-first signal adapters are configured.`
        : "No Signal sources were configured.",
    },
    {
      id: "plays",
      primitive: "Play",
      label: "Email and LinkedIn Plays drafted",
      status: getAttribute<string | null>(state, "linkedin_play_id")
        ? "complete"
        : "needs_review",
      blocking: false,
      detail:
        "First Plays are approval-first and cannot send until channel gates are healthy.",
    },
    {
      id: "outlook_connection",
      primitive: "Conversation",
      label: "Connect Outlook before email outreach",
      status: "blocked",
      blocking: true,
      detail: outlook.provider_configured
        ? "Outlook connection is required before any email Play can launch."
        : "Microsoft Graph is not configured, so email outreach is blocked.",
      action_url: outlook.connect_url,
    },
    {
      id: "linkedin_connection",
      primitive: "Conversation",
      label: "Connect LinkedIn before DM outreach",
      status: "blocked",
      blocking: true,
      detail: linkedIn.provider_configured
        ? "LinkedIn account connection is required before DM outreach can launch."
        : "LinkedIn provider is not configured, so LinkedIn outreach is blocked.",
      action_url: linkedIn.connect_url,
    },
    {
      id: "outcome_loop",
      primitive: "Outcome",
      label: "Outcome learning waits for replies",
      status: "needs_review",
      blocking: false,
      detail: "Reply and meeting Outcomes will teach Play Skills after launch.",
    },
  ];
  const send_blocked = items.some(
    (item) => item.blocking && item.status !== "complete",
  );
  return {
    ready_to_launch: !send_blocked,
    send_blocked,
    items,
  };
}

async function publishActivationEvent(
  bus: EventBus | undefined,
  state: BombsellLangGraphState,
  event_type: "workspace.activation.requested",
  payload: EventPayload<"workspace.activation.requested">,
  idempotencySuffix: string,
): Promise<void>;
async function publishActivationEvent(
  bus: EventBus | undefined,
  state: BombsellLangGraphState,
  event_type: "workspace.profile.drafted",
  payload: EventPayload<"workspace.profile.drafted">,
  idempotencySuffix: string,
): Promise<void>;
async function publishActivationEvent(
  bus: EventBus | undefined,
  state: BombsellLangGraphState,
  event_type: "icp.drafted",
  payload: EventPayload<"icp.drafted">,
  idempotencySuffix: string,
): Promise<void>;
async function publishActivationEvent<T extends EventType>(
  bus: EventBus | undefined,
  state: BombsellLangGraphState,
  event_type: T,
  payload: EventPayload<T>,
  idempotencySuffix: string,
): Promise<void> {
  if (!bus) return;
  await bus.publish({
    workspace_id: state.workspace_id,
    event_type,
    source: "agent",
    producer_ref: `langgraph:${ACTIVATION_SETUP_GRAPH_NAME}`,
    correlation_id: state.correlation_id,
    causation_id: state.causation_event_id ?? null,
    idempotency_key: `${state.run_id}:${idempotencySuffix}`,
    payload,
  });
}

function getAttribute<T>(state: BombsellLangGraphState, key: string): T {
  return state.attributes?.[key] as T;
}

function mergeAttributes(
  state: Partial<BombsellLangGraphState>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(state.attributes ?? {}), ...patch };
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function arrayOfStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
  return strings.length ? strings : undefined;
}

function domainFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function titleizeDomain(domain: string | null): string {
  const stem = domain?.split(".")[0]?.replace(/[-_]+/g, " ") ?? "Workspace";
  return stem.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

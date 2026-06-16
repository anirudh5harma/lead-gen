import { END, START, StateGraph } from "@langchain/langgraph";
import type {
  EventBus,
  EventPayload,
  EventType,
} from "../../../substrate/events/index.ts";
import type { RunContext } from "../../../substrate/workflows/index.ts";
import { normalizeCompanyWebsiteUrl } from "../../../product/company-profile.ts";
import {
  createLangGraphMemoryCheckpoint,
} from "../checkpoint.ts";
import {
  type BombsellLangGraphState,
  BombsellGraphStateAnnotation,
} from "../state.ts";
import {
  invokeLangGraphTool,
  type LangGraphToolOptions,
} from "../tools.ts";
import {
  runLangGraphInWorkflowStep,
  traceLangGraphNode,
} from "../runtime.ts";

export const PROFILE_ICP_GRAPH_NAME = "profile.icp_graph.v1";

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

export interface ProfileIcpGraphInput {
  workspace_id?: string;
  user_id: string;
  website_url: string;
  company_hint?: string;
  allowed_industries?: string[];
  thread_id?: string;
  run_id?: string;
  correlation_id?: string;
  causation_event_id?: string | null;
}

export interface ProfileIcpProfileDraft {
  company_name: string;
  website_url: string;
  domain: string | null;
  industry: string | null;
  description: string;
  profile_source: "firecrawl" | "fallback" | "manual";
  confidence: number;
  evidence: Array<{ label: string; value: string; source_ref?: string | null }>;
  needs_review: string[];
}

export interface ProfileIcpDraft {
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

export interface ProfileIcpDecision {
  workspace_id: string;
  company_name: string;
  website_url: string;
  signal_kind: SignalKind;
  confidence: number;
  needs_review_count: number;
  next_action: "review_profile_and_icp" | "confirm_setup_primitives";
}

export interface ProfileIcpGraphOptions {
  bus?: EventBus;
  tools?: Partial<{
    websiteProfileExtract: string;
  }>;
  toolOptions?: LangGraphToolOptions;
}

interface WebsiteProfileExtractResult {
  company_name: string | null;
  website_url: string;
  industry: string | null;
  description: string | null;
}

const DEFAULT_TOOLS = {
  websiteProfileExtract: "product.company.website_profile.extract",
} as const;

export function createProfileIcpGraph(opts: ProfileIcpGraphOptions = {}) {
  const tools = { ...DEFAULT_TOOLS, ...opts.tools };
  const toolOptions = { ...opts.toolOptions, bus: opts.bus };

  return new StateGraph(BombsellGraphStateAnnotation)
    .addNode(
      "request",
      traceLangGraphNode({
        graph_name: PROFILE_ICP_GRAPH_NAME,
        node_name: "request",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const input = profileIcpInputFromState(state);
          const website_url = normalizeOrThrow(input.website_url);
          await publishProfileIcpEvent(opts.bus, state, "workspace.activation.requested", {
            website_url,
            requested_by: input.user_id,
            graph_name: PROFILE_ICP_GRAPH_NAME,
            run_id: state.run_id,
          }, "requested");
          return {
            attributes: mergeAttributes(state, {
              website_url,
              user_id: input.user_id,
              company_hint: input.company_hint ?? null,
              allowed_industries: input.allowed_industries ?? [],
            }),
          };
        },
      }),
    )
    .addNode(
      "extract",
      traceLangGraphNode({
        graph_name: PROFILE_ICP_GRAPH_NAME,
        node_name: "extract",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const input = profileIcpInputFromState(state);
          const website_url = normalizedWebsiteFromState(state);
          const profile = await invokeLangGraphTool<WebsiteProfileExtractResult | null>(
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
        graph_name: PROFILE_ICP_GRAPH_NAME,
        node_name: "draft",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const profile = profileDraftFromState(state);
          const icp = icpDraftFromProfile(profile);
          await publishProfileIcpEvent(opts.bus, state, "workspace.profile.drafted", {
            company_name: profile.company_name,
            website_url: profile.website_url,
            domain: profile.domain,
            industry: profile.industry,
            description: profile.description,
            profile_source: profile.profile_source,
            confidence: profile.confidence,
            evidence: profile.evidence,
            needs_review: profile.needs_review,
          }, "profile-drafted");
          await publishProfileIcpEvent(opts.bus, state, "icp.drafted", icp, "icp-drafted");
          return {
            attributes: mergeAttributes(state, {
              profile_draft: profile,
              icp_draft: icp,
            }),
          };
        },
      }),
    )
    .addNode(
      "decide",
      traceLangGraphNode({
        graph_name: PROFILE_ICP_GRAPH_NAME,
        node_name: "decide",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const profile = getAttribute<ProfileIcpProfileDraft>(state, "profile_draft");
          const icp = getAttribute<ProfileIcpDraft>(state, "icp_draft");
          const needs_review_count = profile.needs_review.length + icp.needs_review.length;
          const decision: ProfileIcpDecision = {
            workspace_id: state.workspace_id,
            company_name: profile.company_name,
            website_url: profile.website_url,
            signal_kind: icp.signal_kind,
            confidence: profile.confidence,
            needs_review_count,
            next_action: needs_review_count > 0
              ? "review_profile_and_icp"
              : "confirm_setup_primitives",
          };
          return {
            attributes: mergeAttributes(state, {
              profile_icp: decision,
              next_action: decision.next_action,
            }),
            tool_results: {
              profile_icp_decision: decision,
            },
          };
        },
      }),
    )
    .addEdge(START, "request")
    .addEdge("request", "extract")
    .addEdge("extract", "draft")
    .addEdge("draft", "decide")
    .addEdge("decide", END)
    .compile({ checkpointer: createLangGraphMemoryCheckpoint() });
}

export async function runProfileIcpGraphInWorkflowStep(opts: {
  ctx: RunContext;
  input: ProfileIcpGraphInput;
  bus?: EventBus;
  graphOptions?: Omit<ProfileIcpGraphOptions, "bus" | "toolOptions"> & {
    toolOptions?: Omit<LangGraphToolOptions, "bus">;
  };
}): Promise<BombsellLangGraphState> {
  const workspace_id = opts.input.workspace_id ?? opts.ctx.workspace_id;
  if (!workspace_id) {
    throw new Error("profile ICP graph requires a workspace_id");
  }
  const website_url = normalizeOrThrow(opts.input.website_url);
  const graph = createProfileIcpGraph({
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
    graph_name: PROFILE_ICP_GRAPH_NAME,
    graph,
    ctx: opts.ctx,
    bus: opts.bus,
    state: {
      workspace_id,
      thread_id: opts.input.thread_id ?? `profile-icp:${workspace_id}:${opts.ctx.run_id}`,
      run_id: opts.input.run_id ?? opts.ctx.run_id,
      correlation_id: opts.input.correlation_id ?? opts.ctx.correlation_id,
      causation_event_id: opts.input.causation_event_id ?? null,
      graph_name: PROFILE_ICP_GRAPH_NAME,
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

function profileIcpInputFromState(state: BombsellLangGraphState): ProfileIcpGraphInput {
  return {
    workspace_id: state.workspace_id,
    user_id: String(state.attributes?.user_id ?? ""),
    website_url: String(state.attributes?.website_url ?? ""),
    company_hint: stringOrUndefined(state.attributes?.company_hint),
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
    description:
      `Public website profile for ${companyName}. Bombsell could not read enough website content automatically, so this setup starts from the domain and should be reviewed before launch.`,
  };
}

function profileDraftFromState(state: BombsellLangGraphState): ProfileIcpProfileDraft {
  const raw = getAttribute<WebsiteProfileExtractResult>(state, "website_profile");
  const website_url = normalizeOrThrow(raw.website_url);
  const domain = domainFromUrl(website_url);
  const company_name = raw.company_name?.trim() || titleizeDomain(domain);
  const fallback = fallbackProfile(website_url, company_name);
  const description = raw.description?.trim() || fallback.description!;
  const profile_source = /could not read enough website content/i.test(description)
    ? "fallback"
    : "firecrawl";
  return {
    company_name,
    website_url,
    domain,
    industry: raw.industry?.trim() || null,
    description,
    profile_source,
    confidence: profile_source === "fallback" ? 0.45 : 0.72,
    evidence: [
      { label: "Website", value: website_url, source_ref: website_url },
      ...(raw.industry ? [{ label: "Industry", value: raw.industry }] : []),
      { label: "Description", value: description.slice(0, 280), source_ref: website_url },
    ],
    needs_review: [
      "Confirm company positioning and voice before external outreach.",
      "Confirm ICP assumptions before the first Play can leave approval mode.",
    ],
  };
}

function icpDraftFromProfile(profile: ProfileIcpProfileDraft): ProfileIcpDraft {
  const market = profile.industry ?? "this market";
  return {
    name: `${profile.company_name} timing signals`,
    description:
      `${profile.description} Match companies and people showing fresh public momentum, hiring, launches, funding, or competitive movement relevant to ${market}.`,
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

async function publishProfileIcpEvent(
  bus: EventBus | undefined,
  state: BombsellLangGraphState,
  event_type: "workspace.activation.requested",
  payload: EventPayload<"workspace.activation.requested">,
  idempotencySuffix: string,
): Promise<void>;
async function publishProfileIcpEvent(
  bus: EventBus | undefined,
  state: BombsellLangGraphState,
  event_type: "workspace.profile.drafted",
  payload: EventPayload<"workspace.profile.drafted">,
  idempotencySuffix: string,
): Promise<void>;
async function publishProfileIcpEvent(
  bus: EventBus | undefined,
  state: BombsellLangGraphState,
  event_type: "icp.drafted",
  payload: EventPayload<"icp.drafted">,
  idempotencySuffix: string,
): Promise<void>;
async function publishProfileIcpEvent<T extends EventType>(
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
    producer_ref: `langgraph:${PROFILE_ICP_GRAPH_NAME}`,
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
    (item): item is string => typeof item === "string" && item.trim().length > 0,
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

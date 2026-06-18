import type { Pool } from "pg";
import { getPool } from "../substrate/storage/index.ts";
import {
  assertProductWorkspaceAccess,
  type ProductWorkspaceSession,
} from "./app.ts";
import {
  formatCompanyBrainMarkdown,
  getWorkspaceCompanyBrain,
} from "./company-brain.ts";
import {
  formatVerticalIntelligenceMarkdown,
  parseVerticalIntelligencePack,
  type VerticalIntelligencePack,
} from "./vertical-intelligence.ts";

interface ContextRepRow {
  id: string;
  name: string;
  role: string;
  status: string;
  persona: { voice?: string; story?: string } | null;
  autonomy: { channels?: Record<string, { daily_cap?: number; approval?: string }> } | null;
}

interface ContextIcpRow {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  match_threshold: string;
}

interface ContextPlayRow {
  id: string;
  name: string;
  status: string;
  declaration: string;
}

interface ContextSignalRow {
  id: string;
  kind: string | null;
  title: string;
  status: string;
  match_score: string | null;
  freshness_at: Date;
}

interface ContextSourceRow {
  name: string;
  kind: string;
  enabled: boolean;
  signal_count: number | string;
  last_polled_at: Date | null;
  latest_run_status: string | null;
}

interface ContextPendingApprovalRow {
  id: string;
  run_id: string;
  kind: string;
  reason: string | null;
}

interface ContextSendTraceRow {
  subject: string | null;
  person_name: string | null;
  company_name: string | null;
  status: string;
  eval_score: string | null;
  eval_passed: boolean | null;
  approval_policy: string | null;
}

interface ContextRecoveryRow {
  id: string;
  workflow_name: string;
  failed_step_name: string | null;
  error: string | null;
}

interface ContextChannelAccount {
  display_name: string;
  kind: string;
  status: string;
  daily_cap: number | null;
  daily_used: number;
  provider_status: string | null;
  domain: string | null;
  warmup_state: string | null;
  current_daily_cap: number | null;
  bounce_rate_24h: string | null;
}

interface ContextProfile {
  company_id: string;
  company_name: string;
  domain: string | null;
  website_url: string | null;
  industry: string | null;
  company_size?: string | null;
  description: string | null;
  value_proposition?: string | null;
  customer_pain_points?: string | null;
  key_features?: string | null;
  social_proof?: string | null;
  linkedin_company_url?: string | null;
  exa_summary: string | null;
  exa_source_domains: string[];
  exa_market_terms: string[];
  exa_positioning_notes: string[];
  exa_competitor_mentions: string[];
  exa_audience_terms: string[];
  exa_proof_points: string[];
  exa_evidence_cards: Array<{
    title: string | null;
    url: string | null;
    source_domain: string | null;
    snippet: string | null;
    published_at: string | null;
  }>;
  exa_evidence_source_ids: string[];
  exa_result_count: number;
  exa_enriched_at: string | null;
  vertical_intelligence: VerticalIntelligencePack | null;
}

interface ContextProfileRow {
  company_id: string;
  company_name: string;
  domain: string | null;
  website_url: string | null;
  industry: string | null;
  company_size: string | null;
  description: string | null;
  value_proposition: string | null;
  customer_pain_points: string | null;
  key_features: string | null;
  social_proof: string | null;
  linkedin_company_url: string | null;
  exa_summary: string | null;
  exa_source_domains: unknown;
  exa_market_terms: unknown;
  exa_positioning_notes: unknown;
  exa_competitor_mentions: unknown;
  exa_audience_terms: unknown;
  exa_proof_points: unknown;
  exa_evidence_cards: unknown;
  exa_evidence_source_ids: unknown;
  exa_result_count: string | number | null;
  exa_enriched_at: string | null;
  vertical_intelligence: unknown;
}

interface ContextRecommendationQuality {
  total_reviewed: number;
  accepted: number;
  ignored: number;
  acceptance_rate: number | null;
  last_reviewed_at: string | null;
  content_opportunity: ContextRecommendationQualityLine;
  aeo_gap: ContextRecommendationQualityLine;
}

interface ContextRecommendationQualityLine {
  total_reviewed: number;
  accepted: number;
  ignored: number;
  acceptance_rate: number | null;
  last_reviewed_at: string | null;
}

export interface WorkspaceAgentContext {
  workspace_id: string;
  generated_at: string;
  markdown: string;
  counts: {
    reps: number;
    icps: number;
    plays: number;
    sources: number;
    pending_approvals: number;
    recent_signals: number;
    recent_conversations: number;
    recent_outcomes: number;
    reviewed_recommendations: number;
    company_brain_cards: number;
  };
}

export async function getWorkspaceAgentContext(
  session: ProductWorkspaceSession,
  pool: Pool = getPool(),
): Promise<WorkspaceAgentContext> {
  await assertProductWorkspaceAccess(session, pool);
  const [
    reps,
    icps,
    plays,
    signals,
    profile,
    sources,
    pendingApprovals,
    conversationCount,
    outcomeCount,
    sendTraces,
    channelAccounts,
    recoveryQueue,
    companyBrain,
  ] = await Promise.all([
    pool.query<ContextRepRow>(
      `select id, name, role::text as role, status::text as status, persona, autonomy
         from reps
        where workspace_id = $1
        order by created_at asc
        limit 8`,
      [session.workspace_id],
    ),
    pool.query<ContextIcpRow>(
      `select id, name, description, enabled, match_threshold::text as match_threshold
         from workspace_icps
        where workspace_id = $1
        order by enabled desc, created_at asc
        limit 8`,
      [session.workspace_id],
    ),
    pool.query<ContextPlayRow>(
      `select id, name, status::text as status, declaration
         from plays
        where workspace_id = $1
        order by created_at asc
        limit 8`,
      [session.workspace_id],
    ),
    pool.query<ContextSignalRow>(
      `select id, kind::text as kind, title, status::text as status,
              match_score::text as match_score, freshness_at
         from signals
        where workspace_id = $1
        order by ingested_at desc
        limit 8`,
      [session.workspace_id],
    ),
    pool.query<ContextProfileRow>(
      `select id::text as company_id,
              name as company_name,
              domain::text as domain,
              properties->>'website_url' as website_url,
              industry,
              size_bucket as company_size,
              description,
              properties->>'value_proposition' as value_proposition,
              properties->>'customer_pain_points' as customer_pain_points,
              properties->>'key_features' as key_features,
              properties->>'social_proof' as social_proof,
              properties->>'linkedin_company_url' as linkedin_company_url,
              properties #>> '{exa_profile,summary}' as exa_summary,
              coalesce(properties #> '{exa_profile,intelligence,source_domains}', properties #> '{exa_profile,source_domains}', '[]'::jsonb) as exa_source_domains,
              coalesce(properties #> '{exa_profile,intelligence,market_terms}', properties #> '{exa_profile,market_terms}', '[]'::jsonb) as exa_market_terms,
              coalesce(properties #> '{exa_profile,intelligence,positioning_notes}', properties #> '{exa_profile,positioning_notes}', '[]'::jsonb) as exa_positioning_notes,
              coalesce(properties #> '{exa_profile,intelligence,competitor_mentions}', properties #> '{exa_profile,competitor_mentions}', '[]'::jsonb) as exa_competitor_mentions,
              coalesce(properties #> '{exa_profile,intelligence,audience_terms}', properties #> '{exa_profile,audience_terms}', '[]'::jsonb) as exa_audience_terms,
              coalesce(properties #> '{exa_profile,intelligence,proof_points}', properties #> '{exa_profile,proof_points}', '[]'::jsonb) as exa_proof_points,
              coalesce(properties #> '{exa_profile,intelligence,evidence_cards}', properties #> '{profile_intelligence,evidence_cards}', '[]'::jsonb) as exa_evidence_cards,
              coalesce(properties #> '{exa_profile,evidence_source_ids}', properties #> '{profile_intelligence,evidence_source_ids}', '[]'::jsonb) as exa_evidence_source_ids,
              coalesce(properties #>> '{exa_profile,result_count}', '0') as exa_result_count,
              properties #>> '{exa_profile,enriched_at}' as exa_enriched_at,
              coalesce(properties #> '{vertical_intelligence}', '{}'::jsonb) as vertical_intelligence
         from graph_companies
        where workspace_id = $1
          and properties->>'profile_role' = 'workspace_company'
        order by updated_at desc
        limit 1`,
      [session.workspace_id],
    ),
    pool.query<ContextSourceRow>(
      `select gs.name,
              gs.kind::text as kind,
              gs.enabled,
              count(s.id)::int as signal_count,
              gs.last_polled_at,
              null::text as latest_run_status
         from graph_sources gs
         left join signals s
           on s.workspace_id = gs.workspace_id
          and s.source_id = gs.id
        where gs.workspace_id = $1
        group by gs.id
        order by gs.enabled desc, gs.created_at asc
        limit 8`,
      [session.workspace_id],
    ),
    pool.query<ContextPendingApprovalRow>(
      `select id::text,
              run_id::text,
              kind,
              reason
         from workflow_approvals
        where workspace_id = $1
          and decision = 'pending'
        order by created_at desc
        limit 8`,
      [session.workspace_id],
    ),
    pool.query<{ count: string }>(
      `select count(*)::int as count
         from conversations
        where workspace_id = $1
          and last_activity_at > now() - interval '30 days'`,
      [session.workspace_id],
    ),
    pool.query<{ count: string }>(
      `select count(*)::int as count
         from outcomes
        where workspace_id = $1
          and occurred_at > now() - interval '30 days'`,
      [session.workspace_id],
    ),
    pool.query<ContextSendTraceRow>(
      `select m.subject,
              gp.full_name as person_name,
              gc.name as company_name,
              m.status::text as status,
              m.eval_score::text as eval_score,
              m.eval_passed,
              coalesce(m.properties->>'approval_policy', m.eval_notes->>'approval_policy') as approval_policy
         from messages m
         join conversations c
           on c.workspace_id = m.workspace_id
          and c.id = m.conversation_id
         left join graph_persons gp
           on gp.workspace_id = c.workspace_id
          and gp.id = c.counterparty_person_id
         left join graph_companies gc
           on gc.workspace_id = c.workspace_id
          and gc.id = c.counterparty_company_id
        where m.workspace_id = $1
          and m.direction = 'outbound'
          and m.channel = 'email'
        order by m.created_at desc
        limit 8`,
      [session.workspace_id],
    ),
    pool.query<ContextChannelAccount>(
      `select ca.display_name,
              ca.kind::text as kind,
              ca.status::text as status,
              ca.daily_cap,
              ca.daily_used,
              ca.properties->>'provider_status' as provider_status,
              sd.domain::text as domain,
              sd.warmup_state::text as warmup_state,
              sd.current_daily_cap,
              sd.bounce_rate_24h::text as bounce_rate_24h
         from channel_accounts ca
         left join sending_domains sd
           on sd.workspace_id = ca.workspace_id
          and sd.channel_account_id = ca.id
        where ca.workspace_id = $1
        order by ca.created_at asc
        limit 8`,
      [session.workspace_id],
    ),
    pool.query<ContextRecoveryRow>(
      `select wr.id::text,
              wr.workflow_name,
              ws.step_name as failed_step_name,
              coalesce(wr.error->>'message', ws.error->>'message') as error
         from workflow_runs wr
         left join lateral (
           select step_name, error
             from workflow_steps
            where run_id = wr.id
              and status = 'failed'
            order by step_position desc, attempt desc
            limit 1
         ) ws on true
        where wr.workspace_id = $1
          and wr.status = 'failed'
        order by wr.ended_at desc nulls last, wr.created_at desc
        limit 8`,
      [session.workspace_id],
    ),
    getWorkspaceCompanyBrain(session, pool, { skipAccessCheck: true }),
  ]);

  const generatedAt = new Date().toISOString();
  const profileState = mapContextProfile(profile.rows[0] ?? null);
  const recommendationQuality = emptyRecommendationQuality();
  const markdown = [
    "# Bombsell Workspace Context",
    "",
    `Generated: ${generatedAt}`,
    `Workspace: ${session.workspace_id}`,
    "",
    "## Product Vocabulary",
    "- Brief: the current operating summary with 24h and 7d qualified signals, signal mix, sent email/LinkedIn outreach, replies, meetings, and next action.",
    "- Profile: company positioning, ICP, contact-quality preferences, Outlook and LinkedIn connections, account health, and launch guardrails.",
    "- Agent: the execution surface for qualified signals, verified contacts, judged drafts, sent outreach, replies, meetings, and learning.",
    "- Outreach: derived email and LinkedIn messages tied to a Conversation, a verified contact, and the Signal that justified action.",
    "",
    "## Operating Rules",
    "- Use the registered tools as primitives; compose outcomes from tools instead of assuming hidden features.",
    "- State changes should flow through typed product/graph tools and durable workflows.",
    "- Keep user-facing language simple: Brief, Profile, Agent, qualified signals, verified contacts, outreach, replies, and meetings.",
    "- Preserve the durable architecture underneath; never bypass workflow, event, graph, eval, or channel-readiness contracts.",
    "- Approved sends still pass through verified contact resolution, judge, deliverability, duplicate-contact, and channel gates.",
    "",
    "## Current Counts",
    `- Active agents: ${reps.rows.length}`,
    `- ICP segments: ${icps.rows.length}`,
    `- Outreach rules: ${plays.rows.length}`,
    `- Sources: ${sources.rows.length}`,
    `- Pending approvals: ${pendingApprovals.rows.length}`,
    `- Recent signals: ${signals.rows.length}`,
    `- Recent conversations: ${numericCount(conversationCount.rows[0]?.count)}`,
    `- Recent outcomes: ${numericCount(outcomeCount.rows[0]?.count)}`,
    `- Recommendations reviewed: ${recommendationQuality.total_reviewed}`,
    `- Recommendations kept: ${recommendationQuality.accepted}`,
    `- Recommendations skipped: ${recommendationQuality.ignored}`,
    "",
    "## Profile Intelligence",
    formatProfileIntelligence(profileState),
    "",
    "## Vertical Intelligence",
    formatVerticalIntelligenceMarkdown(profileState?.vertical_intelligence ?? null),
    "",
    "## Shared Company Brain",
    formatCompanyBrainMarkdown(companyBrain),
    "",
    "## Agent Configuration",
    listOrEmpty(
      reps.rows.map((rep) => {
        const email = rep.autonomy?.channels?.email;
        return `- ${line(rep.name)} (${rep.role}, ${rep.status}) voice="${line(rep.persona?.voice)}" email_cap=${email?.daily_cap ?? "-"} approval=${email?.approval ?? "-"}`;
      }),
    ),
    "",
    "## ICPs",
    listOrEmpty(
      icps.rows.map(
        (icp) =>
          `- ${line(icp.name)} enabled=${icp.enabled} threshold=${Number(icp.match_threshold).toFixed(2)}: ${line(icp.description)}`,
      ),
    ),
    "",
    "## Outreach Rules",
    listOrEmpty(
      plays.rows.map(
        (play) => `- ${line(play.name)} (${play.status}): ${line(play.declaration)}`,
      ),
    ),
    "",
    "## Sources",
    listOrEmpty(
      sources.rows.slice(0, 8).map(
        (source) =>
          `- ${line(source.name)} kind=${source.kind} enabled=${source.enabled} signals=${source.signal_count} last_polled=${source.last_polled_at ?? "never"} latest_run=${source.latest_run_status ?? "-"}`,
      ),
    ),
    "",
    "## Recent Signals",
    listOrEmpty(
      signals.rows.map(
        (signal) =>
          `- ${line(signal.title)} kind=${signal.kind ?? "-"} status=${signal.status} match=${signal.match_score ?? "-"} freshness=${signal.freshness_at.toISOString()}`,
      ),
    ),
    "",
    "## Pending Review",
    listOrEmpty(
      pendingApprovals.rows.slice(0, 8).map(
        (approval) =>
          `- approval=${approval.id} run=${approval.run_id} kind=${approval.kind} reason=${line(approval.reason)}`,
      ),
    ),
    "",
    "## Recommendation Learning",
    formatRecommendationQuality(recommendationQuality),
    "",
    "## Recent Send Traces",
    listOrEmpty(
      sendTraces.rows.slice(0, 8).map(
        (trace) =>
          `- ${line(trace.subject)} to=${line(trace.person_name)} company=${line(trace.company_name)} status=${trace.status} judge=${trace.eval_score ?? "-"} passed=${trace.eval_passed ?? "-"} gate=${trace.approval_policy ?? "-"}`,
      ),
    ),
    "",
    "## Channel Readiness",
    formatChannelReadiness(channelAccounts.rows),
    "",
    "## Email Deliverability",
    formatEmailDeliverability(channelAccounts.rows),
    "",
    "## Recovery",
    listOrEmpty(
      recoveryQueue.rows.slice(0, 8).map(
        (run) =>
          `- ${run.workflow_name} run=${run.id} failed_step=${run.failed_step_name ?? "-"} error=${line(run.error)}`,
      ),
    ),
  ].join("\n");

  return {
    workspace_id: session.workspace_id,
    generated_at: generatedAt,
    markdown,
    counts: {
      reps: reps.rows.length,
      icps: icps.rows.length,
      plays: plays.rows.length,
      sources: sources.rows.length,
      pending_approvals: pendingApprovals.rows.length,
      recent_signals: signals.rows.length,
      recent_conversations: numericCount(conversationCount.rows[0]?.count),
      recent_outcomes: numericCount(outcomeCount.rows[0]?.count),
      reviewed_recommendations: recommendationQuality.total_reviewed,
      company_brain_cards: companyBrain.cards.length,
    },
  };
}

function listOrEmpty(items: string[]): string {
  return items.length > 0 ? items.join("\n") : "- none";
}

export function formatProfileIntelligence(profile: ContextProfile | null): string {
  if (!profile) return "- none";
  return [
    `- Company: ${line(profile.company_name)}`,
    `- Domain: ${profile.domain ?? "-"}`,
    `- Website: ${profile.website_url ?? "-"}`,
    `- Industry: ${line(profile.industry)}`,
    `- Company size: ${line(profile.company_size)}`,
    `- Description: ${line(profile.description)}`,
    `- Value proposition: ${line(profile.value_proposition)}`,
    `- Customer pain points: ${line(profile.customer_pain_points)}`,
    `- Key features: ${line(profile.key_features)}`,
    `- Social proof: ${line(profile.social_proof)}`,
    `- LinkedIn company page: ${profile.linkedin_company_url ?? "-"}`,
    `- Public-web summary: ${line(profile.exa_summary)}`,
    `- Market terms: ${profile.exa_market_terms.length > 0 ? profile.exa_market_terms.join(", ") : "-"}`,
    `- Positioning: ${profile.exa_positioning_notes.length > 0 ? profile.exa_positioning_notes.join(" | ") : "-"}`,
    `- Audience: ${profile.exa_audience_terms.length > 0 ? profile.exa_audience_terms.join(", ") : "-"}`,
    `- Competitors: ${profile.exa_competitor_mentions.length > 0 ? profile.exa_competitor_mentions.join(" | ") : "-"}`,
    `- Proof points: ${profile.exa_proof_points.length > 0 ? profile.exa_proof_points.join(" | ") : "-"}`,
    `- Source domains: ${profile.exa_source_domains.length > 0 ? profile.exa_source_domains.join(", ") : "-"}`,
    `- Evidence: ${profile.exa_evidence_source_ids.length} sources, ${profile.exa_result_count} Exa results, enriched=${profile.exa_enriched_at ?? "-"}`,
  ].join("\n");
}

export function formatRecommendationQuality(quality: ContextRecommendationQuality): string {
  if (quality.total_reviewed === 0) {
    return "- none";
  }
  return [
    formatRecommendationQualityLine("All recommendations", quality),
    formatRecommendationQualityLine("Signal opportunities", quality.content_opportunity),
    formatRecommendationQualityLine("Visibility gaps", quality.aeo_gap),
  ].join("\n");
}

function formatRecommendationQualityLine(
  label: string,
  quality: {
    total_reviewed: number;
    accepted: number;
    ignored: number;
    acceptance_rate: number | null;
    last_reviewed_at: string | null;
  },
): string {
  const rate = quality.acceptance_rate == null
    ? "-"
    : `${Math.round(quality.acceptance_rate * 100)}%`;
  return `- ${label}: reviewed=${quality.total_reviewed} kept=${quality.accepted} skipped=${quality.ignored} keep_rate=${rate} last=${quality.last_reviewed_at ?? "-"}`;
}

export function formatChannelReadiness(accounts: readonly ContextChannelAccount[]): string {
  return listOrEmpty(
    accounts.map((account) => {
      const cap = account.daily_cap == null ? "unlimited" : account.daily_cap;
      const provider =
        account.kind.startsWith("linkedin_") && account.provider_status
          ? ` provider=${account.provider_status}`
          : "";
      return `- ${line(account.display_name)} kind=${account.kind} status=${account.status} used=${account.daily_used}/${cap}${provider}`;
    }),
  );
}

export function formatEmailDeliverability(accounts: readonly ContextChannelAccount[]): string {
  return listOrEmpty(
    accounts
      .filter((account) => account.kind === "email_domain" || account.kind === "oauth_outlook")
      .map(
        (account) =>
          `- ${line(account.display_name)} status=${account.status} domain=${account.domain ?? "-"} warmup=${account.warmup_state ?? "-"} cap=${account.daily_used}/${account.current_daily_cap ?? account.daily_cap ?? "-"} bounce24h=${account.bounce_rate_24h ?? "-"}`,
      ),
  );
}

function line(value: unknown): string {
  if (typeof value !== "string") return "-";
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}

function mapContextProfile(row: ContextProfileRow | null): ContextProfile | null {
  if (!row) return null;
  return {
    company_id: row.company_id,
    company_name: row.company_name,
    domain: row.domain,
    website_url: row.website_url,
    industry: row.industry,
    company_size: row.company_size,
    description: row.description,
    value_proposition: row.value_proposition,
    customer_pain_points: row.customer_pain_points,
    key_features: row.key_features,
    social_proof: row.social_proof,
    linkedin_company_url: row.linkedin_company_url,
    exa_summary: row.exa_summary,
    exa_source_domains: stringArray(row.exa_source_domains),
    exa_market_terms: stringArray(row.exa_market_terms),
    exa_positioning_notes: stringArray(row.exa_positioning_notes),
    exa_competitor_mentions: stringArray(row.exa_competitor_mentions),
    exa_audience_terms: stringArray(row.exa_audience_terms),
    exa_proof_points: stringArray(row.exa_proof_points),
    exa_evidence_cards: evidenceCards(row.exa_evidence_cards),
    exa_evidence_source_ids: stringArray(row.exa_evidence_source_ids),
    exa_result_count: numericCount(row.exa_result_count),
    exa_enriched_at: row.exa_enriched_at,
    vertical_intelligence: parseVerticalIntelligencePack(row.vertical_intelligence),
  };
}

function emptyRecommendationQuality(): ContextRecommendationQuality {
  const empty = {
    total_reviewed: 0,
    accepted: 0,
    ignored: 0,
    acceptance_rate: null,
    last_reviewed_at: null,
  };
  return {
    ...empty,
    content_opportunity: { ...empty },
    aeo_gap: { ...empty },
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function evidenceCards(value: unknown): ContextProfile["exa_evidence_cards"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    return [{
      title: typeof record.title === "string" ? record.title : null,
      url: typeof record.url === "string" ? record.url : null,
      source_domain: typeof record.source_domain === "string" ? record.source_domain : null,
      snippet: typeof record.snippet === "string" ? record.snippet : null,
      published_at: typeof record.published_at === "string" ? record.published_at : null,
    }];
  });
}

function numericCount(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

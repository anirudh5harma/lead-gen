import type { Pool } from "pg";
import { getPool } from "../substrate/storage/index.ts";
import {
  getAppState,
  type ProductWorkspaceSession,
} from "./app.ts";

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
  };
}

export async function getWorkspaceAgentContext(
  session: ProductWorkspaceSession,
  pool: Pool = getPool(),
): Promise<WorkspaceAgentContext> {
  const state = await getAppState(pool, session);
  const [reps, icps, plays, signals] = await Promise.all([
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
  ]);

  const pendingApprovals = state.approvals.filter(
    (approval) => approval.decision === "pending",
  );
  const generatedAt = new Date().toISOString();
  const markdown = [
    "# Bombsell Workspace Context",
    "",
    `Generated: ${generatedAt}`,
    `Workspace: ${session.workspace_id}`,
    "",
    "## Product Vocabulary",
    "- Brief: today's autonomous work, outcomes, and review needs.",
    "- Outreach: conversations and replies.",
    "- Content: plays and reusable work patterns.",
    "- Campaigns: sources, tracked companies, and signals.",
    "- AEO: visibility, recovery, event delivery, and background work.",
    "- Profile: workspace intent, Rep voice, ICP, autonomy, and channels.",
    "",
    "## Operating Rules",
    "- Use the registered tools as primitives; compose outcomes from tools instead of assuming hidden features.",
    "- State changes should flow through typed product/graph tools and durable workflows.",
    "- Keep user-facing nouns mapped to Rep, Signal, Play, Conversation, and Outcome.",
    "- Approved sends still pass through judge, deliverability, and channel gates.",
    "",
    "## Current Counts",
    `- Reps: ${reps.rows.length}`,
    `- ICPs: ${icps.rows.length}`,
    `- Plays: ${plays.rows.length}`,
    `- Sources: ${state.sources.length}`,
    `- Pending approvals: ${pendingApprovals.length}`,
    `- Recent signals: ${signals.rows.length}`,
    `- Recent conversations: ${state.conversations.length}`,
    `- Recent outcomes: ${state.outcomes.length}`,
    `- LLM tokens used in 24h: ${state.llmUsage.used_tokens_24h}/${state.llmUsage.daily_token_cap}`,
    "",
    "## Reps",
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
    "## Plays",
    listOrEmpty(
      plays.rows.map(
        (play) => `- ${line(play.name)} (${play.status}): ${line(play.declaration)}`,
      ),
    ),
    "",
    "## Sources",
    listOrEmpty(
      state.sources.slice(0, 8).map(
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
      pendingApprovals.slice(0, 8).map(
        (approval) =>
          `- approval=${approval.id} run=${approval.run_id} kind=${approval.kind} reason=${line(approval.reason)}`,
      ),
    ),
    "",
    "## Recent Send Traces",
    listOrEmpty(
      state.sendTraces.slice(0, 8).map(
        (trace) =>
          `- ${line(trace.subject)} to=${line(trace.person_name)} company=${line(trace.company_name)} status=${trace.status} judge=${trace.eval_score ?? "-"} passed=${trace.eval_passed ?? "-"} gate=${trace.approval_policy ?? "-"}`,
      ),
    ),
    "",
    "## Deliverability",
    listOrEmpty(
      state.channelAccounts.map(
        (account) =>
          `- ${line(account.display_name)} status=${account.status} domain=${account.domain ?? "-"} warmup=${account.warmup_state ?? "-"} cap=${account.daily_used}/${account.current_daily_cap ?? account.daily_cap ?? "-"} bounce24h=${account.bounce_rate_24h ?? "-"}`,
      ),
    ),
    "",
    "## Recovery",
    listOrEmpty(
      state.recoveryQueue.slice(0, 8).map(
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
      sources: state.sources.length,
      pending_approvals: pendingApprovals.length,
      recent_signals: signals.rows.length,
      recent_conversations: state.conversations.length,
      recent_outcomes: state.outcomes.length,
    },
  };
}

function listOrEmpty(items: string[]): string {
  return items.length > 0 ? items.join("\n") : "- none";
}

function line(value: unknown): string {
  if (typeof value !== "string") return "-";
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}

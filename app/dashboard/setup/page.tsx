import Icon from "@/components/Icon";
import type { ReactNode } from "react";
import { EmptyState, MetricCard, SectionHeader } from "@/components/dashboard/Shell";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspace } from "@/lib/workspace";
import {
  configureActivationAction,
  createWorkspaceAction,
  submitLaunchSignalAction,
} from "../actions";

export const dynamic = "force-dynamic";

interface SetupRepRow {
  id: string;
  name: string;
  role: string;
  status: string;
  persona: { voice?: string; story?: string };
  autonomy: { channels?: { email?: { daily_cap?: number; approval?: string } } };
}

interface SetupIcpRow {
  id: string;
  name: string;
  description: string;
  match_threshold: string;
  must_haves: Array<{ field?: string; op?: string; value?: unknown }>;
}

interface SetupPlayRow {
  id: string;
  name: string;
  status: string;
  declaration: string;
  compiled: { trigger?: { filter?: { kind?: string } } };
}

interface SetupAccountRow {
  id: string;
  display_name: string;
  status: string;
  daily_cap: number | null;
}

interface SetupCompanyRow {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
}

interface SetupSourceRow {
  id: string;
  name: string;
  kind: string;
  config: { url?: string; kind?: string; poll_interval_ms?: number };
  enabled: boolean;
}

interface SetupCounts {
  signals: number;
  approvals: number;
  conversations: number;
  outcomes: number;
}

async function loadSetupState(workspaceId: string) {
  const pool = getPool();
  const [reps, icps, plays, accounts, companies, sources, counts] =
    await Promise.all([
      pool.query<SetupRepRow>(
        `select id, name, role::text as role, status::text as status, persona, autonomy
           from reps
          where workspace_id = $1
          order by created_at asc`,
        [workspaceId],
      ),
      pool.query<SetupIcpRow>(
        `select id, name, description, match_threshold::text as match_threshold, must_haves
           from workspace_icps
          where workspace_id = $1
          order by created_at asc`,
        [workspaceId],
      ),
      pool.query<SetupPlayRow>(
        `select id, name, status::text as status, declaration, compiled
           from plays
          where workspace_id = $1
          order by created_at asc`,
        [workspaceId],
      ),
      pool.query<SetupAccountRow>(
        `select id, display_name, status::text as status, daily_cap
           from channel_accounts
          where workspace_id = $1 and kind in ('email_domain','email_oauth')
          order by created_at asc`,
        [workspaceId],
      ),
      pool.query<SetupCompanyRow>(
        `select tc.id, tc.name, tc.domain::text as domain, tc.industry
           from tracked_companies tc
           join workspace_tracked_companies wtc on wtc.company_id = tc.id
          where wtc.workspace_id = $1
          order by wtc.added_at desc
          limit 8`,
        [workspaceId],
      ),
      pool.query<SetupSourceRow>(
        `select id, name, kind::text as kind, config, enabled
           from graph_sources
          where workspace_id = $1
          order by created_at desc
          limit 8`,
        [workspaceId],
      ),
      pool.query<{
        signals: string;
        approvals: string;
        conversations: string;
        outcomes: string;
      }>(
        `select
           (select count(*)::text from signals where workspace_id = $1) as signals,
           (select count(*)::text from workflow_approvals where workspace_id = $1 and decision = 'pending') as approvals,
           (select count(*)::text from conversations where workspace_id = $1) as conversations,
           (select count(*)::text from outcomes where workspace_id = $1) as outcomes`,
        [workspaceId],
      ),
    ]);

  return {
    reps: reps.rows,
    icps: icps.rows,
    plays: plays.rows,
    accounts: accounts.rows,
    companies: companies.rows,
    sources: sources.rows,
    counts: {
      signals: Number(counts.rows[0].signals),
      approvals: Number(counts.rows[0].approvals),
      conversations: Number(counts.rows[0].conversations),
      outcomes: Number(counts.rows[0].outcomes),
    } satisfies SetupCounts,
  };
}

export default async function SetupPage() {
  const workspace = await getActiveWorkspace();
  if (!workspace) return <NoWorkspaceSetup />;

  const state = await loadSetupState(workspace.id);
  const rep = state.reps[0];
  const icp = state.icps[0];
  const account = state.accounts[0];
  const play = state.plays[0];
  const signalKind = inferSignalKind(icp, play);
  const readySteps = [
    Boolean(workspace),
    state.reps.length > 0,
    state.icps.length > 0,
    state.accounts.length > 0,
    state.plays.length > 0,
  ].filter(Boolean).length;

  return (
    <>
      <SectionHeader
        eyebrow="setup"
        title="Launch the first GTM loop"
        subtitle="Configure the Rep, ICP, source, channel, and Play that make the first trusted send possible."
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5 mb-8">
        <MetricCard label="Ready" value={`${readySteps}/5`} hint="activation steps" />
        <MetricCard label="Signals" value={state.counts.signals} />
        <MetricCard label="Approvals" value={state.counts.approvals} />
        <MetricCard label="Conversations" value={state.counts.conversations} />
        <MetricCard label="Outcomes" value={state.counts.outcomes} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Panel title="Activation">
          <form action={configureActivationAction} className="grid gap-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Field name="rep_name" label="Rep" defaultValue={rep?.name ?? "Maya"} />
              <Field
                name="sender"
                label="Sender"
                defaultValue={account?.display_name ?? "maya@go.bombsell.example"}
                type="email"
              />
              <Field
                name="icp_name"
                label="ICP"
                defaultValue={icp?.name ?? "Hiring signal ICP"}
              />
              <Select
                name="signal_kind"
                label="Signal"
                defaultValue={signalKind}
                options={[
                  ["hiring", "Hiring"],
                  ["funding", "Funding"],
                  ["product_launch", "Product launch"],
                  ["press_mention", "Press mention"],
                ]}
              />
            </div>
            <TextArea
              name="rep_voice"
              label="Rep voice"
              defaultValue={
                rep?.persona.voice ??
                "Direct, warm, specific, and allergic to generic sales fluff."
              }
              rows={3}
            />
            <TextArea
              name="icp_description"
              label="ICP description"
              defaultValue={
                icp?.description ??
                "Companies showing fresh hiring intent around GTM, operations, or revenue roles."
              }
              rows={3}
            />
            <div className="grid gap-4 md:grid-cols-3">
              <Field
                name="daily_cap"
                label="Daily cap"
                defaultValue={String(rep?.autonomy.channels?.email?.daily_cap ?? account?.daily_cap ?? 25)}
                type="number"
              />
              <Field
                name="match_threshold"
                label="Match threshold"
                defaultValue={icp ? Number(icp.match_threshold).toFixed(2) : "0.60"}
                type="number"
                step="0.01"
              />
              <Select
                name="approval"
                label="Approval"
                defaultValue={rep?.autonomy.channels?.email?.approval ?? "approve_first"}
                options={[
                  ["approve_first", "Approve first"],
                  ["none", "Autopilot after judge"],
                ]}
              />
            </div>

            <div className="border-t border-[var(--color-line-1)] pt-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-3)] mb-3">
                Signal source
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  name="company_name"
                  label="Tracked company"
                  defaultValue={state.companies[0]?.name ?? "Acme Payroll"}
                />
                <Field
                  name="company_domain"
                  label="Company domain"
                  defaultValue={state.companies[0]?.domain ?? "acmepayroll.example"}
                />
                <Field name="greenhouse_id" label="Greenhouse board" defaultValue="" />
                <Field name="lever_id" label="Lever board" defaultValue="" />
                <Field
                  name="source_name"
                  label="RSS source"
                  defaultValue={state.sources[0]?.name ?? "Hiring signal feed"}
                />
                <Field
                  name="source_url"
                  label="Feed URL"
                  defaultValue={state.sources[0]?.config.url ?? ""}
                  type="url"
                />
              </div>
            </div>

            <button className="inline-flex w-fit items-center gap-2 rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[var(--color-accent-on)] transition-colors hover:bg-[var(--color-accent-hi)]">
              <Icon name="rocket_launch" size={18} />
              Save setup
            </button>
          </form>
        </Panel>

        <div className="grid gap-6">
          <Panel title="Current loop">
            <ol className="grid gap-3">
              <Step done label="Workspace" detail={workspace.name} />
              <Step done={state.reps.length > 0} label="Rep" detail={rep?.name ?? "Not configured"} />
              <Step done={state.icps.length > 0} label="ICP" detail={icp?.name ?? "Not configured"} />
              <Step done={state.accounts.length > 0} label="Email" detail={account?.display_name ?? "Not configured"} />
              <Step done={state.plays.length > 0} label="Play" detail={play?.name ?? "Not configured"} />
            </ol>
          </Panel>

          <Panel title="Run first signal">
            {!rep || !icp || !play ? (
              <EmptyState
                title="Setup required"
                hint="Save the activation form first, then run a real Signal through the Play."
              />
            ) : (
              <form action={submitLaunchSignalAction} className="grid gap-4">
                <input type="hidden" name="signal_kind" value={signalKind} />
                <input type="hidden" name="icp_segment" value={icp.id} />
                <div className="grid gap-4 md:grid-cols-2">
                  <Field name="signal_company" label="Company" defaultValue="Acme Payroll" />
                  <Field name="signal_domain" label="Domain" defaultValue="acmepayroll.example" />
                  <Field name="person_name" label="Person" defaultValue="Nisha Rao" />
                  <Field name="person_email" label="Email" defaultValue="nisha@acmepayroll.example" type="email" />
                </div>
                <Field
                  name="signal_title"
                  label="Signal title"
                  defaultValue="Acme Payroll is hiring a revenue operations lead"
                />
                <TextArea
                  name="signal_content"
                  label="Signal context"
                  rows={4}
                  defaultValue="Acme Payroll opened a revenue operations role, suggesting the GTM motion is being rebuilt."
                />
                <Select
                  name="approval"
                  label="Run mode"
                  defaultValue="always"
                  options={[
                    ["always", "Create approval"],
                    ["none", "Send after judge"],
                  ]}
                />
                <button className="inline-flex w-fit items-center gap-2 rounded-md bg-[var(--color-text-1)] px-4 py-2 text-sm font-semibold text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-accent)]">
                  <Icon name="bolt" size={18} />
                  Run signal
                </button>
              </form>
            )}
          </Panel>
        </div>
      </section>
    </>
  );
}

function NoWorkspaceSetup() {
  return (
    <>
      <SectionHeader
        eyebrow="setup"
        title="Create the workspace"
        subtitle="Start with the tenant boundary. The Rep, Signal, Play, Conversation, and Outcome loop comes next."
      />
      <Panel title="Workspace">
        <form action={createWorkspaceAction} className="grid gap-4 md:max-w-xl">
          <Field name="workspace_name" label="Workspace name" defaultValue="Bombsell Workspace" />
          <Field name="workspace_slug" label="Workspace slug" defaultValue="bombsell-workspace" />
          <button className="inline-flex w-fit items-center gap-2 rounded-md bg-[var(--color-text-1)] px-4 py-2 text-sm font-semibold text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-accent)]">
            <Icon name="add_business" size={18} />
            Create workspace
          </button>
        </form>
      </Panel>
    </>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-5">
      <h2 className="mb-4 text-sm font-semibold text-[var(--color-text-1)]">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  name,
  label,
  defaultValue,
  type = "text",
  step,
}: {
  name: string;
  label: string;
  defaultValue: string;
  type?: string;
  step?: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-3)]">
        {label}
      </span>
      <input
        name={name}
        type={type}
        step={step}
        defaultValue={defaultValue}
        className="min-h-10 rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 text-sm text-[var(--color-text-1)]"
      />
    </label>
  );
}

function TextArea({
  name,
  label,
  defaultValue,
  rows,
}: {
  name: string;
  label: string;
  defaultValue: string;
  rows: number;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-3)]">
        {label}
      </span>
      <textarea
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        className="rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2 text-sm leading-6 text-[var(--color-text-1)]"
      />
    </label>
  );
}

function Select({
  name,
  label,
  defaultValue,
  options,
}: {
  name: string;
  label: string;
  defaultValue: string;
  options: Array<[string, string]>;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-3)]">
        {label}
      </span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="min-h-10 rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 text-sm text-[var(--color-text-1)]"
      >
        {options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Step({
  done,
  label,
  detail,
}: {
  done: boolean;
  label: string;
  detail: string;
}) {
  return (
    <li className="grid grid-cols-[24px_1fr] gap-3">
      <span
        className={
          "mt-0.5 flex size-6 items-center justify-center rounded-full text-[13px] " +
          (done
            ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
            : "bg-[var(--color-ink-3)] text-[var(--color-text-3)]")
        }
      >
        <Icon name={done ? "check" : "more_horiz"} size={16} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[var(--color-text-1)]">{label}</span>
        <span className="block truncate text-xs text-[var(--color-text-3)]">{detail}</span>
      </span>
    </li>
  );
}

function inferSignalKind(icp?: SetupIcpRow, play?: SetupPlayRow): string {
  const fromPlay = play?.compiled.trigger?.filter?.kind;
  if (fromPlay) return fromPlay;
  const rule = icp?.must_haves.find(
    (item) => item.field === "kind" && item.op === "eq" && typeof item.value === "string",
  );
  return typeof rule?.value === "string" ? rule.value : "hiring";
}

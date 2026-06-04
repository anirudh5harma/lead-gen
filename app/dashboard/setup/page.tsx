import Icon from "@/components/Icon";
import type { ReactNode } from "react";
import { ProfileIntelligence } from "@/components/dashboard/ProfileIntelligence";
import { EmptyState } from "@/components/dashboard/Shell";
import { getAppState } from "@/core/product/app.ts";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSession } from "@/lib/workspace";
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
  kind?: string;
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

async function loadSetupState(workspaceId: string) {
  const pool = getPool();
  const [reps, icps, plays, accounts, linkedinAccounts, companies, sources] =
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
    pool.query<SetupAccountRow>(
      `select id, kind::text as kind, display_name, status::text as status, daily_cap
         from channel_accounts
        where workspace_id = $1 and kind in ('linkedin_session','linkedin_oauth')
        order by created_at asc`,
      [workspaceId],
    ),
    pool.query<SetupCompanyRow>(
      `select tc.id, tc.name, tc.domain::text as domain, tc.industry
         from tracked_companies tc
         join workspace_tracked_companies wtc on wtc.company_id = tc.id
        where wtc.workspace_id = $1
        order by wtc.added_at desc
        limit 4`,
      [workspaceId],
    ),
    pool.query<SetupSourceRow>(
      `select id, name, kind::text as kind, config, enabled
         from graph_sources
        where workspace_id = $1
        order by created_at desc
        limit 4`,
      [workspaceId],
    ),
  ]);

  return {
    reps: reps.rows,
    icps: icps.rows,
    plays: plays.rows,
    accounts: accounts.rows,
    linkedinAccounts: linkedinAccounts.rows,
    companies: companies.rows,
    sources: sources.rows,
  };
}

export default async function SetupPage() {
  const active = await getActiveWorkspaceSession();
  if (!active) return <NoWorkspaceSetup />;

  const pool = getPool();
  const [state, appState] = await Promise.all([
    loadSetupState(active.workspace.id),
    getAppState(pool, {
      workspace_id: active.workspace.id,
      user_id: active.user_id,
    }),
  ]);
  const rep = state.reps[0];
  const icp = state.icps[0];
  const account = state.accounts[0];
  const linkedinAccount = state.linkedinAccounts[0];
  const play = state.plays[0];
  const signalKind = inferSignalKind(icp, play);
  const linkedinProviderConfigured = Boolean(
    process.env.LINKEDIN_PROVIDER_AUTH_URL?.trim() ||
      process.env.LINKEDIN_PROVIDER_URL?.trim(),
  );
  const ready = [
    state.reps.length > 0,
    state.icps.length > 0,
    state.accounts.length > 0,
    state.plays.length > 0,
    state.sources.length > 0,
  ];

  return (
    <>
      <section className="section-canvas overflow-hidden">
        <div className="section-thread section-thread-a" />
        <div className="p-5 pb-0 sm:p-8 sm:pb-0">
          <p className="brief-kicker">Profile</p>
          <h1 className="mt-4 max-w-3xl text-[38px] font-semibold leading-[1.04] tracking-[0] text-[var(--color-text-1)] sm:text-[58px]">
            Describe the work in plain language.
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--color-text-2)]">
            A workspace starts as intent, voice, and review rules. Keep the machinery hidden unless you need to tune it.
          </p>
        </div>
        <div className="grid lg:grid-cols-[1fr_320px]">
          <form action={configureActivationAction} className="grid gap-6 p-5 sm:p-8">
            <TextArea
              name="icp_description"
              label="Intent"
              rows={5}
              defaultValue={
                icp?.description ??
                "Find companies showing fresh hiring intent around GTM, operations, or revenue roles. Draft founder-led outreach only when there is a specific reason to talk now."
              }
            />

            <div className="grid gap-4 md:grid-cols-2">
              <Field name="rep_name" label="Sender name" defaultValue={rep?.name ?? "Sampark"} />
              <Field
                name="sender"
                label="Sending email"
                defaultValue={account?.display_name ?? "sampark@go.bombsell.example"}
                type="email"
              />
              <Field
                name="icp_name"
                label="Profile name"
                defaultValue={icp?.name ?? "Hiring lead profile"}
              />
              <Select
                name="signal_kind"
                label="Main signal"
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
              label="Voice"
              rows={3}
              defaultValue={
                rep?.persona.voice ??
                "Direct, warm, specific, and allergic to generic sales fluff."
              }
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
                label="Fit score"
                defaultValue={icp ? Number(icp.match_threshold).toFixed(2) : "0.60"}
                type="number"
                step="0.01"
              />
              <Select
                name="approval"
                label="Review rule"
                defaultValue={rep?.autonomy.channels?.email?.approval ?? "approve_first"}
                options={[
                  ["approve_first", "Approve first"],
                  ["none", "Send when quality passes"],
                ]}
              />
            </div>

            <div className="rounded-[10px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.52)] p-4">
              <p className="mb-3 text-sm font-semibold text-[var(--color-text-1)]">
                First source
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  name="company_name"
                  label="Company"
                  defaultValue={state.companies[0]?.name ?? "Acme Payroll"}
                />
                <Field
                  name="company_domain"
                  label="Website"
                  defaultValue={state.companies[0]?.domain ?? "acmepayroll.example"}
                />
                <Field name="greenhouse_id" label="Greenhouse board" defaultValue="" />
                <Field name="lever_id" label="Lever board" defaultValue="" />
                <Field
                  name="source_name"
                  label="Source name"
                  defaultValue={state.sources[0]?.name ?? "Hiring feed"}
                />
                <Field
                  name="source_url"
                  label="Feed URL"
                  defaultValue={state.sources[0]?.config.url ?? ""}
                  type="url"
                />
              </div>
            </div>

            <button className="inline-flex min-h-11 w-fit items-center gap-2 rounded-[8px] bg-[var(--color-text-1)] px-5 text-sm font-semibold text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-accent)]">
              <Icon name="check" size={18} />
              Save profile
            </button>
          </form>

          <aside className="border-t border-[var(--color-line-1)] bg-[rgba(255,255,255,0.42)] p-5 lg:border-l lg:border-t-0">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">Workspace map</p>
            <div className="mt-4 grid gap-2">
              <MapStep label="Sender" ready={ready[0]} detail={rep?.name ?? "Needed"} />
              <MapStep label="Profile" ready={ready[1]} detail={icp?.name ?? "Needed"} />
              <MapStep label="Channel" ready={ready[2]} detail={account?.display_name ?? "Needed"} />
              <MapStep label="LinkedIn" ready={Boolean(linkedinAccount)} detail={linkedinAccount?.display_name ?? "Optional"} />
              <MapStep label="Play" ready={ready[3]} detail={play?.name ?? "Needed"} />
              <MapStep label="Signals" ready={ready[4]} detail={`${state.sources.length} connected`} />
            </div>
          </aside>
        </div>
      </section>

      <ProfileIntelligence profile={appState.profile} />

      <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_0.8fr]">
        <Panel title="Try one lead">
          {!rep || !icp || !play ? (
            <EmptyState title="Profile not ready" hint="Save the profile first, then try one lead." />
          ) : (
            <form action={submitLaunchSignalAction} className="grid gap-4">
              <input type="hidden" name="signal_kind" value={signalKind} />
              <input type="hidden" name="icp_segment" value={icp.id} />
              <div className="grid gap-4 md:grid-cols-2">
                <Field name="signal_company" label="Company" defaultValue="Acme Payroll" />
                <Field name="signal_domain" label="Website" defaultValue="acmepayroll.example" />
                <Field name="person_name" label="Person" defaultValue="Nisha Rao" />
                <Field name="person_email" label="Email" defaultValue="nisha@acmepayroll.example" type="email" />
              </div>
              <Field
                name="signal_title"
                label="Signal"
                defaultValue="Acme Payroll is hiring a revenue operations lead"
              />
              <TextArea
                name="signal_content"
                label="Why now"
                rows={3}
                defaultValue="Acme Payroll opened a revenue operations role, suggesting the GTM motion is being rebuilt."
              />
              <Select
                name="approval"
                label="Review"
                defaultValue="always"
                options={[
                  ["always", "Create approval"],
                  ["none", "Send when ready"],
                ]}
              />
              <button className="inline-flex min-h-10 w-fit items-center gap-2 rounded-[8px] bg-[var(--color-text-1)] px-4 text-sm font-semibold text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-accent)]">
                <Icon name="bolt" size={18} />
                Try lead
              </button>
            </form>
          )}
        </Panel>

        <Panel title="Connected notes">
          <Note title="Company" value={state.companies[0]?.name ?? "Add a company"} />
          <IntegrationNote
            connected={Boolean(linkedinAccount)}
            configured={linkedinProviderConfigured}
            title="LinkedIn"
            value={linkedinAccount?.display_name ?? "Connect account"}
            href="/api/auth/linkedin"
          />
          <Note title="Source" value={state.sources[0]?.name ?? "Add a source"} />
          <Note title="Play" value={play?.declaration ?? "The first play appears here."} />
        </Panel>
      </section>
    </>
  );
}

function NoWorkspaceSetup() {
  return (
    <>
      <section className="section-canvas p-5 sm:p-8">
        <p className="brief-kicker">Profile</p>
        <h1 className="mt-4 max-w-3xl text-[38px] font-semibold leading-[1.04] tracking-[0] text-[var(--color-text-1)] sm:text-[58px]">
          Create a workspace.
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--color-text-2)]">
          Start with a named workspace. The canvas appears after this.
        </p>
      </section>
      <Panel title="Workspace">
        <form action={createWorkspaceAction} className="grid gap-4 md:max-w-xl">
          <Field name="workspace_name" label="Workspace name" defaultValue="Bombsell Workspace" />
          <Field name="workspace_slug" label="Workspace slug" defaultValue="bombsell-workspace" />
          <button className="inline-flex min-h-10 w-fit items-center gap-2 rounded-[8px] bg-[var(--color-text-1)] px-4 text-sm font-semibold text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-accent)]">
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
    <section className="section-canvas p-5">
      <h2 className="mb-4 text-lg font-semibold text-[var(--color-text-1)]">{title}</h2>
      {children}
    </section>
  );
}

function Note({ title, value }: { title: string; value: string }) {
  return (
    <div className="mb-3 rounded-[10px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.62)] p-3 last:mb-0">
      <p className="text-xs text-[var(--color-text-3)]">{title}</p>
      <p className="mt-1 text-sm leading-6 text-[var(--color-text-1)]">{value}</p>
    </div>
  );
}

function IntegrationNote({
  title,
  value,
  href,
  connected,
  configured,
}: {
  title: string;
  value: string;
  href: string;
  connected: boolean;
  configured: boolean;
}) {
  return (
    <div className="mb-3 flex items-center gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.62)] p-3 last:mb-0">
      <span className={connected ? "dot dot-running" : "dot dot-idle"} />
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-[var(--color-text-3)]">{title}</span>
        <span className="block truncate text-sm leading-6 text-[var(--color-text-1)]">{value}</span>
      </span>
      {connected ? (
        <span className="text-xs font-semibold text-[var(--color-text-3)]">Connected</span>
      ) : configured ? (
        <a
          href={href}
          className="inline-flex min-h-9 items-center gap-2 rounded-[8px] bg-[var(--color-text-1)] px-3 text-xs font-semibold text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-accent)]"
        >
          <Icon name="link" size={16} />
          Connect
        </a>
      ) : (
        <span className="text-xs font-semibold text-[var(--color-text-3)]">Not ready</span>
      )}
    </div>
  );
}

function MapStep({
  label,
  ready,
  detail,
}: {
  label: string;
  ready: boolean;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-[8px] bg-[rgba(255,255,255,0.62)] px-3 py-2">
      <span className={ready ? "dot dot-running" : "dot dot-idle"} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-[var(--color-text-1)]">{label}</span>
        <span className="block truncate text-xs text-[var(--color-text-3)]">{detail}</span>
      </span>
    </div>
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
      <span className="text-xs font-medium text-[var(--color-text-3)]">{label}</span>
      <input
        name={name}
        type={type}
        step={step}
        defaultValue={defaultValue}
        className="min-h-10 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 text-sm text-[var(--color-text-1)]"
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
      <span className="text-xs font-medium text-[var(--color-text-3)]">{label}</span>
      <textarea
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2 text-sm leading-6 text-[var(--color-text-1)]"
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
      <span className="text-xs font-medium text-[var(--color-text-3)]">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="min-h-10 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 text-sm text-[var(--color-text-1)]"
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

function inferSignalKind(icp?: SetupIcpRow, play?: SetupPlayRow): string {
  const fromPlay = play?.compiled.trigger?.filter?.kind;
  if (fromPlay) return fromPlay;
  const rule = icp?.must_haves.find(
    (item) => item.field === "kind" && item.op === "eq" && typeof item.value === "string",
  );
  return typeof rule?.value === "string" ? rule.value : "hiring";
}

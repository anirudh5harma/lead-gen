import Link from "next/link";
import { EmptyState } from "@/components/dashboard/Shell";
import {
  HeroStat,
  SurfaceHero,
  SurfaceSection,
} from "@/components/dashboard/SurfaceHero";
import Icon from "@/components/Icon";
import {
  loadWorkspaceLaunchReadiness,
  type WorkspaceLaunchReadiness,
} from "@/core/product/launch-readiness.ts";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSession } from "@/lib/workspace";

export const dynamic = "force-dynamic";

interface RepRow {
  id: string;
  name: string;
  role: string;
  status: string;
  persona: {
    voice?: string;
    story?: string;
  };
  autonomy: {
    channels?: Record<string, RepChannelPolicy>;
  } | null;
  open_conversations: string;
  sent_7d: string;
  outcomes_7d: string;
}

interface RepChannelPolicy {
  daily_cap?: number;
  approval?: string;
}

interface ChannelRow {
  id: string;
  display_name: string;
  kind: string;
  status: string;
  daily_cap: number | null;
  last_error: string | null;
}

interface ChannelConnection {
  connected: boolean;
  label: string;
  status: string;
  dailyCap: number | null;
  href: string;
}

interface ChannelCoverage {
  email: ChannelConnection;
  linkedIn: ChannelConnection;
}

interface AgentActivity {
  active_workflows: number;
  events_last_hour: number;
  outbound_last_hour: number;
  reviews_pending: number;
  event_types: Array<{ event_type: string; count: number }>;
}

interface RepsState {
  reps: RepRow[];
  channels: ChannelRow[];
  readiness: WorkspaceLaunchReadiness;
  activity: AgentActivity;
}

async function loadRepsState(workspaceId: string): Promise<RepsState> {
  const pool = getPool();
  const [reps, channels, readiness, activity] = await Promise.all([
    pool.query<RepRow>(
      `select r.id,
              r.name,
              r.role::text as role,
              r.status::text as status,
              r.persona,
              r.autonomy,
              (select count(*)::text
                 from conversations c
                where c.workspace_id = $1
                  and c.rep_id = r.id
                  and c.status in ('open','awaiting_them','awaiting_us')) as open_conversations,
              (select count(*)::text
                 from messages m
                 join conversations c on c.id = m.conversation_id
                where m.workspace_id = $1
                  and c.rep_id = r.id
                  and m.direction = 'outbound'
                  and m.created_at >= now() - interval '7 days') as sent_7d,
              (select count(*)::text
                 from outcomes o
                where o.workspace_id = $1
                  and o.attributed_rep_id = r.id
                  and o.kind in ('positive_reply','meeting_booked','opportunity_created','deal_won')
                  and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '7 days') as outcomes_7d
         from reps r
        where r.workspace_id = $1
          and r.status <> 'retired'
        order by r.created_at asc`,
      [workspaceId],
    ),
    pool.query<ChannelRow>(
      `with ranked_accounts as (
         select id,
                display_name,
                kind::text as kind,
                status::text as status,
                daily_cap,
                last_error,
                updated_at,
                created_at,
                row_number() over (
                  partition by case
                    when kind = 'oauth_outlook' then 'outlook:' || coalesce(
                      nullif(lower(properties ->> 'mailbox_email'), ''),
                      nullif(lower(display_name), ''),
                      id::text
                    )
                    when kind in ('linkedin_session','linkedin_oauth') then 'linkedin:' || coalesce(
                      nullif(lower(display_name), ''),
                      id::text
                    )
                    else id::text
                  end
                  order by case when status = 'connected' then 0 else 1 end,
                           updated_at desc,
                           created_at desc
                ) as account_rank
           from channel_accounts
          where workspace_id = $1
            and kind in ('oauth_outlook','linkedin_session','linkedin_oauth')
       )
       select id, display_name, kind, status, daily_cap, last_error
         from ranked_accounts
        where account_rank = 1
        order by case
                   when kind = 'oauth_outlook' then 0
                   else 1
                 end,
                 display_name asc`,
      [workspaceId],
    ),
    loadWorkspaceLaunchReadiness(pool, workspaceId, { required_channel: "any" }),
    loadAgentActivity(workspaceId),
  ]);
  return {
    reps: reps.rows,
    channels: channels.rows,
    readiness,
    activity,
  };
}

async function loadAgentActivity(workspaceId: string): Promise<AgentActivity> {
  const pool = getPool();
  const [summary, eventTypes] = await Promise.all([
    pool.query<{
      active_workflows: string;
      events_last_hour: string;
      outbound_last_hour: string;
      reviews_pending: string;
    }>(
      `select
         (select count(*)::text from workflow_runs wr
            where wr.workspace_id = $1
              and wr.status in ('pending','running','awaiting_approval','awaiting_event')) as active_workflows,
         (select count(*)::text from events e
            where e.workspace_id = $1
              and e.occurred_at >= now() - interval '1 hour') as events_last_hour,
         (select count(*)::text from messages m
            where m.workspace_id = $1
              and m.direction = 'outbound'
              and m.created_at >= now() - interval '1 hour') as outbound_last_hour,
         (select count(*)::text from workflow_approvals a
            where a.workspace_id = $1
              and a.decision = 'pending') as reviews_pending`,
      [workspaceId],
    ),
    pool.query<{ event_type: string; count: string }>(
      `select e.event_type, count(*)::text as count
         from events e
        where e.workspace_id = $1
          and e.occurred_at >= now() - interval '1 hour'
        group by e.event_type
        order by count(*) desc, e.event_type asc
        limit 5`,
      [workspaceId],
    ),
  ]);
  return {
    active_workflows: Number(summary.rows[0]?.active_workflows ?? 0),
    events_last_hour: Number(summary.rows[0]?.events_last_hour ?? 0),
    outbound_last_hour: Number(summary.rows[0]?.outbound_last_hour ?? 0),
    reviews_pending: Number(summary.rows[0]?.reviews_pending ?? 0),
    event_types: eventTypes.rows.map((row) => ({
      event_type: row.event_type,
      count: Number(row.count),
    })),
  };
}

export default async function RepsPage() {
  const active = await getActiveWorkspaceSession();
  if (!active) return <NoWorkspaceReps />;

  const state = await loadRepsState(active.workspace.id);
  const activeAgents = state.reps.filter((rep) => rep.status === "active").length;
  const connectedChannels = state.channels.filter(
    (channel) => channel.status === "connected",
  ).length;
  const coverage = workspaceChannelCoverage(state.channels);

  return (
    <div className="space-y-10">
      <SurfaceHero
        kicker="Agent"
        title={
          <>
            Run email and LinkedIn <em>outreach</em>.
          </>
        }
        description="One place for the agent, outreach queue, replies, learning, and channel readiness. Quality signals turn into verified contacts, judged drafts, and email or LinkedIn next moves."
        meta={
          <div className="flex flex-wrap gap-2">
            <HeroStat label="Active agents" value={activeAgents} />
            <HeroStat label="Channels" value={connectedChannels} />
            <HeroStat
              label="Launch"
              value={state.readiness.launch_ready ? "Ready" : "Blocked"}
            />
          </div>
        }
      />

      <AgentActivityPanel activity={state.activity} />

      <SurfaceSection
        title="Agent"
        action={
          <Link href="/dashboard/settings#motion" className="btn-solid-sm">
            <Icon name="edit_note" size={14} />
            Tune agent
          </Link>
        }
      >
        {state.reps.length === 0 ? (
          <EmptyState
            title="No agent configured yet."
            hint="Start by defining the workspace profile, audience, voice, and approval mode."
            cta={{
              href: "/dashboard/settings#motion",
              label: "Configure agent",
              icon: "badge",
            }}
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {state.reps.map((rep) => (
              <RepCard key={rep.id} rep={rep} coverage={coverage} />
            ))}
          </div>
        )}
      </SurfaceSection>

      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-12">
        <SurfaceSection title="Outreach accounts">
          {state.channels.length === 0 ? (
            <EmptyState
              title="No outbound accounts connected."
              hint="Connect Outlook or LinkedIn before the agent can move a conversation."
              cta={{
                href: "/dashboard/settings#email",
                label: "Connect accounts",
                icon: "account_tree",
              }}
            />
          ) : (
            <div className="grid gap-3">
              {state.channels.map((channel) => (
                <ChannelCard key={channel.id} channel={channel} />
              ))}
            </div>
          )}
        </SurfaceSection>

        <SurfaceSection title="Launch path">
          <aside className="section-note">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">
              Next setup move
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-3)]">
              {launchReadinessCopy(state.readiness)}
            </p>
            <div className="mt-4 grid gap-2">
              <Link href="/dashboard/settings#motion" className="priority-action">
                <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
                  <Icon name="person" size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--color-text-1)]">
                    Profile and accounts
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--color-text-3)]">
                    Company, ICP, email, LinkedIn, and review mode.
                  </span>
                </span>
              </Link>
              <Link href="/dashboard/signals" className="priority-action">
                <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
                  <Icon name="travel_explore" size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--color-text-1)]">
                    Quality signals
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--color-text-3)]">
                    Timing evidence with verified contacts and drafts.
                  </span>
                </span>
              </Link>
              <Link href="/dashboard/settings#email" className="priority-action">
                <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
                  <Icon name="settings" size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--color-text-1)]">
                    Connected accounts
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--color-text-3)]">
                    Outlook, LinkedIn, and daily ceilings.
                  </span>
                </span>
              </Link>
              <Link href="/dashboard/conversations" className="priority-action">
                <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
                  <Icon name="science" size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--color-text-1)]">
                    Replies and learning
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--color-text-3)]">
                    Email, LinkedIn, replies, meetings, and feedback.
                  </span>
                </span>
              </Link>
            </div>
          </aside>
        </SurfaceSection>
      </section>
    </div>
  );
}

function AgentActivityPanel({ activity }: { activity: AgentActivity }) {
  const active =
    activity.active_workflows > 0 ||
    activity.events_last_hour > 0 ||
    activity.outbound_last_hour > 0;
  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="rounded-[10px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-1)]">
              {active ? "Working now" : "Idle right now"}
            </p>
            <p className="mt-1 text-sm text-[var(--color-text-3)]">
              Last hour: {activity.events_last_hour} system events,{" "}
              {activity.outbound_last_hour} outreach drafts or sends,{" "}
              {activity.reviews_pending} waiting for review.
            </p>
          </div>
          <span className="rounded-[8px] bg-[var(--color-accent-bg)] px-3 py-1 text-xs font-medium text-[var(--color-accent)]">
            {activity.active_workflows} active
          </span>
        </div>
        <div className="mt-6 grid h-24 grid-cols-12 items-end gap-1 overflow-hidden rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] p-3">
          {Array.from({ length: 12 }, (_, index) => {
            const height = 18 + ((activity.events_last_hour + index * 7) % 58);
            const delay = `${index * 80}ms`;
            return (
              <span
                key={index}
                className="animate-pulse rounded-t-[4px] bg-[var(--color-accent)]/70"
                style={{ height: `${height}%`, animationDelay: delay }}
              />
            );
          })}
        </div>
      </div>

      <aside className="section-note h-fit">
        <p className="text-sm font-semibold text-[var(--color-text-1)]">
          System activity
        </p>
        <div className="mt-4 grid gap-2">
          {activity.event_types.length === 0 ? (
            <p className="text-sm leading-6 text-[var(--color-text-3)]">
              No event activity in the last hour.
            </p>
          ) : (
            activity.event_types.map((event) => (
              <div
                key={event.event_type}
                className="flex items-center justify-between gap-3 rounded-[8px] bg-[var(--color-ink-0)] px-3 py-2"
              >
                <span className="truncate text-xs text-[var(--color-text-2)]">
                  {event.event_type.replace(/\./g, " ")}
                </span>
                <span className="font-mono text-xs text-[var(--color-text-3)]">
                  {event.count}
                </span>
              </div>
            ))
          )}
        </div>
      </aside>
    </section>
  );
}

function RepCard({
  rep,
  coverage,
}: {
  rep: RepRow;
  coverage: ChannelCoverage;
}) {
  const emailPolicy = rep.autonomy?.channels?.email;
  const linkedInPolicy = firstChannelPolicy(rep, ["linkedin_dm", "linkedin"]);
  return (
    <article className="group grid gap-5 rounded-[10px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] p-5 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)]/50">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
          <Icon name={repIcon(rep)} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/dashboard/reps/${rep.id}`}
              className="text-[18px] font-semibold text-[var(--color-text-1)] transition-colors hover:text-[var(--color-accent)]"
            >
              {agentDisplayName(rep.name)}
            </Link>
            <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2 py-1 text-[11px] text-[var(--color-text-3)]">
              {rep.role.replace(/_/g, " ")}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-2)]">
            {rep.persona.story ??
              "Configure this agent with a clear voice and launch guardrails."}
          </p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <MiniStat label="Open" value={Number(rep.open_conversations)} />
        <MiniStat label="Sent 7d" value={Number(rep.sent_7d)} />
        <MiniStat label="Outcomes 7d" value={Number(rep.outcomes_7d)} />
      </div>
      <div className="grid gap-2 border-t border-[var(--color-line-1)] pt-3 sm:grid-cols-2">
        <RepChannelPill
          title="Email"
          icon="mail"
          connection={coverage.email}
          policy={emailPolicy}
        />
        <RepChannelPill
          title="LinkedIn"
          icon="forum"
          connection={coverage.linkedIn}
          policy={linkedInPolicy}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--color-text-3)]">
        <span>
          {statusLabel(rep.status)} / Profile, accounts, and limits stay in
          Profile
        </span>
        <Link href={`/dashboard/reps/${rep.id}`} className="btn-quiet-sm">
          <Icon name="arrow_forward" size={14} />
          Open agent
        </Link>
      </div>
    </article>
  );
}

function RepChannelPill({
  title,
  icon,
  connection,
  policy,
}: {
  title: string;
  icon: string;
  connection: ChannelConnection;
  policy?: RepChannelPolicy;
}) {
  const cap = policy?.daily_cap ?? connection.dailyCap ?? 0;
  const approval = policy?.approval ?? "not set";
  return (
    <Link
      href={connection.href}
      prefetch={false}
      className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] p-3 transition-colors hover:border-[var(--color-line-3)]"
    >
      <span className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[var(--color-text-1)]">
          <Icon name={icon} size={14} />
          {title}
        </span>
        <span
          className={
            "rounded-[8px] px-2 py-1 text-[11px] font-medium " +
            (connection.connected
              ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
              : "bg-[var(--color-ink-0)] text-[var(--color-text-3)]")
          }
        >
          {connection.connected ? "Ready" : "Connect"}
        </span>
      </span>
      <span className="mt-2 block truncate text-xs text-[var(--color-text-3)]">
        {connection.label}
      </span>
      <span className="mt-1 block text-[11px] leading-5 text-[var(--color-text-3)]">
        {cap > 0 ? `${cap}/day` : "No cap"} - {approvalLabel(approval)}
      </span>
    </Link>
  );
}

function ChannelCard({ channel }: { channel: ChannelRow }) {
  return (
    <article className="grid gap-4 rounded-[10px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] p-4 md:grid-cols-[1fr_auto] md:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
          <Icon name={channelIcon(channel.kind)} size={17} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--color-text-1)]">
            {channel.display_name}
          </p>
          <p className="mt-1 text-sm text-[var(--color-text-3)]">
            {channelKindLabel(channel.kind)} - {statusLabel(channel.status)} -{" "}
            {channel.daily_cap ?? "unlimited"} daily ceiling
          </p>
          {channel.last_error ? (
            <p className="mt-2 text-sm text-[#ffb4a8]">{channel.last_error}</p>
          ) : null}
        </div>
      </div>
      <Link href="/dashboard/integrations" className="btn-solid-sm w-fit">
        <Icon name="settings" size={14} />
        Manage
      </Link>
    </article>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-2">
      <strong className="block text-lg font-semibold tabular-nums text-[var(--color-text-1)]">
        {value}
      </strong>
      <span className="mt-0.5 block text-[11px] text-[var(--color-text-3)]">
        {label}
      </span>
    </span>
  );
}

function launchReadinessCopy(readiness: WorkspaceLaunchReadiness): string {
  if (readiness.launch_ready) {
    return "The required profile, agent, and channel gates are ready. Watch outreach and replies for movement.";
  }
  const next = readiness.checks.find(
    (check) => check.required && check.status !== "ready",
  );
  return next?.detail ?? "Finish the required launch checks before scaling outreach.";
}

function workspaceChannelCoverage(channels: ChannelRow[]): ChannelCoverage {
  const email = firstByReadiness(
    channels.filter((channel) => channel.kind === "oauth_outlook"),
  );
  const linkedIn = firstByReadiness(
    channels.filter(
      (channel) =>
        channel.kind === "linkedin_session" || channel.kind === "linkedin_oauth",
    ),
  );
  return {
    email: channelConnection(email, "Connect Outlook", "/dashboard/integrations"),
    linkedIn: channelConnection(
      linkedIn,
      "Connect LinkedIn",
      "/dashboard/integrations",
    ),
  };
}

function firstByReadiness(channels: ChannelRow[]): ChannelRow | undefined {
  return channels.find((channel) => channel.status === "connected") ?? channels[0];
}

function channelConnection(
  channel: ChannelRow | undefined,
  fallback: string,
  href: string,
): ChannelConnection {
  if (!channel) {
    return {
      connected: false,
      label: fallback,
      status: "needed",
      dailyCap: null,
      href,
    };
  }
  return {
    connected: channel.status === "connected",
    label: channel.display_name,
    status: channel.status,
    dailyCap: channel.daily_cap,
    href,
  };
}

function firstChannelPolicy(
  rep: RepRow,
  keys: string[],
): RepChannelPolicy | undefined {
  const channels = rep.autonomy?.channels;
  if (!channels) return undefined;
  for (const key of keys) {
    const policy = channels[key];
    if (policy) return policy;
  }
  return undefined;
}

function repIcon(_rep: RepRow): string {
  return "badge";
}

function agentDisplayName(name: string): string {
  if (name === "Sampark" || name === "Prayog") return "Outbound agent";
  return name;
}

function channelIcon(kind: string): string {
  if (kind === "oauth_outlook") return "mail";
  if (kind === "linkedin_session" || kind === "linkedin_oauth") return "forum";
  return "send";
}

function channelKindLabel(kind: string): string {
  if (kind === "oauth_outlook") return "Outlook";
  if (kind === "linkedin_session") return "LinkedIn session";
  if (kind === "linkedin_oauth") return "LinkedIn";
  return kind.replace(/_/g, " ");
}

function approvalLabel(value: string): string {
  if (value === "none") return "Autonomous after checks";
  if (value === "always") return "Review every move";
  if (value === "approve_first") return "Review first move";
  if (value === "research_only") return "Research only";
  return value.replace(/_/g, " ");
}

function statusLabel(status: string): string {
  if (status === "active") return "Active";
  if (status === "connected") return "Connected";
  if (status === "needs_reauth") return "Needs reauth";
  return status.replace(/_/g, " ");
}

function NoWorkspaceReps() {
  return (
    <div className="space-y-10">
      <SurfaceHero
        kicker="Agent"
        title="Create a workspace."
        description="The agent needs a workspace profile, channels, and launch guardrails before it can act."
      />
      <EmptyState
        title="No workspace selected."
        hint="Create or select a workspace before configuring the agent."
        cta={{
          href: "/dashboard/settings#profile",
          label: "Start setup",
          icon: "add_business",
        }}
      />
    </div>
  );
}

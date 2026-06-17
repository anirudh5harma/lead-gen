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
    channels?: Record<string, { daily_cap?: number; approval?: string }>;
  } | null;
  open_conversations: string;
  sent_7d: string;
  outcomes_7d: string;
}

interface ChannelRow {
  id: string;
  display_name: string;
  kind: string;
  status: string;
  daily_cap: number | null;
  last_error: string | null;
}

interface RepsState {
  reps: RepRow[];
  channels: ChannelRow[];
  readiness: WorkspaceLaunchReadiness;
}

async function loadRepsState(workspaceId: string): Promise<RepsState> {
  const pool = getPool();
  const [reps, channels, readiness] = await Promise.all([
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
        order by case r.name
                   when 'Sampark' then 0
                   when 'Prayog' then 1
                   else 2
                 end,
                 r.created_at asc`,
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
  ]);
  return {
    reps: reps.rows,
    channels: channels.rows,
    readiness,
  };
}

export default async function RepsPage() {
  const active = await getActiveWorkspaceSession();
  if (!active) return <NoWorkspaceReps />;

  const state = await loadRepsState(active.workspace.id);
  const activeReps = state.reps.filter((rep) => rep.status === "active").length;
  const connectedChannels = state.channels.filter(
    (channel) => channel.status === "connected",
  ).length;

  return (
    <div className="space-y-10">
      <SurfaceHero
        kicker="Reps"
        title={
          <>
            Your outbound <em>operators</em>.
          </>
        }
        description="Configure the voices that turn Signals into email and LinkedIn conversations. Channels and limits stay visible here so a Rep never launches blind."
        meta={
          <div className="flex flex-wrap gap-2">
            <HeroStat label="Active Reps" value={activeReps} />
            <HeroStat label="Channels" value={connectedChannels} />
            <HeroStat
              label="Launch"
              value={state.readiness.launch_ready ? "Ready" : "Blocked"}
            />
          </div>
        }
      />

      <SurfaceSection
        title="Rep roster"
        action={
          <Link href="/dashboard/prospecting" className="btn-solid-sm">
            <Icon name="edit_note" size={14} />
            Tune setup
          </Link>
        }
      >
        {state.reps.length === 0 ? (
          <EmptyState
            title="No Reps configured yet."
            hint="Start by defining the workspace profile, audience, voice, and approval mode."
            cta={{
              href: "/dashboard/prospecting",
              label: "Configure first Rep",
              icon: "badge",
            }}
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {state.reps.map((rep) => (
              <RepCard key={rep.id} rep={rep} />
            ))}
          </div>
        )}
      </SurfaceSection>

      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-12">
        <SurfaceSection title="Connected channels">
          {state.channels.length === 0 ? (
            <EmptyState
              title="No outbound accounts connected."
              hint="Connect Outlook or LinkedIn before any Rep can move a conversation."
              cta={{
                href: "/dashboard/settings",
                label: "Connect accounts",
                icon: "settings",
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
              <Link href="/dashboard/prospecting" className="priority-action">
                <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
                  <Icon name="person" size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--color-text-1)]">
                    Profile and audience
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--color-text-3)]">
                    Company, ICP, voice, and review mode.
                  </span>
                </span>
              </Link>
              <Link href="/dashboard/prospects" className="priority-action">
                <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
                  <Icon name="travel_explore" size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--color-text-1)]">
                    Prospects and signals
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--color-text-3)]">
                    People, companies, timing evidence, and conversations.
                  </span>
                </span>
              </Link>
              <Link href="/dashboard/settings" className="priority-action">
                <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
                  <Icon name="settings" size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--color-text-1)]">
                    Accounts and limits
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--color-text-3)]">
                    Outlook, LinkedIn, and workspace posture.
                  </span>
                </span>
              </Link>
              <Link href="/dashboard/plays" className="priority-action">
                <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
                  <Icon name="science" size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--color-text-1)]">
                    Plays and learning
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--color-text-3)]">
                    Signal-led workflows and outcome feedback.
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

function RepCard({ rep }: { rep: RepRow }) {
  const emailPolicy = rep.autonomy?.channels?.email;
  const approval = emailPolicy?.approval ?? "not set";
  const dailyCap = emailPolicy?.daily_cap ?? 0;
  return (
    <Link
      href={`/dashboard/reps/${rep.id}`}
      className="group grid gap-5 rounded-[10px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] p-5 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)]/50"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
          <Icon name={repIcon(rep)} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[18px] font-semibold text-[var(--color-text-1)]">
              {rep.name}
            </h2>
            <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2 py-1 text-[11px] text-[var(--color-text-3)]">
              {rep.role.replace(/_/g, " ")}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-2)]">
            {rep.persona.story ??
              "Configure this Rep with a clear voice and launch guardrails."}
          </p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <MiniStat label="Open" value={Number(rep.open_conversations)} />
        <MiniStat label="Sent 7d" value={Number(rep.sent_7d)} />
        <MiniStat label="Outcomes 7d" value={Number(rep.outcomes_7d)} />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line-1)] pt-3 text-xs text-[var(--color-text-3)]">
        <span>{statusLabel(rep.status)}</span>
        <span aria-hidden="true">/</span>
        <span>{dailyCap > 0 ? `${dailyCap}/day` : "No daily cap"}</span>
        <span aria-hidden="true">/</span>
        <span>{approvalLabel(approval)}</span>
      </div>
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
      <Link href="/dashboard/settings" className="btn-solid-sm w-fit">
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
    return "The required profile, Rep, Play, and channel gates are ready. Watch Inbox and Outcomes for movement.";
  }
  const next = readiness.checks.find(
    (check) => check.required && check.status !== "ready",
  );
  return next?.detail ?? "Finish the required launch checks before scaling outreach.";
}

function repIcon(rep: RepRow): string {
  if (rep.name === "Sampark") return "forum";
  if (rep.name === "Prayog") return "science";
  return "badge";
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
        kicker="Reps"
        title="Create a workspace."
        description="Reps need a workspace profile, channels, and launch guardrails before they can act."
      />
      <EmptyState
        title="No workspace selected."
        hint="Create or select a workspace before configuring Reps."
        cta={{
          href: "/dashboard/prospecting",
          label: "Start setup",
          icon: "add_business",
        }}
      />
    </div>
  );
}

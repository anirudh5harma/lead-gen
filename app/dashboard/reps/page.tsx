import Link from "next/link";
import { EmptyState } from "@/components/dashboard/Shell";
import { ProfileIntelligence } from "@/components/dashboard/ProfileIntelligence";
import Icon from "@/components/Icon";
import { getAppState } from "@/core/product/app.ts";
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
    kpis?: string[];
    do_not?: string[];
  };
  channels: string[];
  outbound_24h: string;
  positive_24h: string;
  conversations_open: string;
  last_activity_at: Date | null;
}

async function loadReps(workspaceId: string): Promise<RepRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<RepRow>(
    `select r.id, r.name, r.role::text as role, r.status::text as status,
            r.persona, r.channels,
            (select count(*)::text from messages m
              where m.workspace_id = $1 and m.direction = 'outbound'
                and m.status in ('sent','delivered','replied')
                and m.sent_at >= now() - interval '24 hours'
                and m.conversation_id in (
                  select c.id from conversations c
                    where c.workspace_id = $1 and c.rep_id = r.id
                )) as outbound_24h,
            (select count(*)::text from outcomes o
              where o.workspace_id = $1 and o.attributed_rep_id = r.id
                and o.kind = 'positive_reply'
                and o.recorded_at >= now() - interval '24 hours') as positive_24h,
            (select count(*)::text from conversations c
              where c.workspace_id = $1 and c.rep_id = r.id
                and c.status in ('open','awaiting_them','awaiting_us')) as conversations_open,
            greatest(
              r.updated_at,
              coalesce((select max(c.last_activity_at) from conversations c
                where c.workspace_id = $1 and c.rep_id = r.id), r.updated_at),
              coalesce((select max(o.recorded_at) from outcomes o
                where o.workspace_id = $1 and o.attributed_rep_id = r.id), r.updated_at)
            ) as last_activity_at
       from reps r
      where r.workspace_id = $1
      order by r.created_at desc`,
    [workspaceId],
  );
  return rows;
}

export default async function RepsPage() {
  const active = await getActiveWorkspaceSession();
  if (!active) return <CanvasEmpty label="Profile" title="No workspace selected." />;

  const pool = getPool();
  const [reps, state] = await Promise.all([
    loadReps(active.workspace.id),
    getAppState(pool, {
      workspace_id: active.workspace.id,
      user_id: active.user_id,
    }),
  ]);
  const sent = reps.reduce((sum, rep) => sum + Number(rep.outbound_24h), 0);
  const positives = reps.reduce((sum, rep) => sum + Number(rep.positive_24h), 0);
  const profile = state.profile;

  return (
    <>
      <section className="section-canvas min-h-[420px] p-5 sm:p-8">
        <div className="section-thread section-thread-a" />
        <div className="grid gap-8 lg:grid-cols-[1fr_320px] lg:items-end">
          <div>
            <p className="brief-kicker">Profile</p>
            <h1 className="mt-4 max-w-3xl text-[38px] font-semibold leading-[1.04] tracking-[0] text-[var(--color-text-1)] sm:text-[58px]">
              The people behind the work.
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--color-text-2)]">
              Bombsell uses this profile to keep outreach, content, campaigns, and AEO aligned.
            </p>
          </div>
          <div className="section-note">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">Today</p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <SmallState label="Voices" value={reps.length} />
              <SmallState label="Sent" value={sent} />
              <SmallState label="Replies" value={positives} />
            </div>
          </div>
        </div>
      </section>

      <ProfileIntelligence profile={profile} />

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        {reps.length === 0 ? (
          <EmptyState
            title="No voices yet"
            hint="Shape the profile to create the first sender."
            cta={{ href: "/dashboard/setup", label: "Tune profile", icon: "tune" }}
          />
        ) : (
          reps.map((rep) => <RepNote key={rep.id} rep={rep} />)
        )}
      </section>
    </>
  );
}

function RepNote({ rep }: { rep: RepRow }) {
  return (
    <Link href={`/dashboard/reps/${rep.id}`} className="section-note block transition hover:border-[var(--color-line-2)]">
      <div className="flex items-start gap-3">
        <span className="brief-note-icon">
          <Icon name={repIcon(rep.name)} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-[var(--color-text-1)]">{rep.name}</h2>
            <span className="rounded-full bg-[var(--color-ink-2)] px-2 py-1 text-xs text-[var(--color-text-2)]">
              {roleLabel(rep)}
            </span>
            <span className="rounded-full bg-[var(--color-accent-bg)] px-2 py-1 text-xs text-[var(--color-accent)]">
              {rep.status === "active" ? "Active" : "Paused"}
            </span>
          </div>
          {rep.persona.voice ? (
            <p className="mt-3 text-sm leading-6 text-[var(--color-text-2)]">{rep.persona.voice}</p>
          ) : null}
          {rep.persona.do_not?.length ? (
            <p className="mt-3 text-xs leading-5 text-[var(--color-text-3)]">
              Avoid {rep.persona.do_not.join(", ")}
            </p>
          ) : null}
          <p className="mt-4 text-xs text-[var(--color-text-3)]">
            {rep.outbound_24h} sent today. {rep.positive_24h} positive. {rep.conversations_open} open.
            {rep.last_activity_at ? ` Fresh ${timeAgo(rep.last_activity_at)}.` : ""}
          </p>
        </div>
      </div>
    </Link>
  );
}

function roleLabel(rep: RepRow): string {
  if (rep.name === "Sampark") return "Outreach SDR";
  if (rep.name === "Vaani") return "Content";
  if (rep.name === "Prayog") return "Campaigns";
  if (rep.name === "Bodh") return "AEO";
  return rep.role.replace(/_/g, " ");
}

function repIcon(name: string): string {
  if (name === "Sampark") return "forum";
  if (name === "Vaani") return "edit_note";
  if (name === "Prayog") return "science";
  if (name === "Bodh") return "neurology";
  return "person";
}

function timeAgo(value: Date): string {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function SmallState({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-[10px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.56)] p-3 text-center">
      <strong className="block text-2xl font-semibold tabular-nums text-[var(--color-text-1)]">{value}</strong>
      <span className="mt-1 block text-xs text-[var(--color-text-3)]">{label}</span>
    </span>
  );
}

function CanvasEmpty({ label, title }: { label: string; title: string }) {
  return (
    <section className="section-canvas p-6">
      <p className="brief-kicker">{label}</p>
      <h1 className="mt-4 text-[34px] font-semibold leading-tight text-[var(--color-text-1)]">{title}</h1>
    </section>
  );
}

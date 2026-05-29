import { EmptyState } from "@/components/dashboard/Shell";
import Icon from "@/components/Icon";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspace } from "@/lib/workspace";
import { listDeadLetteredDispatches } from "@/core/substrate/events/index.ts";

export const dynamic = "force-dynamic";

interface DispatchCounts {
  pending: number;
  delivered_24h: number;
  dead_lettered: number;
}

async function loadDispatchCounts(workspaceId: string): Promise<DispatchCounts> {
  const pool = getPool();
  const { rows } = await pool.query<{
    pending: string;
    delivered_24h: string;
    dead_lettered: string;
  }>(
    `select
       (select count(*)::text from event_nats_dispatches
         where workspace_id = $1 and status = 'pending') as pending,
       (select count(*)::text from event_nats_dispatches
         where workspace_id = $1 and status = 'delivered'
           and delivered_at >= now() - interval '24 hours') as delivered_24h,
       (select count(*)::text from event_nats_dispatches
         where workspace_id = $1 and status = 'dead_lettered') as dead_lettered`,
    [workspaceId],
  );
  return {
    pending: Number(rows[0].pending),
    delivered_24h: Number(rows[0].delivered_24h),
    dead_lettered: Number(rows[0].dead_lettered),
  };
}

function timeAgo(d: string | Date | null): string {
  if (!d) return "never";
  const diff = Date.now() - new Date(d).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default async function OpsPage() {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return (
      <section className="section-canvas p-6">
        <p className="brief-kicker">AEO</p>
        <h1 className="mt-4 text-[34px] font-semibold leading-tight text-[var(--color-text-1)]">
          No workspace selected.
        </h1>
      </section>
    );
  }

  const [counts, dead] = await Promise.all([
    loadDispatchCounts(workspace.id),
    listDeadLetteredDispatches(getPool(), workspace.id, 100),
  ]);

  return (
    <>
      <section className="section-canvas min-h-[420px] p-5 sm:p-8">
        <div className="section-thread section-thread-a" />
        <div className="grid gap-8 lg:grid-cols-[1fr_340px] lg:items-end">
          <div>
            <p className="brief-kicker">AEO</p>
            <h1 className="mt-4 max-w-3xl text-[38px] font-semibold leading-[1.04] tracking-[0] text-[var(--color-text-1)] sm:text-[58px]">
              Visibility and background work, only when it needs attention.
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--color-text-2)]">
              Keep this quiet by default. Bombsell should only surface blocked work, delivery problems, and visibility gaps worth fixing.
            </p>
          </div>
          <div className="section-note">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">Work state</p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <State label="Waiting" value={counts.pending} />
              <State label="Moved" value={counts.delivered_24h} />
              <State label="Review" value={counts.dead_lettered} />
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 section-canvas p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="brief-note-icon">
            <Icon name="travel_explore" size={18} />
          </span>
          <h2 className="text-lg font-semibold text-[var(--color-text-1)]">Needs attention</h2>
        </div>
        {dead.length === 0 ? (
          <EmptyState
            title="Nothing needs attention"
            hint="Visibility and delivery work are moving normally."
          />
        ) : (
          <ul className="grid gap-2">
            {dead.map((d) => (
              <li key={d.event_id} className="rounded-[12px] bg-[rgba(255,255,255,0.68)] px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="w-44 truncate text-xs text-[var(--color-text-3)]">
                    {d.event_type}
                  </span>
                  <p className="font-sans text-sm text-[var(--color-text-1)] flex-1 truncate">
                    {d.last_error ?? "(no error message)"}
                  </p>
                  <span className="w-20 text-right text-xs tabular-nums text-[var(--color-text-3)]">
                    {d.attempts} tries
                  </span>
                  <span className="w-20 text-right text-xs tabular-nums text-[var(--color-text-3)]">
                    {timeAgo(d.dead_lettered_at)}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-[var(--color-text-4)]">
                  Event {d.event_id}. Source {d.source}
                  {d.producer_ref ? `. Producer ${d.producer_ref}` : ""}
                </p>
                <form
                  action={`/api/internal/ops/dead-letter/redrive?event_id=${encodeURIComponent(d.event_id)}`}
                  method="POST"
                  className="mt-2"
                >
                  <button
                    type="submit"
                    className="rounded-[8px] bg-[var(--color-accent-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--color-accent)]"
                  >
                    Retry
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function State({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-[10px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.56)] p-3 text-center">
      <strong className="block text-2xl font-semibold tabular-nums text-[var(--color-text-1)]">{value}</strong>
      <span className="mt-1 block text-xs text-[var(--color-text-3)]">{label}</span>
    </span>
  );
}

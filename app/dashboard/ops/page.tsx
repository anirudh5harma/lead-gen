import {
  EmptyState,
  MetricCard,
  SectionHeader,
} from "@/components/dashboard/Shell";
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
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function OpsPage() {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return (
      <>
        <SectionHeader
          eyebrow="ops"
          title="No workspace"
          subtitle="Active workspace required to inspect the event dispatch queue."
        />
      </>
    );
  }

  const [counts, dead] = await Promise.all([
    loadDispatchCounts(workspace.id),
    listDeadLetteredDispatches(getPool(), workspace.id, 100),
  ]);

  return (
    <>
      <SectionHeader
        eyebrow="ops"
        title="Event bus delivery"
        subtitle="The production NATS dispatch queue. Dead-lettered events are no longer redriven automatically; pick them up here."
      />

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-10">
        <MetricCard
          label="Pending"
          value={counts.pending}
          hint="waiting on NATS delivery"
        />
        <MetricCard
          label="Delivered"
          value={counts.delivered_24h}
          hint="last 24h"
        />
        <MetricCard
          label="Dead-lettered"
          value={counts.dead_lettered}
          hint="needs operator attention"
        />
      </section>

      <section>
        <h2 className="font-serif text-xl text-[var(--color-text-1)] mb-3">
          Dead-lettered events
        </h2>
        {dead.length === 0 ? (
          <EmptyState
            title="Nothing in the dead-letter queue"
            hint="Events that fail NATS delivery 8 times in a row land here. None right now."
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line-1)] border border-[var(--color-line-1)] rounded-lg overflow-hidden bg-[var(--color-ink-0)]">
            {dead.map((d) => (
              <li key={d.event_id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-3)] w-44 truncate">
                    {d.event_type}
                  </span>
                  <p className="font-sans text-sm text-[var(--color-text-1)] flex-1 truncate">
                    {d.last_error ?? "(no error message)"}
                  </p>
                  <span className="font-mono text-xs text-[var(--color-text-3)] tabular-nums w-20 text-right">
                    {d.attempts} tries
                  </span>
                  <span className="font-mono text-xs text-[var(--color-text-3)] tabular-nums w-20 text-right">
                    {timeAgo(d.dead_lettered_at)}
                  </span>
                </div>
                <p className="font-mono text-[10px] text-[var(--color-text-4)] mt-1 truncate">
                  event {d.event_id} · source {d.source}
                  {d.producer_ref ? ` · producer ${d.producer_ref}` : ""}
                </p>
                <form
                  action={`/api/internal/ops/dead-letter/redrive?event_id=${encodeURIComponent(d.event_id)}`}
                  method="POST"
                  className="mt-2"
                >
                  <button
                    type="submit"
                    className="font-mono text-[10px] uppercase tracking-[0.16em] px-2 py-1 rounded bg-[var(--color-accent-bg)] text-[var(--color-accent)]"
                  >
                    Redrive
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

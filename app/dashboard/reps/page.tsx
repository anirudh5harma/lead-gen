import { EmptyState, SectionHeader } from "@/components/dashboard/Shell";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspace } from "@/lib/workspace";

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
  autonomy: Record<string, unknown>;
  outbound_24h: string;
  positive_24h: string;
  conversations_open: string;
}

async function loadReps(workspaceId: string): Promise<RepRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<RepRow>(
    `select r.id, r.name, r.role::text as role, r.status::text as status,
            r.persona, r.channels, r.autonomy,
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
                and c.status in ('open','awaiting_them','awaiting_us')) as conversations_open
       from reps r
      where r.workspace_id = $1
      order by r.created_at desc`,
    [workspaceId],
  );
  return rows;
}

export default async function RepsPage() {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return (
      <>
        <SectionHeader eyebrow="reps" title="No workspace selected" />
      </>
    );
  }
  const reps = await loadReps(workspace.id);

  return (
    <>
      <SectionHeader
        eyebrow="reps"
        title="Your Reps"
        subtitle="The named personas. Role-agent composition is an implementation detail."
      />
      {reps.length === 0 ? (
        <EmptyState
          title="No Reps yet"
          hint="Open Setup to create the first named Rep and bind it to an email Play."
        />
      ) : (
        <ul className="space-y-4">
          {reps.map((r) => (
            <li
              key={r.id}
              className="border border-[var(--color-line-1)] rounded-lg p-5 bg-[var(--color-ink-0)]"
            >
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <h3 className="font-serif text-xl text-[var(--color-text-1)]">
                      {r.name}
                    </h3>
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] px-2 py-0.5 rounded bg-[var(--color-ink-3)] text-[var(--color-text-2)]">
                      {r.role}
                    </span>
                    <span
                      className={
                        "font-mono text-[10px] uppercase tracking-[0.16em] px-2 py-0.5 rounded " +
                        (r.status === "active"
                          ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
                          : "bg-[var(--color-ink-3)] text-[var(--color-text-2)]")
                      }
                    >
                      {r.status}
                    </span>
                  </div>
                  {r.persona.voice ? (
                    <p className="font-serif text-sm text-[var(--color-text-2)] mt-2 italic">
                      &ldquo;{r.persona.voice}&rdquo;
                    </p>
                  ) : null}
                  {r.persona.do_not && r.persona.do_not.length > 0 ? (
                    <p className="font-mono text-xs text-[var(--color-text-3)] mt-2">
                      do not: {r.persona.do_not.join(" · ")}
                    </p>
                  ) : null}
                  <div className="flex gap-2 mt-3">
                    {r.channels.map((c) => (
                      <span
                        key={c}
                        className="font-mono text-[10px] uppercase tracking-[0.16em] px-2 py-0.5 rounded bg-[var(--color-ink-2)] text-[var(--color-text-2)]"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-3)]">
                    last 24h
                  </p>
                  <p className="font-serif text-2xl text-[var(--color-text-1)] mt-1 tabular-nums">
                    {r.outbound_24h}
                  </p>
                  <p className="font-mono text-xs text-[var(--color-text-3)]">
                    sent
                  </p>
                  <p className="font-mono text-xs text-[var(--color-pos)] mt-2">
                    {r.positive_24h} positive
                  </p>
                  <p className="font-mono text-xs text-[var(--color-text-3)]">
                    {r.conversations_open} open
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

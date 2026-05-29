import { EmptyState, SectionHeader } from "@/components/dashboard/Shell";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

interface PlayRow {
  id: string;
  name: string;
  description: string | null;
  declaration: string;
  status: string;
  version: number;
  autonomy: Record<string, unknown>;
  runs_24h: string;
  last_run_at: Date | null;
}

async function loadPlays(workspaceId: string): Promise<PlayRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<PlayRow>(
    `select p.id, p.name, p.description, p.declaration,
            p.status::text as status, p.version, p.autonomy,
            (select count(*)::text from play_runs pr
              where pr.workspace_id = $1 and pr.play_id = p.id
                and pr.created_at >= now() - interval '24 hours') as runs_24h,
            (select max(pr.created_at) from play_runs pr
              where pr.workspace_id = $1 and pr.play_id = p.id) as last_run_at
       from plays p
      where p.workspace_id = $1
      order by p.updated_at desc`,
    [workspaceId],
  );
  return rows;
}

export default async function PlaysPage() {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return (
      <>
        <SectionHeader eyebrow="plays" title="No workspace selected" />
      </>
    );
  }
  const plays = await loadPlays(workspace.id);

  return (
    <>
      <SectionHeader
        eyebrow="plays"
        title="Plays"
        subtitle="Declarative workflows. NL declaration on top, compiled spec underneath."
      />
      {plays.length === 0 ? (
        <EmptyState
          title="No Plays defined in this workspace"
          hint="Open Setup to configure the first Signal-to-email Play with per-channel approval and volume gates."
        />
      ) : (
        <ul className="space-y-4">
          {plays.map((p) => (
            <li
              key={p.id}
              className="border border-[var(--color-line-1)] rounded-lg p-5 bg-[var(--color-ink-0)]"
            >
              <div className="flex items-center gap-3">
                <h3 className="font-serif text-xl text-[var(--color-text-1)]">
                  {p.name}
                </h3>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] px-2 py-0.5 rounded bg-[var(--color-ink-3)] text-[var(--color-text-2)]">
                  v{p.version}
                </span>
                <span
                  className={
                    "font-mono text-[10px] uppercase tracking-[0.16em] px-2 py-0.5 rounded " +
                    (p.status === "active"
                      ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
                      : "bg-[var(--color-ink-3)] text-[var(--color-text-2)]")
                  }
                >
                  {p.status}
                </span>
                <span className="ml-auto font-mono text-xs text-[var(--color-text-3)]">
                  {p.runs_24h} runs · last{" "}
                  {p.last_run_at ? new Date(p.last_run_at).toLocaleString() : "never"}
                </span>
              </div>
              {p.description ? (
                <p className="font-sans text-sm text-[var(--color-text-2)] mt-2">
                  {p.description}
                </p>
              ) : null}
              <pre className="mt-3 font-mono text-xs text-[var(--color-text-2)] bg-[var(--color-ink-2)] rounded p-3 overflow-auto max-h-40 whitespace-pre-wrap">
                {p.declaration}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

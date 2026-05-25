import Link from "next/link";
import { EmptyState, SectionHeader } from "@/components/dashboard/Shell";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

interface ConversationRow {
  id: string;
  status: string;
  topic: string | null;
  started_at: Date;
  last_activity_at: Date;
  counterparty_name: string | null;
  company_name: string | null;
  rep_name: string | null;
  signal_title: string | null;
}

async function loadConversations(workspaceId: string): Promise<ConversationRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<ConversationRow>(
    `select c.id, c.status::text as status, c.topic, c.started_at, c.last_activity_at,
            p.full_name as counterparty_name,
            co.name as company_name,
            r.name as rep_name,
            s.title as signal_title
       from conversations c
       left join graph_persons p on p.id = c.counterparty_person_id
       left join graph_companies co on co.id = c.counterparty_company_id
       left join reps r on r.id = c.rep_id
       left join signals s on s.id = c.origin_signal_id
      where c.workspace_id = $1
      order by c.last_activity_at desc
      limit 100`,
    [workspaceId],
  );
  return rows;
}

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  open: { label: "open", tone: "text-[var(--color-text-2)] bg-[var(--color-ink-3)]" },
  awaiting_us: {
    label: "needs you",
    tone: "text-[var(--color-accent)] bg-[var(--color-accent-bg)]",
  },
  awaiting_them: {
    label: "awaiting them",
    tone: "text-[var(--color-text-2)] bg-[var(--color-ink-3)]",
  },
  paused: {
    label: "paused",
    tone: "text-[var(--color-text-2)] bg-[var(--color-ink-3)]",
  },
  closed_positive: {
    label: "won",
    tone: "text-[var(--color-pos)] bg-[var(--color-pos-bg)]",
  },
  closed_negative: {
    label: "closed —",
    tone: "text-[var(--color-neg)] bg-[var(--color-neg-bg)]",
  },
  closed_no_response: {
    label: "no response",
    tone: "text-[var(--color-text-3)] bg-[var(--color-ink-2)]",
  },
};

export default async function ConversationsPage() {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return (
      <>
        <SectionHeader eyebrow="conversations" title="No workspace selected" />
        <EmptyState title="No workspace found" />
      </>
    );
  }
  const convs = await loadConversations(workspace.id);
  return (
    <>
      <SectionHeader
        eyebrow="conversations"
        title="All conversations"
        subtitle={`${convs.length} threads (most recent first)`}
      />
      {convs.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          hint="When a Play sends an email, the conversation it opened lands here."
        />
      ) : (
        <ul className="divide-y divide-[var(--color-line-1)] border border-[var(--color-line-1)] rounded-lg overflow-hidden bg-[var(--color-ink-0)]">
          {convs.map((c) => {
            const badge =
              STATUS_LABEL[c.status] ?? {
                label: c.status,
                tone: "text-[var(--color-text-3)] bg-[var(--color-ink-3)]",
              };
            return (
              <li key={c.id}>
                <Link
                  href={`/dashboard/conversations/${c.id}`}
                  className="grid grid-cols-[1fr_120px_120px] items-center px-4 py-3 gap-4 hover:bg-[var(--color-ink-2)] transition-colors"
                >
                  <div className="min-w-0">
                    <p className="font-sans text-sm text-[var(--color-text-1)] truncate">
                      {c.counterparty_name ?? "(unknown)"}
                      {c.company_name ? (
                        <span className="text-[var(--color-text-3)] ml-1">
                          · {c.company_name}
                        </span>
                      ) : null}
                      {c.rep_name ? (
                        <span className="font-mono text-xs text-[var(--color-text-3)] ml-2">
                          ↳ {c.rep_name}
                        </span>
                      ) : null}
                    </p>
                    <p className="font-serif italic text-sm text-[var(--color-text-2)] truncate mt-0.5">
                      {c.topic ?? c.signal_title ?? "(no topic)"}
                    </p>
                  </div>
                  <span
                    className={
                      "font-mono text-[10px] uppercase tracking-[0.16em] px-2 py-1 rounded justify-self-start " +
                      badge.tone
                    }
                  >
                    {badge.label}
                  </span>
                  <span className="font-mono text-xs text-[var(--color-text-3)] tabular-nums text-right">
                    {new Date(c.last_activity_at).toLocaleString()}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

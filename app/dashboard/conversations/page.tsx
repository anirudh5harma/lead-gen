import type { Metadata } from "next";
import Icon from "@/components/Icon";
import { EmptyState } from "@/components/dashboard/Shell";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSessionForDashboard } from "@/lib/workspace";

export const metadata: Metadata = { title: "Conversations | Bombsell" };
export const dynamic = "force-dynamic";

interface ConvRow {
  id: string;
  status: string;
  topic: string | null;
  channels: string[];
  message_count: number;
  last_activity_at: Date;
  last_message_preview: string | null;
  last_message_direction: string | null;
  counterparty_name: string | null;
  counterparty_company: string | null;
}

async function loadConversations(
  workspaceId: string,
  limit = 60,
): Promise<ConvRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<ConvRow>(
    `select c.id,
            c.status::text as status,
            c.topic,
            c.last_activity_at,
            coalesce(p.full_name, 'Unknown') as counterparty_name,
            co.name as counterparty_company,
            (
              select array_agg(distinct m.channel::text)
                from messages m
               where m.workspace_id = $1 and m.conversation_id = c.id
            ) as channels,
            (
              select count(*)::int
                from messages m
               where m.workspace_id = $1 and m.conversation_id = c.id
            ) as message_count,
            lm.body_preview as last_message_preview,
            lm.direction as last_message_direction
       from conversations c
       left join graph_persons p on p.id = c.counterparty_person_id
       left join graph_companies co on co.id = c.counterparty_company_id
       left join lateral (
         select left(coalesce(m.body, m.subject, ''), 180) as body_preview,
                m.direction::text as direction
           from messages m
          where m.workspace_id = $1
            and m.conversation_id = c.id
          order by coalesce(m.sent_at, m.created_at) desc nulls last
          limit 1
       ) lm on true
      where c.workspace_id = $1
      order by c.last_activity_at desc
      limit $2`,
    [workspaceId, limit],
  );
  return rows;
}

export default async function ConversationsPage() {
  const session = await getActiveWorkspaceSessionForDashboard("conversations");
  if (!session) return <ConvEmpty />;
  const rows = await loadConversations(session.workspace.id).catch((err) => {
    console.error("[conversations] load failed", err);
    return [] as ConvRow[];
  });

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-accent)]">
          Conversations
        </p>
        <h1
          className="mt-3 text-[clamp(2rem,4vw,3rem)] font-bold leading-[1.05] tracking-[-0.02em] text-[var(--color-text-1)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          All threads
        </h1>
        <p className="mt-2 max-w-[68ch] text-[15px] leading-6 text-[var(--color-text-3)]">
          Every outreach across Outlook + LinkedIn, unified per counterparty.
        </p>
      </header>
      {rows.length === 0 ? (
        <ConvEmpty />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <ConvCard key={row.id} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ConvCard({ row }: { row: ConvRow }) {
  const channelLabel = (row.channels ?? [])
    .map((ch) => channelPretty(ch))
    .join(" · ");
  return (
    <li>
      <a
        href={`/dashboard/conversations/${row.id}`}
        className="group grid gap-2 rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4 transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-0.5 hover:border-[var(--color-line-3)] hover:shadow-[0_18px_40px_-24px_rgba(0,0,0,0.22)] md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
      >
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-[var(--color-text-1)]">
            <span className="truncate">{row.counterparty_name}</span>
            {row.counterparty_company ? (
              <span className="truncate text-[var(--color-text-3)]">
                · {row.counterparty_company}
              </span>
            ) : null}
            <StatusPill status={row.status} />
          </p>
          {row.topic ? (
            <p className="mt-1 truncate text-[13px] text-[var(--color-text-2)]">
              {row.topic}
            </p>
          ) : null}
          {row.last_message_preview ? (
            <p className="mt-1.5 line-clamp-2 text-[13px] leading-5 text-[var(--color-text-3)]">
              <span className="font-medium text-[var(--color-text-2)]">
                {row.last_message_direction === "outbound" ? "You:" : "Them:"}
              </span>{" "}
              {row.last_message_preview}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1 text-[12px] text-[var(--color-text-3)]">
          <span className="tabular-nums">{relativeWhen(row.last_activity_at)}</span>
          <span className="inline-flex items-center gap-1">
            <Icon name="forum" size={11} />
            {row.message_count}
          </span>
          {channelLabel ? (
            <span className="text-[11px] text-[var(--color-text-4)]">
              {channelLabel}
            </span>
          ) : null}
        </div>
      </a>
    </li>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    open: "bg-[var(--color-brand-green)] text-[#273416]",
    replied: "bg-[var(--color-brand-blue)] text-[#0a0d27]",
    closed: "bg-[var(--color-ink-2)] text-[var(--color-text-3)]",
  };
  const cls = map[status] ?? "bg-[var(--color-ink-2)] text-[var(--color-text-3)]";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-medium ${cls}`}>
      {status}
    </span>
  );
}

function channelPretty(ch: string): string {
  if (ch === "email") return "Outlook";
  if (ch === "linkedin_dm") return "LinkedIn DM";
  if (ch === "linkedin_inmail") return "LinkedIn InMail";
  return ch.replace(/_/g, " ");
}

function ConvEmpty() {
  return (
    <EmptyState
      title="No conversations yet"
      hint="Once outreach lands, threads across Outlook + LinkedIn will show up here in one list."
      cta={{
        href: "/dashboard/outreach",
        label: "Open outreach",
        icon: "send",
      }}
    />
  );
}

function relativeWhen(at: Date): string {
  const diffMs = Date.now() - new Date(at).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import Icon from "@/components/Icon";
import { EmptyState } from "@/components/dashboard/Shell";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSessionForDashboard } from "@/lib/workspace";

export const metadata: Metadata = { title: "Conversations | Bombsell" };
export const dynamic = "force-dynamic";

type ConversationSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

interface ConversationFilters {
  q: string;
  status: string | null;
  channel: string | null;
}

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
  counterparty_title: string | null;
  counterparty_company: string | null;
}

async function loadConversations(
  workspaceId: string,
  filters: ConversationFilters,
  limit = 60,
): Promise<ConvRow[]> {
  const pool = getPool();
  const search = filters.q ? `%${filters.q}%` : null;
  const { rows } = await pool.query<ConvRow>(
    `with recent_conversations as materialized (
       select c.id, c.status, c.topic, c.last_activity_at,
              c.counterparty_person_id, c.counterparty_company_id,
              c.workspace_id
         from conversations c
         left join graph_persons fp
           on fp.workspace_id = c.workspace_id
          and fp.id = c.counterparty_person_id
         left join graph_companies fc
           on fc.workspace_id = c.workspace_id
          and fc.id = c.counterparty_company_id
        where c.workspace_id = $1
          and exists (
            select 1
              from messages successful_outreach
             where successful_outreach.workspace_id = c.workspace_id
               and successful_outreach.conversation_id = c.id
               and successful_outreach.direction = 'outbound'
               and successful_outreach.status in ('sent','delivered','replied')
          )
          and ($3::text is null or c.status::text = $3)
          and (
            $4::text is null
            or exists (
              select 1
                from messages filtered_channel
               where filtered_channel.workspace_id = c.workspace_id
                 and filtered_channel.conversation_id = c.id
                 and filtered_channel.direction = 'outbound'
                 and filtered_channel.status in ('sent','delivered','replied')
                 and filtered_channel.channel::text = $4
            )
          )
          and (
            $5::text is null
            or fp.full_name ilike $5
            or fp.title ilike $5
            or fc.name ilike $5
            or c.topic ilike $5
          )
        order by c.last_activity_at desc
        limit $2
     )
     select c.id,
            c.status::text as status,
            c.topic,
            c.last_activity_at,
            coalesce(p.full_name, 'Unknown') as counterparty_name,
            p.title as counterparty_title,
            co.name as counterparty_company,
            coalesce(ma.channels, '{}'::text[]) as channels,
            ma.message_count,
            ma.last_message_preview,
            ma.last_message_direction
       from recent_conversations c
       left join graph_persons p
         on p.workspace_id = c.workspace_id
        and p.id = c.counterparty_person_id
       left join graph_companies co
         on co.workspace_id = c.workspace_id
        and co.id = c.counterparty_company_id
       join lateral (
         select count(*)::int as message_count,
                array_agg(distinct m.channel::text) as channels,
                (array_agg(
                  left(coalesce(m.body, m.subject, ''), 180)
                  order by coalesce(m.sent_at, m.created_at) desc nulls last
                ))[1] as last_message_preview,
                (array_agg(
                  m.direction::text
                  order by coalesce(m.sent_at, m.created_at) desc nulls last
                ))[1] as last_message_direction
           from messages m
          where m.workspace_id = c.workspace_id
            and m.conversation_id = c.id
            and m.status in ('sent','delivered','replied')
       ) ma on true
      order by c.last_activity_at desc`,
    [workspaceId, limit, filters.status, filters.channel, search],
  );
  return rows;
}

export default function ConversationsPage({
  searchParams,
}: {
  searchParams: ConversationSearchParams;
}) {
  return (
    <div className="space-y-6">
      <header>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-accent)]">
          Conversations
        </p>
        <h1 className="mt-3 text-[32px] font-bold leading-tight tracking-[-0.02em] text-[var(--color-text-1)]">
          All conversations
        </h1>
        <p className="mt-2 max-w-[68ch] text-[14px] leading-6 text-[var(--color-text-3)]">
          One thread per counterparty, with channel, reply state, and recent activity in view.
        </p>
      </header>

      <Suspense fallback={<ConversationResultsSkeleton />}>
        <ConversationResults searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ConversationResults({
  searchParams,
}: {
  searchParams: ConversationSearchParams;
}) {
  const filters = parseFilters(await searchParams);
  const session = await getActiveWorkspaceSessionForDashboard("conversations");
  if (!session) return <ConvEmpty />;
  const rows = await loadConversations(session.workspace.id, filters).catch((err) => {
    console.error("[conversations] load failed", err);
    return [] as ConvRow[];
  });

  return (
    <section className="space-y-3">
      <ConversationFilters filters={filters} resultCount={rows.length} />
      {rows.length === 0 ? (
        hasFilters(filters) ? <FilteredEmpty /> : <ConvEmpty />
      ) : (
        <ConversationTable rows={rows} />
      )}
    </section>
  );
}

function ConversationFilters({
  filters,
  resultCount,
}: {
  filters: ConversationFilters;
  resultCount: number;
}) {
  return (
    <form
      action="/dashboard/conversations"
      className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-3 md:flex-row md:items-center"
    >
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">Search conversations</span>
        <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-4)]" />
        <input
          name="q"
          defaultValue={filters.q}
          placeholder="Search contact, company, topic…"
          className="h-9 w-full rounded-[6px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] pl-9 pr-3 text-[13px] text-[var(--color-text-1)] outline-none focus:border-[var(--color-line-3)]"
        />
      </label>
      <select
        name="status"
        defaultValue={filters.status ?? ""}
        aria-label="Conversation status"
        className="h-9 rounded-[6px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] px-2.5 text-[12px] text-[var(--color-text-2)] outline-none"
      >
        <option value="">Any status</option>
        <option value="awaiting_us">Needs reply</option>
        <option value="awaiting_them">Waiting for reply</option>
        <option value="open">Open</option>
        <option value="paused">Paused</option>
        <option value="closed_positive">Won</option>
        <option value="closed_negative">Closed</option>
        <option value="closed_no_response">No response</option>
      </select>
      <select
        name="channel"
        defaultValue={filters.channel ?? ""}
        aria-label="Conversation channel"
        className="h-9 rounded-[6px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] px-2.5 text-[12px] text-[var(--color-text-2)] outline-none"
      >
        <option value="">Any channel</option>
        <option value="email">Outlook</option>
        <option value="linkedin_dm">LinkedIn DM</option>
        <option value="linkedin_inmail">LinkedIn InMail</option>
      </select>
      <button type="submit" className="btn-quiet-sm h-9 justify-center">Apply</button>
      {hasFilters(filters) ? (
        <Link href="/dashboard/conversations" className="px-1 text-[12px] text-[var(--color-text-3)] hover:text-[var(--color-text-1)]">Clear</Link>
      ) : null}
      <span className="whitespace-nowrap text-[11px] tabular-nums text-[var(--color-text-4)]">{resultCount} threads</span>
    </form>
  );
}

function ConversationTable({ rows }: { rows: ConvRow[] }) {
  return (
    <div className="overflow-hidden rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)]">
      <ConversationHeader />
      <ul className="divide-y divide-[var(--color-line-1)]">
        {rows.map((row) => <ConversationRow key={row.id} row={row} />)}
      </ul>
    </div>
  );
}

function ConversationHeader() {
  return (
    <div className="hidden gap-5 bg-[var(--color-ink-1)] px-4 py-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-4)] md:grid md:grid-cols-[minmax(180px,.9fr)_minmax(300px,1.7fr)_140px_100px]">
      <span>Contact</span>
      <span>Conversation</span>
      <span>Status</span>
      <span>Activity</span>
    </div>
  );
}

function ConversationRow({ row }: { row: ConvRow }) {
  const channelLabel = (row.channels ?? []).map(channelPretty).join(" · ");
  return (
    <li>
      <Link
        href={`/dashboard/conversations/${row.id}`}
        className="group grid gap-4 px-4 py-4 transition-colors duration-150 hover:bg-[var(--color-ink-1)] md:grid-cols-[minmax(180px,.9fr)_minmax(300px,1.7fr)_140px_100px] md:items-start md:gap-5"
      >
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-semibold text-[var(--color-text-1)]">{row.counterparty_name}</p>
          <p className="mt-0.5 truncate text-[11.5px] text-[var(--color-text-3)]">
            {[row.counterparty_title, row.counterparty_company].filter(Boolean).join(" · ") || "Counterparty"}
          </p>
        </div>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-[var(--color-text-1)]">
            {row.topic || "Outreach conversation"}
          </p>
          <p className="mt-1 line-clamp-1 text-[11.5px] text-[var(--color-text-3)]">
            <span className="font-medium text-[var(--color-text-2)]">
              {row.last_message_direction === "outbound" ? "You:" : "Them:"}
            </span>{" "}
            {row.last_message_preview || "No preview available"}
          </p>
          <p className="mt-1 text-[10.5px] text-[var(--color-text-4)]">{channelLabel}</p>
        </div>
        <StatusPill status={row.status} />
        <div className="text-[11.5px] text-[var(--color-text-3)]">
          <p className="tabular-nums">{relativeWhen(row.last_activity_at)}</p>
          <p className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-[var(--color-text-4)]">
            <Icon name="forum" size={11} /> {row.message_count}
          </p>
        </div>
      </Link>
    </li>
  );
}

function StatusPill({ status }: { status: string }) {
  const label = statusLabel(status);
  const emphasized = status === "awaiting_us" || status === "closed_positive";
  return (
    <span className={`w-fit rounded-[4px] px-2 py-1 text-[10.5px] font-semibold ${
      emphasized
        ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
        : "bg-[var(--color-ink-2)] text-[var(--color-text-3)]"
    }`}>
      {label}
    </span>
  );
}

function ConversationResultsSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading conversations</p>
      <div className="dashboard-loader-skeleton h-16 rounded-[8px]" />
      <div className="overflow-hidden rounded-[8px] border border-[var(--color-line-1)]">
        <ConversationHeader />
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="grid gap-5 border-t border-[var(--color-line-1)] px-4 py-4 md:grid-cols-[minmax(180px,.9fr)_minmax(300px,1.7fr)_140px_100px]">
            {[0, 1, 2, 3].map((cell) => <div key={cell} className="dashboard-loader-skeleton h-10" />)}
          </div>
        ))}
      </div>
    </div>
  );
}

function parseFilters(params: Record<string, string | string[] | undefined>): ConversationFilters {
  return {
    q: single(params.q).trim(),
    status: single(params.status) || null,
    channel: single(params.channel) || null,
  };
}

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function hasFilters(filters: ConversationFilters): boolean {
  return Boolean(filters.q || filters.status || filters.channel);
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    open: "Open",
    awaiting_them: "Waiting for reply",
    awaiting_us: "Needs reply",
    paused: "Paused",
    closed_positive: "Won",
    closed_negative: "Closed",
    closed_no_response: "No response",
  };
  return labels[status] ?? status.replace(/_/g, " ");
}

function channelPretty(channel: string): string {
  if (channel === "email") return "Outlook";
  if (channel === "linkedin_dm") return "LinkedIn DM";
  if (channel === "linkedin_inmail") return "LinkedIn InMail";
  return channel.replace(/_/g, " ");
}

function FilteredEmpty() {
  return (
    <div className="rounded-[8px] border border-dashed border-[var(--color-line-2)] px-5 py-12 text-center">
      <p className="text-[14px] font-medium text-[var(--color-text-1)]">No conversations match these filters</p>
      <Link href="/dashboard/conversations" className="mt-2 inline-block text-[12px] text-[var(--color-accent)] hover:underline">Clear filters</Link>
    </div>
  );
}

function ConvEmpty() {
  return (
    <EmptyState
      title="No conversations yet"
      hint="Once outreach lands, threads across Outlook and LinkedIn will show up here."
      cta={{ href: "/dashboard/outreach", label: "Open outreach", icon: "send" }}
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
  return `${Math.floor(hrs / 24)}d ago`;
}

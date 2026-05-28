import {
  EmptyState,
  MetricCard,
  SectionHeader,
} from "@/components/dashboard/Shell";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

interface VolumeRow {
  sent_24h: number;
  delivered_24h: number;
  bounced_24h: number;
  complaints_24h: number;
}

interface SendingDomainRow {
  id: string;
  domain: string;
  warmup_state: string;
  warmup_day: number;
  current_daily_cap: number;
  target_daily_cap: number;
  bounce_rate_24h: string;
  complaint_rate_24h: string;
  spf_verified: boolean;
  dkim_verified: boolean;
  dmarc_verified: boolean;
  updated_at: Date;
}

interface ChannelAccountRow {
  id: string;
  kind: string;
  display_name: string;
  status: string;
  daily_cap: number | null;
  daily_used: number;
  last_used_at: Date | null;
  last_error: { message?: string } | null;
}

interface RecentBounceRow {
  external_id: string;
  bounce_type: string;
  bounce_recipient: string;
  occurred_at: Date;
}

async function loadVolume(workspaceId: string): Promise<VolumeRow> {
  const pool = getPool();
  const { rows } = await pool.query<{
    sent_24h: string;
    delivered_24h: string;
    bounced_24h: string;
    complaints_24h: string;
  }>(
    `select
       (select count(*)::text from messages
         where workspace_id = $1 and direction = 'outbound' and channel = 'email'
           and status in ('sent','delivered','replied')
           and sent_at >= now() - interval '24 hours') as sent_24h,
       (select count(*)::text from messages
         where workspace_id = $1 and direction = 'outbound' and channel = 'email'
           and status = 'delivered'
           and sent_at >= now() - interval '24 hours') as delivered_24h,
       (select count(*)::text from messages
         where workspace_id = $1 and direction = 'outbound' and channel = 'email'
           and status = 'bounced'
           and sent_at >= now() - interval '24 hours') as bounced_24h,
       (select count(*)::text from messages
         where workspace_id = $1 and direction = 'outbound' and channel = 'email'
           and eval_notes->>'bounce_type' = 'complaint'
           and sent_at >= now() - interval '24 hours') as complaints_24h`,
    [workspaceId],
  );
  return {
    sent_24h: Number(rows[0].sent_24h),
    delivered_24h: Number(rows[0].delivered_24h),
    bounced_24h: Number(rows[0].bounced_24h),
    complaints_24h: Number(rows[0].complaints_24h),
  };
}

async function loadSendingDomains(workspaceId: string): Promise<SendingDomainRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<SendingDomainRow>(
    `select id, domain, warmup_state::text as warmup_state,
            warmup_day, current_daily_cap, target_daily_cap,
            bounce_rate_24h::text as bounce_rate_24h,
            complaint_rate_24h::text as complaint_rate_24h,
            spf_verified, dkim_verified, dmarc_verified, updated_at
       from sending_domains
      where workspace_id = $1
      order by warmup_state, domain`,
    [workspaceId],
  );
  return rows;
}

async function loadChannelAccounts(workspaceId: string): Promise<ChannelAccountRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<ChannelAccountRow>(
    `select id, kind::text as kind, display_name, status::text as status,
            daily_cap, daily_used, last_used_at, last_error
       from channel_accounts
      where workspace_id = $1
        and kind in ('email_oauth','email_domain')
      order by status, kind, display_name`,
    [workspaceId],
  );
  return rows;
}

async function loadRecentBounces(workspaceId: string): Promise<RecentBounceRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<RecentBounceRow>(
    `select external_id,
            eval_notes->>'bounce_type'      as bounce_type,
            eval_notes->>'bounce_recipient' as bounce_recipient,
            sent_at                          as occurred_at
       from messages
      where workspace_id = $1
        and status = 'bounced'
        and sent_at >= now() - interval '7 days'
      order by sent_at desc
      limit 20`,
    [workspaceId],
  );
  return rows;
}

function timeAgo(d: Date | null): string {
  if (!d) return "never";
  const diff = Date.now() - new Date(d).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function warmupCls(state: string): string {
  switch (state) {
    case "warmed":
      return "bg-[var(--color-accent-bg)] text-[var(--color-accent)]";
    case "warming":
    case "verifying":
      return "bg-[var(--color-ink-3)] text-[var(--color-text-2)]";
    case "degraded":
    case "frozen":
      return "bg-[var(--color-accent-bg)] text-[var(--color-accent)]";
    default:
      return "bg-[var(--color-ink-3)] text-[var(--color-text-3)]";
  }
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export default async function DeliverabilityPage() {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return (
      <>
        <SectionHeader
          eyebrow="deliverability"
          title="No workspace"
          subtitle="Active workspace required to inspect sender reputation."
        />
      </>
    );
  }

  const [volume, domains, accounts, bounces] = await Promise.all([
    loadVolume(workspace.id),
    loadSendingDomains(workspace.id),
    loadChannelAccounts(workspace.id),
    loadRecentBounces(workspace.id),
  ]);

  return (
    <>
      <SectionHeader
        eyebrow="deliverability"
        title="Sender reputation"
        subtitle="Per-domain warmup curves, bounce + complaint rates, connected user inboxes. The thing that protects you from getting your sending blocklisted."
      />

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
        <MetricCard
          label="Sent"
          value={volume.sent_24h}
          hint="last 24h"
        />
        <MetricCard
          label="Delivered"
          value={volume.delivered_24h}
          hint={pct(volume.delivered_24h, volume.sent_24h)}
        />
        <MetricCard
          label="Bounced"
          value={volume.bounced_24h}
          hint={pct(volume.bounced_24h, volume.sent_24h)}
        />
        <MetricCard
          label="Complaints"
          value={volume.complaints_24h}
          hint={pct(volume.complaints_24h, volume.sent_24h)}
        />
      </section>

      <section className="mb-10">
        <h2 className="font-serif text-xl text-[var(--color-text-1)] mb-3">
          Owned sending domains
        </h2>
        {domains.length === 0 ? (
          <EmptyState
            title="No sending domains configured"
            hint="Add a workspace-owned domain to start sending cold email at volume without using personal inboxes."
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line-1)] border border-[var(--color-line-1)] rounded-lg overflow-hidden bg-[var(--color-ink-0)]">
            {domains.map((d) => (
              <li key={d.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <p className="font-sans text-sm text-[var(--color-text-1)] flex-1 truncate">
                    {d.domain}
                  </p>
                  <span
                    className={
                      "font-mono text-[10px] uppercase tracking-[0.16em] px-2 py-1 rounded " +
                      warmupCls(d.warmup_state)
                    }
                  >
                    {d.warmup_state}
                  </span>
                  <span className="font-mono text-xs text-[var(--color-text-3)] tabular-nums w-32 text-right">
                    day {d.warmup_day} · {d.current_daily_cap}/{d.target_daily_cap}
                  </span>
                  <span className="font-mono text-xs text-[var(--color-text-3)] tabular-nums w-20 text-right">
                    {timeAgo(d.updated_at)}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--color-text-3)]">
                  <span className={d.spf_verified ? "text-[var(--color-accent)]" : "text-[var(--color-text-4)]"}>
                    {d.spf_verified ? "spf ok" : "spf ✗"}
                  </span>
                  <span className={d.dkim_verified ? "text-[var(--color-accent)]" : "text-[var(--color-text-4)]"}>
                    {d.dkim_verified ? "dkim ok" : "dkim ✗"}
                  </span>
                  <span className={d.dmarc_verified ? "text-[var(--color-accent)]" : "text-[var(--color-text-4)]"}>
                    {d.dmarc_verified ? "dmarc ok" : "dmarc ✗"}
                  </span>
                  <span className="ml-auto tabular-nums">
                    bounce {(Number(d.bounce_rate_24h) * 100).toFixed(2)}%
                  </span>
                  <span className="tabular-nums">
                    complaints {(Number(d.complaint_rate_24h) * 100).toFixed(2)}%
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-10">
        <h2 className="font-serif text-xl text-[var(--color-text-1)] mb-3">
          Channel accounts
        </h2>
        {accounts.length === 0 ? (
          <EmptyState
            title="No channel accounts connected"
            hint="OAuth an Outlook account or add an owned SES domain to start sending."
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line-1)] border border-[var(--color-line-1)] rounded-lg overflow-hidden bg-[var(--color-ink-0)]">
            {accounts.map((a) => (
              <li key={a.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-3)] w-32 truncate">
                    {a.kind.replace(/_/g, " ")}
                  </span>
                  <p className="font-sans text-sm text-[var(--color-text-1)] flex-1 truncate">
                    {a.display_name}
                  </p>
                  <span
                    className={
                      "font-mono text-[10px] uppercase tracking-[0.16em] px-2 py-1 rounded " +
                      (a.status === "connected"
                        ? "bg-[var(--color-accent-bg)] text-[var(--color-accent)]"
                        : "bg-[var(--color-ink-3)] text-[var(--color-text-3)]")
                    }
                  >
                    {a.status}
                  </span>
                  <span className="font-mono text-xs text-[var(--color-text-3)] tabular-nums w-24 text-right">
                    {a.daily_used}/{a.daily_cap ?? "∞"}
                  </span>
                  <span className="font-mono text-xs text-[var(--color-text-3)] tabular-nums w-20 text-right">
                    {timeAgo(a.last_used_at)}
                  </span>
                </div>
                {a.last_error?.message ? (
                  <p className="font-mono text-xs text-[var(--color-accent)] mt-1 truncate">
                    error: {a.last_error.message}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-serif text-xl text-[var(--color-text-1)] mb-3">
          Recent bounces
        </h2>
        {bounces.length === 0 ? (
          <EmptyState
            title="No bounces in the last 7 days"
            hint="Bounces and complaints surface here so you can spot a deliverability dip before it becomes a freeze."
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line-1)] border border-[var(--color-line-1)] rounded-lg overflow-hidden bg-[var(--color-ink-0)]">
            {bounces.map((b) => (
              <li key={b.external_id} className="px-4 py-3 flex items-center gap-3">
                <span
                  className={
                    "font-mono text-[10px] uppercase tracking-[0.16em] px-2 py-1 rounded " +
                    (b.bounce_type === "complaint" || b.bounce_type === "hard"
                      ? "bg-[var(--color-accent-bg)] text-[var(--color-accent)]"
                      : "bg-[var(--color-ink-3)] text-[var(--color-text-3)]")
                  }
                >
                  {b.bounce_type ?? "bounced"}
                </span>
                <p className="font-sans text-sm text-[var(--color-text-1)] flex-1 truncate">
                  {b.bounce_recipient ?? "(unknown recipient)"}
                </p>
                <span className="font-mono text-xs text-[var(--color-text-3)] tabular-nums w-20 text-right">
                  {timeAgo(b.occurred_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

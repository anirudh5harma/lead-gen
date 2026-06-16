import { redirect } from "next/navigation";
import Link from "next/link";
import { EmptyState } from "@/components/dashboard/Shell";
import Icon from "@/components/Icon";
import type { ReactNode } from "react";
import { getPool } from "@/core/substrate/storage/index.ts";
import { canUseWorkspaceOps, getActiveWorkspaceSession } from "@/lib/workspace";

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
        and kind in ('oauth_outlook','email_domain')
      order by status,
               case when kind = 'oauth_outlook' then 0 else 1 end,
               display_name`,
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
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export default async function DeliverabilityPage() {
  const session = await getActiveWorkspaceSession();
  if (!session) return <CanvasEmpty label="Sending health" title="No workspace selected." />;
  if (!canUseWorkspaceOps(session)) redirect("/dashboard");

  const [volume, domains, accounts, bounces] = await Promise.all([
    loadVolume(session.workspace.id),
    loadSendingDomains(session.workspace.id),
    loadChannelAccounts(session.workspace.id),
    loadRecentBounces(session.workspace.id),
  ]);

  return (
    <>
      <section className="section-canvas min-h-[380px] p-5 sm:p-8">
        <div className="section-thread section-thread-a" />
        <div className="grid gap-8 lg:grid-cols-[1fr_360px] lg:items-end">
          <div>
            <p className="brief-kicker">Sending health</p>
            <h1 className="mt-4 max-w-3xl text-[38px] font-semibold leading-[1.04] tracking-[0] text-[var(--color-text-1)] sm:text-[58px]">
              Sending health that stays calm.
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--color-text-2)]">
              Outreach should stay quiet, steady, and protected. Problems surface only when volume, bounces, or sender health need attention.
            </p>
          </div>
          <div className="section-note">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">Last 24 hours</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <HealthStat label="Sent" value={volume.sent_24h} />
              <HealthStat label="Delivered" value={pct(volume.delivered_24h, volume.sent_24h)} />
              <HealthStat label="Bounced" value={pct(volume.bounced_24h, volume.sent_24h)} />
              <HealthStat label="Complaints" value={pct(volume.complaints_24h, volume.sent_24h)} />
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <HealthPanel title="Owned senders" icon="alternate_email">
          {domains.length === 0 ? (
            <EmptyState
              title="No owned senders yet"
              hint="Add one when the workspace is ready for more outreach volume."
            />
          ) : (
            <div className="grid gap-2">
              {domains.map((domain) => (
                <DomainRow key={domain.id} domain={domain} />
              ))}
            </div>
          )}
        </HealthPanel>

        <HealthPanel title="Connected inboxes" icon="mail">
          <div className="mb-3">
            <Link
              href="/api/auth/outlook"
              prefetch={false}
              className="inline-flex min-h-9 items-center gap-2 rounded-[8px] bg-[var(--color-text-1)] px-3 text-sm font-semibold text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-accent)]"
            >
              <Icon name="mail" size={15} />
              {accounts.length === 0 ? "Connect Outlook" : "Add Outlook"}
            </Link>
          </div>
          {accounts.length === 0 ? (
            <EmptyState
              title="No sending accounts connected"
              hint="Connect Outlook to send from the user's own Microsoft 365 mailbox."
            />
          ) : (
            <div className="grid gap-2">
              {accounts.map((account) => (
                <AccountRow key={account.id} account={account} />
              ))}
            </div>
          )}
        </HealthPanel>
      </section>

      <section className="mt-6">
        <HealthPanel title="Recent bounces" icon="warning">
          {bounces.length === 0 ? (
            <EmptyState
              title="No bounces in the last 7 days"
              hint="Bounce patterns will appear here before they become a freeze."
            />
          ) : (
            <div className="grid gap-2">
              {bounces.map((bounce) => (
                <div key={bounce.external_id} className="grid gap-2 rounded-[12px] bg-[rgba(20,18,13,0.78)] p-3 sm:grid-cols-[120px_1fr_80px] sm:items-center">
                  <span className="rounded-full bg-[var(--color-accent-bg)] px-2 py-1 text-xs text-[var(--color-accent)]">
                    {bounce.bounce_type ?? "bounced"}
                  </span>
                  <p className="truncate text-sm text-[var(--color-text-1)]">
                    {bounce.bounce_recipient ?? "(unknown recipient)"}
                  </p>
                  <span className="text-xs tabular-nums text-[var(--color-text-3)] sm:text-right">
                    {timeAgo(bounce.occurred_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </HealthPanel>
      </section>
    </>
  );
}

function HealthPanel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: string;
  children: ReactNode;
}) {
  return (
    <section className="section-note">
      <div className="mb-4 flex items-center gap-3">
        <span className="brief-note-icon">
          <Icon name={icon} size={18} />
        </span>
        <h2 className="text-lg font-semibold text-[var(--color-text-1)]">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function DomainRow({ domain }: { domain: SendingDomainRow }) {
  return (
    <div className="rounded-[12px] bg-[rgba(20,18,13,0.78)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-text-1)]">
          {domain.domain}
        </p>
        <span className="rounded-full bg-[var(--color-ink-2)] px-2 py-1 text-xs text-[var(--color-text-2)]">
          {sendingStateLabel(domain.warmup_state)}
        </span>
      </div>
      <p className="mt-2 text-xs text-[var(--color-text-3)]">
        Day {domain.warmup_day}. {domain.current_daily_cap}/{domain.target_daily_cap} daily. Updated {timeAgo(domain.updated_at)}.
      </p>
      <p className="mt-2 text-xs text-[var(--color-text-3)]">
        Setup {verifiedCount(domain)}/3 ready.
      </p>
      <p className="mt-2 text-xs text-[var(--color-text-3)]">
        Bounce {(Number(domain.bounce_rate_24h) * 100).toFixed(2)}%. Complaints {(Number(domain.complaint_rate_24h) * 100).toFixed(2)}%.
      </p>
    </div>
  );
}

function AccountRow({ account }: { account: ChannelAccountRow }) {
  return (
    <div className="rounded-[12px] bg-[rgba(20,18,13,0.78)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-text-1)]">
          {account.display_name}
        </p>
        <span className="rounded-full bg-[var(--color-accent-bg)] px-2 py-1 text-xs text-[var(--color-accent)]">
          {sendingStateLabel(account.status)}
        </span>
      </div>
      <p className="mt-2 text-xs text-[var(--color-text-3)]">
        {accountKindLabel(account.kind)}. {account.daily_used}/{account.daily_cap ?? "unlimited"} today. Last used {timeAgo(account.last_used_at)}.
      </p>
      {account.last_error?.message ? (
        <p className="mt-2 text-xs text-[var(--color-neg)]">{account.last_error.message}</p>
      ) : null}
    </div>
  );
}

function sendingStateLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function accountKindLabel(value: string): string {
  if (value === "oauth_outlook") return "Outlook inbox";
  if (value === "email_domain") return "Owned sender";
  return sendingStateLabel(value);
}

function verifiedCount(domain: SendingDomainRow): number {
  return [domain.spf_verified, domain.dkim_verified, domain.dmarc_verified].filter(Boolean).length;
}

function HealthStat({ label, value }: { label: string; value: number | string }) {
  return (
    <span className="rounded-[10px] border border-[var(--color-line-1)] bg-[rgba(20,18,13,0.60)] p-3">
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

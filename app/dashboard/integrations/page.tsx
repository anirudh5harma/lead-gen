import type { Metadata } from "next";
import Link from "next/link";
import Icon from "@/components/Icon";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSessionForDashboard } from "@/lib/workspace";

export const metadata: Metadata = { title: "Integrations | Bombsell" };
export const dynamic = "force-dynamic";

interface ChannelRow {
  kind: string;
  display_name: string | null;
  status: string;
  last_error: string | null;
}

async function loadChannels(workspaceId: string): Promise<ChannelRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<ChannelRow>(
    `select kind::text as kind,
            display_name,
            status::text as status,
            last_error
       from channel_accounts
      where workspace_id = $1
        and kind in ('oauth_outlook','linkedin_session','linkedin_oauth')
      order by case when status = 'connected' then 0 else 1 end,
               created_at desc`,
    [workspaceId],
  );
  return rows;
}

export default async function IntegrationsPage() {
  const session = await getActiveWorkspaceSessionForDashboard("integrations");
  const channels = session
    ? await loadChannels(session.workspace.id).catch(() => [] as ChannelRow[])
    : ([] as ChannelRow[]);
  const outlook = channels.find((c) => c.kind === "oauth_outlook");
  const linkedin = channels.find(
    (c) => c.kind === "linkedin_session" || c.kind === "linkedin_oauth",
  );

  return (
    <div className="space-y-8">
      <header>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-accent)]">
          Integrations
        </p>
        <h1
          className="mt-3 text-[clamp(2rem,4vw,3rem)] font-bold leading-[1.05] tracking-[-0.02em] text-[var(--color-text-1)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Connections
        </h1>
        <p className="mt-2 max-w-[68ch] text-[15px] leading-6 text-[var(--color-text-3)]">
          Connect outreach accounts, CRM destinations, and the MCP server that
          lets Claude or Codex drive Bombsell from your own harness.
        </p>
      </header>

      <Section title="Outreach channels">
        <IntegrationCard
          icon="mail"
          title="Outlook / Microsoft 365"
          description="Connect the mailbox you want to send from. Native threading, reply sync, per-account daily caps."
          status={statusOf(outlook)}
          statusLabel={labelFor(outlook)}
          errorHint={outlook?.last_error ?? null}
          action={{
            href: "/api/auth/outlook?return_to=%2Fdashboard%2Fintegrations",
            label: outlook?.status === "connected" ? "Reconnect" : "Connect Outlook",
          }}
        />
        <IntegrationCard
          icon="linkedin"
          title="LinkedIn"
          description="Send DMs and InMails from your own profile. Rate-limited per account to stay safe."
          status="soon"
          statusLabel="Coming soon"
          errorHint={linkedin?.last_error ?? null}
          action={null}
        />
      </Section>

      <Section title="Destinations">
        <IntegrationCard
          icon="account_tree"
          title="CRM (HubSpot, Salesforce, Pipedrive)"
          description="Push matched leads and conversations to your CRM as they progress."
          status="soon"
          statusLabel="Coming soon"
          action={null}
        />
        <IntegrationCard
          icon="forum"
          title="Slack"
          description="Get pinged when a lead replies or a meeting is booked."
          status="soon"
          statusLabel="Coming soon"
          action={null}
        />
      </Section>

      <Section title="MCP for Claude / Codex">
        <McpCard />
      </Section>
    </div>
  );
}

type StatusTone = "connected" | "attention" | "off" | "soon";

function statusOf(row: ChannelRow | undefined): StatusTone {
  if (!row) return "off";
  if (row.status === "connected" && !row.last_error) return "connected";
  if (row.status === "connected" && row.last_error) return "attention";
  return "attention";
}

function labelFor(row: ChannelRow | undefined): string {
  if (!row) return "Not connected";
  if (row.status === "connected" && !row.last_error) return "Connected";
  return row.status.replace(/_/g, " ");
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-3)]">
        {title}
      </h2>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function IntegrationCard({
  icon,
  title,
  description,
  status,
  statusLabel,
  errorHint,
  action,
}: {
  icon: string;
  title: string;
  description: string;
  status: StatusTone;
  statusLabel: string;
  errorHint?: string | null;
  action: { href: string; label: string } | null;
}) {
  const dot: Record<StatusTone, string> = {
    connected: "bg-emerald-500",
    attention: "bg-amber-500",
    off: "bg-[var(--color-text-4)]",
    soon: "bg-[var(--color-text-4)]",
  };
  return (
    <div className="grid gap-3 rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
      <span className="grid size-11 place-items-center rounded-[10px] bg-[var(--color-ink-2)] text-[var(--color-text-2)] ring-1 ring-[var(--color-line-1)]">
        <Icon name={icon} size={20} />
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-[15px] font-semibold text-[var(--color-text-1)]">
          {title}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-ink-2)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-2)] ring-1 ring-[var(--color-line-1)]">
            <span className={`size-1.5 rounded-full ${dot[status]}`} />
            {statusLabel}
          </span>
        </p>
        <p className="mt-1 text-[13px] leading-5 text-[var(--color-text-3)]">
          {description}
        </p>
        {errorHint ? (
          <p className="mt-1.5 text-[12px] leading-4 text-amber-600">
            {errorHint}
          </p>
        ) : null}
      </div>
      {action ? (
        <Link href={action.href} className="btn-solid-sm shrink-0">
          <Icon name="arrow_forward" size={12} />
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

function McpCard() {
  const mcpUrl = "https://www.bombsell.com/api/mcp";
  return (
    <div className="rounded-[16px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-11 place-items-center rounded-[10px] bg-[var(--color-brand-blue)] text-[#0a0d27]">
          <Icon name="webhook" size={20} />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-[var(--color-text-1)]">
            Drive Bombsell from Claude or Codex
          </p>
          <p className="mt-1 text-[13px] leading-5 text-[var(--color-text-3)]">
            Everything the dashboard does is exposed as MCP tools. Paste this
            into your Claude Desktop or Codex config; auth uses your Bombsell
            OAuth.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <McpBlock
          label="Claude Desktop / Code (~/.config/claude-desktop/config.json)"
          code={JSON.stringify(
            {
              mcpServers: {
                bombsell: {
                  url: mcpUrl,
                  transport: "http",
                },
              },
            },
            null,
            2,
          )}
        />
        <McpBlock
          label="Codex (~/.codex/mcp.json)"
          code={JSON.stringify(
            {
              servers: {
                bombsell: {
                  url: mcpUrl,
                  auth: "oauth",
                },
              },
            },
            null,
            2,
          )}
        />
      </div>

      <ol className="mt-4 list-decimal space-y-1 pl-5 text-[13px] leading-5 text-[var(--color-text-2)]">
        <li>Paste the snippet into your harness config.</li>
        <li>Restart Claude Desktop or Codex.</li>
        <li>
          The first tool call opens a browser tab; sign in with the same account
          you use here.
        </li>
        <li>
          Try <code className="rounded bg-[var(--color-ink-2)] px-1.5 py-0.5 text-[12px]">bombsell.signal.list</code>{" "}
          to confirm.
        </li>
      </ol>
    </div>
  );
}

function McpBlock({ label, code }: { label: string; code: string }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-3)]">
        {label}
      </p>
      <pre className="overflow-x-auto rounded-[10px] bg-[var(--color-ink-2)] p-3 text-[12px] leading-5 text-[var(--color-text-1)] ring-1 ring-[var(--color-line-1)]">
        {code}
      </pre>
    </div>
  );
}

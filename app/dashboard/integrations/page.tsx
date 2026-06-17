import Link from "next/link";
import { EmptyState } from "@/components/dashboard/Shell";
import {
  HeroStat,
  SurfaceHero,
  SurfaceSection,
} from "@/components/dashboard/SurfaceHero";
import Icon from "@/components/Icon";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSession } from "@/lib/workspace";

export const dynamic = "force-dynamic";

interface IntegrationAccountRow {
  id: string;
  display_name: string;
  kind: string;
  status: string;
  daily_cap: number | null;
  last_error: string | null;
  properties: Record<string, unknown> | null;
  updated_at: Date;
}

interface IntegrationsState {
  accounts: IntegrationAccountRow[];
}

async function loadIntegrationsState(
  workspaceId: string,
): Promise<IntegrationsState> {
  const pool = getPool();
  const { rows } = await pool.query<IntegrationAccountRow>(
    `with ranked_accounts as (
       select id,
              display_name,
              kind::text as kind,
              status::text as status,
              daily_cap,
              last_error,
              properties,
              updated_at,
              created_at,
              row_number() over (
                partition by case
                  when kind = 'oauth_outlook' then 'outlook:' || coalesce(
                    nullif(lower(properties ->> 'mailbox_email'), ''),
                    nullif(lower(display_name), ''),
                    id::text
                  )
                  when kind in ('linkedin_session','linkedin_oauth') then 'linkedin:' || coalesce(
                    nullif(lower(display_name), ''),
                    id::text
                  )
                  else kind::text || ':' || id::text
                end
                order by case when status = 'connected' then 0 else 1 end,
                         updated_at desc,
                         created_at desc
              ) as account_rank
         from channel_accounts
        where workspace_id = $1
          and kind in ('oauth_outlook','linkedin_session','linkedin_oauth','email_domain')
     )
     select id, display_name, kind, status, daily_cap, last_error, properties, updated_at
       from ranked_accounts
      where account_rank = 1
      order by case
                 when kind = 'oauth_outlook' then 0
                 when kind in ('linkedin_session','linkedin_oauth') then 1
                 when kind = 'email_domain' then 2
                 else 3
               end,
               display_name asc`,
    [workspaceId],
  );
  return { accounts: rows };
}

export default async function IntegrationsPage() {
  const active = await getActiveWorkspaceSession();
  if (!active) {
    return (
      <div className="space-y-10">
        <SurfaceHero
          kicker="Profile"
          title="Create a workspace."
          description="Connected email, LinkedIn, and external-agent tools attach to the active workspace."
        />
        <EmptyState
          title="No workspace selected."
          hint="Create a workspace before connecting outbound accounts."
          cta={{
            href: "/dashboard/settings#profile",
            label: "Start setup",
            icon: "add_business",
          }}
        />
      </div>
    );
  }

  const state = await loadIntegrationsState(active.workspace.id);
  const outlookAccount = state.accounts.find(
    (account) => account.kind === "oauth_outlook",
  );
  const linkedInAccount = state.accounts.find((account) =>
    isLinkedInKind(account.kind),
  );
  const ownedSenders = state.accounts.filter(
    (account) => account.kind === "email_domain",
  );
  const connectedCount = state.accounts.filter(
    (account) => account.status === "connected",
  ).length;

  return (
    <div className="space-y-10">
      <SurfaceHero
        kicker="Profile"
        title={
          <>
            Connect the accounts your agent can <em>use</em>.
          </>
        }
        description="Email, LinkedIn, owned-domain capacity, and MCP live inside the workspace profile. The agent inherits these accounts plus their daily caps and health."
        meta={
          <div className="flex flex-wrap gap-2">
            <HeroStat label="Connected" value={connectedCount} />
            <HeroStat
              label="Email"
              value={outlookAccount ? statusLabel(outlookAccount.status) : "Needed"}
            />
            <HeroStat
              label="LinkedIn"
              value={linkedInAccount ? statusLabel(linkedInAccount.status) : "Needed"}
            />
          </div>
        }
      />

      <SurfaceSection title="Channel accounts">
        <div className="grid gap-3">
          <ConnectCard
            account={outlookAccount}
            title="Outlook inbox"
            description="Connect Microsoft 365 for native sending, reply sync, and thread-aware outreach."
            href="/api/auth/outlook?return_to=/dashboard/integrations"
            icon="mail"
            connectLabel="Connect Outlook"
            reconnectLabel="Reconnect Outlook"
          />
          <ConnectCard
            account={linkedInAccount}
            title="LinkedIn account"
            description="Connect LinkedIn for connection requests, DMs, and warm engagement before outreach."
            href="/api/auth/linkedin?return_to=/dashboard/integrations"
            icon="forum"
            connectLabel="Connect LinkedIn"
            reconnectLabel="Reconnect LinkedIn"
          />
        </div>
      </SurfaceSection>

      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-12">
        <SurfaceSection title="Owned sending">
          {ownedSenders.length === 0 ? (
            <div className="section-note">
              <p className="text-sm font-semibold text-[var(--color-text-1)]">
                No owned-domain sender configured.
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--color-text-3)]">
                Connected Outlook is the launch path. Owned-domain capacity can
                be added when volume needs warmup and deliverability controls.
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {ownedSenders.map((account) => (
                <AccountRow key={account.id} account={account} />
              ))}
            </div>
          )}
        </SurfaceSection>

        <SurfaceSection title="External agents">
          <div className="section-note grid gap-4">
            <span className="brief-note-icon">
              <Icon name="account_tree" size={18} />
            </span>
            <div>
              <p className="text-sm font-semibold text-[var(--color-text-1)]">
                MCP endpoint
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--color-text-3)]">
                External agents can use the same workspace tools as this
                workspace agent.
              </p>
            </div>
            <div className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2 font-mono text-xs text-[var(--color-text-2)]">
              /api/mcp
            </div>
            <Link href="/api/mcp" prefetch={false} className="btn-quiet-sm w-fit">
              <Icon name="arrow_forward" size={14} />
              Open endpoint
            </Link>
          </div>
        </SurfaceSection>
      </section>
    </div>
  );
}

function ConnectCard({
  account,
  title,
  description,
  href,
  icon,
  connectLabel,
  reconnectLabel,
}: {
  account: IntegrationAccountRow | undefined;
  title: string;
  description: string;
  href: string;
  icon: string;
  connectLabel: string;
  reconnectLabel: string;
}) {
  return (
    <article className="grid gap-4 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-5 md:grid-cols-[1fr_auto] md:items-center">
      <div className="flex min-w-0 gap-3">
        <span className="brief-note-icon shrink-0">
          <Icon
            name={account?.status === "connected" ? icon : "sync_problem"}
            size={18}
          />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--color-text-1)]">
            {account ? accountDisplayName(account) : title}
          </p>
          <p className="mt-1 text-sm leading-6 text-[var(--color-text-3)]">
            {account ? accountSummary(account) : description}
          </p>
          {account?.last_error ? (
            <p className="mt-2 text-sm text-[#ffb4a8]">{account.last_error}</p>
          ) : null}
        </div>
      </div>
      <Link href={href} prefetch={false} className="btn-solid w-fit">
        <Icon name={icon} size={16} />
        {account ? reconnectLabel : connectLabel}
      </Link>
    </article>
  );
}

function AccountRow({ account }: { account: IntegrationAccountRow }) {
  return (
    <article className="grid gap-4 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
      <div className="flex min-w-0 gap-3">
        <span className="brief-note-icon shrink-0">
          <Icon name="mail" size={18} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--color-text-1)]">
            {accountDisplayName(account)}
          </p>
          <p className="mt-1 text-sm leading-6 text-[var(--color-text-3)]">
            {accountSummary(account)}
          </p>
        </div>
      </div>
    </article>
  );
}

function accountDisplayName(account: IntegrationAccountRow): string {
  if (account.kind === "oauth_outlook") {
    const mailbox = account.properties?.mailbox_email;
    if (typeof mailbox === "string" && mailbox.trim()) return mailbox;
  }
  return account.display_name;
}

function accountSummary(account: IntegrationAccountRow): string {
  return `${kindLabel(account.kind)} - ${statusLabel(account.status)} - ${
    account.daily_cap ?? "unlimited"
  } daily ceiling`;
}

function isLinkedInKind(kind: string): boolean {
  return kind === "linkedin_session" || kind === "linkedin_oauth";
}

function kindLabel(kind: string): string {
  if (kind === "oauth_outlook") return "Outlook inbox";
  if (kind === "linkedin_session") return "LinkedIn session";
  if (kind === "linkedin_oauth") return "LinkedIn account";
  if (kind === "email_domain") return "Owned sender";
  return kind.replace(/_/g, " ");
}

function statusLabel(status: string): string {
  if (status === "connected") return "Connected";
  if (status === "needs_reauth") return "Needs reauth";
  return status.replace(/_/g, " ");
}

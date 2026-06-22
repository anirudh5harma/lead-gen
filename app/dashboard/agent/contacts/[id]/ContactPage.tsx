import { notFound } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/dashboard/Shell";
import {
  HeroStat,
  SurfaceHero,
  SurfaceSection,
} from "@/components/dashboard/SurfaceHero";
import Icon from "@/components/Icon";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSessionForDashboard } from "@/lib/workspace";
import FitFeedbackButton from "@/components/dashboard/FitFeedbackButton";
import { recordPersonFitFeedbackAction } from "../../../actions";
import { loadDashboardData } from "../../../server-data";

export const dynamic = "force-dynamic";

interface ContactProfileRow {
  id: string;
  full_name: string;
  title: string | null;
  emails: string[];
  phones: string[];
  linkedin_url: string | null;
  x_handle: string | null;
  properties: Record<string, unknown> | null;
  provenance: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
  company_id: string | null;
  company_name: string | null;
  company_domain: string | null;
  company_industry: string | null;
  company_size_bucket: string | null;
  company_description: string | null;
}

interface ContactSignalRow {
  id: string;
  kind: string;
  title: string;
  content: string | null;
  url: string | null;
  status: string;
  match_score: string | null;
  match_reason: string | null;
  freshness_at: Date;
  ingested_at: Date;
}

interface ContactConversationRow {
  id: string;
  status: string;
  topic: string | null;
  last_activity_at: Date;
  rep_name: string | null;
  signal_title: string | null;
  latest_message_body: string | null;
  latest_message_subject: string | null;
  latest_message_direction: string | null;
  latest_message_status: string | null;
  latest_message_created_at: Date | null;
}

interface ContactOutcomeRow {
  id: string;
  kind: string;
  score: string;
  occurred_at: Date;
  conversation_id: string | null;
}

interface ContactChannelState {
  connected_outlook: number;
  connected_linkedin: number;
}

type ContactFitDecision = "fit" | "unsure" | "not_fit";

interface ContactFitState {
  decision: ContactFitDecision | null;
  note: string | null;
  recorded_at: string | null;
}

interface ContactProfileState {
  contact: ContactProfileRow;
  signals: ContactSignalRow[];
  conversations: ContactConversationRow[];
  outcomes: ContactOutcomeRow[];
  channelState: ContactChannelState;
}

type ContactProfileLoadResult =
  | { status: "found"; state: ContactProfileState }
  | { status: "missing" }
  | { status: "unavailable" };

async function loadContactProfile(
  workspaceId: string,
  contactId: string,
): Promise<ContactProfileState | null> {
  const pool = getPool();
  const contactResult = await pool.query<ContactProfileRow>(
    `select p.id,
            p.full_name,
            p.title,
            coalesce(p.emails, '{}'::text[]) as emails,
            coalesce(p.phones, '{}'::text[]) as phones,
            p.linkedin_url,
            p.x_handle::text as x_handle,
            p.properties,
            p.provenance,
            p.created_at,
            p.updated_at,
            p.company_id,
            co.name as company_name,
            co.domain::text as company_domain,
            co.industry as company_industry,
            co.size_bucket as company_size_bucket,
            co.description as company_description
       from graph_persons p
       left join graph_companies co on co.id = p.company_id
      where p.workspace_id = $1
        and p.id = $2
      limit 1`,
    [workspaceId, contactId],
  );
  const contact = contactResult.rows[0] ?? null;
  if (!contact) return null;

  const [signals, conversations, outcomes, channels] = await Promise.all([
    pool.query<ContactSignalRow>(
      `select s.id,
              s.kind::text as kind,
              s.title,
              s.content,
              s.url,
              s.status::text as status,
              s.match_score::text as match_score,
              s.match_reason,
              s.freshness_at,
              s.ingested_at
         from signals s
        where s.workspace_id = $1
          and s.status in ('ingested','matched','in_play','spent')
          and (
            s.related_person_id = $2
            or ($3::uuid is not null and s.related_company_id = $3::uuid)
          )
        order by s.freshness_at desc, s.ingested_at desc
        limit 12`,
      [workspaceId, contact.id, contact.company_id],
    ),
    pool.query<ContactConversationRow>(
      `select c.id,
              c.status::text as status,
              c.topic,
              c.last_activity_at,
              r.name as rep_name,
              s.title as signal_title,
              lm.body as latest_message_body,
              lm.subject as latest_message_subject,
              lm.direction::text as latest_message_direction,
              lm.status::text as latest_message_status,
              lm.created_at as latest_message_created_at
         from conversations c
         left join reps r on r.id = c.rep_id
         left join signals s on s.id = c.origin_signal_id
         left join lateral (
           select m.body, m.subject, m.direction, m.status, m.created_at
             from messages m
            where m.workspace_id = c.workspace_id
              and m.conversation_id = c.id
            order by m.created_at desc
            limit 1
         ) lm on true
        where c.workspace_id = $1
          and c.counterparty_person_id = $2
        order by c.last_activity_at desc
        limit 10`,
      [workspaceId, contact.id],
    ),
    pool.query<ContactOutcomeRow>(
      `select o.id,
              o.kind::text as kind,
              o.score::text as score,
              o.occurred_at,
              o.conversation_id
         from outcomes o
        where o.workspace_id = $1
          and (
            o.subject_person_id = $2
            or o.conversation_id in (
              select c.id
                from conversations c
               where c.workspace_id = $1
                 and c.counterparty_person_id = $2
            )
          )
        order by o.occurred_at desc
        limit 10`,
      [workspaceId, contact.id],
    ),
    pool.query<{
      connected_outlook: string;
      connected_linkedin: string;
    }>(
      `select
         (select count(*)::text
            from channel_accounts ca
           where ca.workspace_id = $1
             and ca.kind = 'oauth_outlook'
             and ca.status = 'connected') as connected_outlook,
         (select count(*)::text
            from channel_accounts ca
           where ca.workspace_id = $1
             and ca.kind in ('linkedin_session','linkedin_oauth')
             and ca.status = 'connected') as connected_linkedin`,
      [workspaceId],
    ),
  ]);

  return {
    contact,
    signals: signals.rows,
    conversations: conversations.rows,
    outcomes: outcomes.rows,
    channelState: {
      connected_outlook: Number((channels.rows[0] ?? null)?.connected_outlook ?? 0),
      connected_linkedin: Number((channels.rows[0] ?? null)?.connected_linkedin ?? 0),
    },
  };
}

export default async function ContactProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const active = await getActiveWorkspaceSessionForDashboard("agent/contacts");
  const workspace = active?.workspace ?? null;
  if (!workspace) {
    return (
      <SurfaceHero
        kicker="Verified contact"
        title="No workspace selected."
        description="Create a workspace before opening graph-backed contact profiles."
      />
    );
  }

  const loaded = await loadDashboardData<ContactProfileLoadResult>(
    "agent/contacts",
    "contact profile",
    { status: "unavailable" },
    async () => {
      const state = await loadContactProfile(workspace.id, id);
      return state ? { status: "found", state } : { status: "missing" };
    },
  );
  if (loaded.status === "missing") return notFound();
  if (loaded.status === "unavailable") return <UnavailableContactProfile />;

  const { contact, signals, conversations, outcomes, channelState } = loaded.state;
  const company = contact.company_name ?? contact.company_domain ?? "Unknown company";
  const reachable =
    contact.emails.length > 0 ||
    Boolean(contact.linkedin_url) ||
    contact.phones.length > 0;
  const latestSignal = signals[0] ?? null;

  return (
    <div className="space-y-10">
      <SurfaceHero
        kicker="Verified contact"
        title={
          <>
            {contact.full_name} <em>at {company}</em>.
          </>
        }
        description={
          contact.title
            ? `${contact.title}. Timing evidence, channel handles, outreach, replies, and meetings are tied back to this contact.`
            : "Timing evidence, channel handles, outreach, replies, and meetings are tied back to this contact."
        }
        meta={
          <div className="flex flex-wrap gap-2">
            <HeroStat label="Signals" value={signals.length} />
            <HeroStat label="Outreach" value={conversations.length} />
            <HeroStat label="Replies" value={outcomes.length} />
            <HeroStat label="Reachable" value={reachable ? "Yes" : "No"} />
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/dashboard/agent#verified-contacts" className="btn-quiet-sm">
          <Icon name="arrow_back" size={14} />
          Back to contacts
        </Link>
        <Link href="/dashboard/profile#channels" className="btn-solid-sm">
          <Icon name="account_tree" size={14} />
          Connect accounts
        </Link>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ReadinessTile
          icon="mail"
          label="Email"
          value={contact.emails[0] ?? "Missing"}
          ready={contact.emails.length > 0 && channelState.connected_outlook > 0}
          detail={
            contact.emails.length > 0
              ? channelState.connected_outlook > 0
                ? "Mailbox ready"
                : "Connect Outlook"
              : "Needs enrichment"
          }
        />
        <ReadinessTile
          icon="linkedin"
          label="LinkedIn"
          value={contact.linkedin_url ? "Profile found" : "Missing"}
          ready={false}
          detail="Coming soon"
        />
        <ReadinessTile
          icon="add_business"
          label="Company"
          value={company}
          ready={Boolean(contact.company_name || contact.company_domain)}
          detail={contact.company_industry ?? contact.company_size_bucket ?? "Graph context"}
        />
        <ReadinessTile
          icon="sensors"
          label="Timing"
          value={latestSignal ? freshWhen(latestSignal.freshness_at) : "Quiet"}
          ready={latestSignal !== null}
          detail={latestSignal?.kind.replace(/_/g, " ") ?? "No fresh Signal"}
        />
      </section>

      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-12">
        <div className="grid gap-10">
          <SurfaceSection title="Timing evidence">
            {signals.length === 0 ? (
              <EmptyState
                title="No Signals on this profile yet."
                hint="When a source finds timing evidence for this person or company, it will collect here."
                cta={{
                  href: "/dashboard/profile#profile",
                  label: "Update profile",
                  icon: "person",
                }}
              />
            ) : (
              <div className="grid gap-2">
                {signals.map((signal) => (
                  <SignalRow key={signal.id} signal={signal} />
                ))}
              </div>
            )}
          </SurfaceSection>

          <SurfaceSection title="Conversations">
            {conversations.length === 0 ? (
              <EmptyState
                title="No outreach yet."
                hint="When a qualified signal starts email or LinkedIn outreach for this contact, the thread will appear here."
                cta={{
                  href: "/dashboard/agent#outreach",
                  label: "Open Agent",
                  icon: "arrow_forward",
                }}
              />
            ) : (
              <div className="grid gap-2">
                {conversations.map((conversation) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                  />
                ))}
              </div>
            )}
          </SurfaceSection>
        </div>

        <aside className="grid h-fit gap-4">
          <FitFeedbackPanel contact={contact} />
          <ProfilePanel contact={contact} />
          <CompanyPanel contact={contact} />
          <ReplyInsightPanel outcomes={outcomes} />
        </aside>
      </section>
    </div>
  );
}

function UnavailableContactProfile() {
  return (
    <div className="space-y-6">
      <SurfaceHero
        kicker="Verified contact"
        title="Contact temporarily unavailable."
        description="We could not load this graph-backed contact profile just now."
      />
      <EmptyState
        title="Try again in a moment."
        hint="Signals, conversations, channel readiness, and outcomes will reappear after the workspace reconnects."
      />
    </div>
  );
}

function FitFeedbackPanel({ contact }: { contact: ContactProfileRow }) {
  const fit = contactFitState(contact.properties);
  const options: Array<{
    decision: ContactFitDecision;
    label: string;
    icon: string;
    detail: string;
  }> = [
    {
      decision: "fit",
      label: "Good fit",
      icon: "check",
      detail: "Prioritize outreach",
    },
    {
      decision: "unsure",
      label: "Not sure",
      icon: "help",
      detail: "Keep for review",
    },
    {
      decision: "not_fit",
      label: "Not a fit",
      icon: "block",
      detail: "De-prioritize",
    },
  ];
  return (
    <div className="section-note">
      <p className="text-sm font-semibold text-[var(--color-text-1)]">
        Fit feedback
      </p>
      <p className="mt-2 text-sm leading-6 text-[var(--color-text-3)]">
        Tell the agent whether this signal-backed contact should move toward
        email or LinkedIn outreach.
      </p>
      <div className="mt-4 grid gap-2">
        {options.map((option) => (
          <form key={option.decision} action={recordPersonFitFeedbackAction}>
            <input type="hidden" name="person_id" value={contact.id} />
            <input type="hidden" name="decision" value={option.decision} />
            <input
              type="hidden"
              name="return_to"
              value={`/dashboard/agent/contacts/${contact.id}`}
            />
            <FitFeedbackButton
              icon={option.icon}
              active={fit.decision === option.decision}
              detail={option.detail}
            >
              {option.label}
            </FitFeedbackButton>
          </form>
        ))}
      </div>
      {fit.decision ? (
        <p className="mt-3 text-xs leading-5 text-[var(--color-text-3)]">
          Saved as {fitLabel(fit.decision)}
          {fit.recorded_at ? ` ${freshWhen(new Date(fit.recorded_at))}` : ""}.
        </p>
      ) : (
        <p className="mt-3 text-xs leading-5 text-[var(--color-text-3)]">
          No fit feedback recorded yet.
        </p>
      )}
    </div>
  );
}

function ReadinessTile({
  icon,
  label,
  value,
  detail,
  ready,
}: {
  icon: string;
  label: string;
  value: string;
  detail: string;
  ready: boolean;
}) {
  return (
    <div className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-8 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
          <Icon name={icon} size={16} />
        </span>
        <span
          className={
            "rounded-[8px] px-2 py-1 text-[11px] font-medium " +
            (ready
              ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
              : "bg-[var(--color-ink-2)] text-[var(--color-text-3)]")
          }
        >
          {ready ? "Ready" : "Needed"}
        </span>
      </div>
      <strong className="mt-4 block truncate text-[15px] font-semibold text-[var(--color-text-1)]">
        {value}
      </strong>
      <span className="mt-1 block text-xs uppercase tracking-[0] text-[var(--color-text-3)]">
        {label}
      </span>
      <p className="mt-2 text-xs leading-5 text-[var(--color-text-3)]">
        {detail}
      </p>
    </div>
  );
}

function SignalRow({ signal }: { signal: ContactSignalRow }) {
  return (
    <article className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{signal.kind.replace(/_/g, " ")}</Badge>
        <Badge>{signal.status.replace(/_/g, " ")}</Badge>
        {signal.match_score ? (
          <Badge tone="positive">{Math.round(Number(signal.match_score) * 100)}% fit</Badge>
        ) : null}
        <span className="ml-auto text-xs tabular-nums text-[var(--color-text-3)]">
          {freshWhen(signal.freshness_at)}
        </span>
      </div>
      <h2 className="mt-3 text-base font-semibold text-[var(--color-text-1)]">
        {signal.url ? (
          <a href={signal.url} target="_blank" rel="noreferrer" className="hover:text-[var(--color-accent)]">
            {signal.title}
          </a>
        ) : (
          signal.title
        )}
      </h2>
      {signal.match_reason || signal.content ? (
        <p className="mt-2 text-sm leading-6 text-[var(--color-text-3)]">
          {signal.match_reason ?? signal.content}
        </p>
      ) : null}
    </article>
  );
}

function ConversationRow({
  conversation,
}: {
  conversation: ContactConversationRow;
}) {
  return (
    <Link
      href={`/dashboard/agent/outreach/${conversation.id}`}
      prefetch
      className="grid gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)] md:grid-cols-[1fr_auto] md:items-center"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{conversation.status.replace(/_/g, " ")}</Badge>
          {conversation.rep_name ? <Badge>Agent</Badge> : null}
          {conversation.latest_message_status ? (
            <Badge>{conversation.latest_message_status.replace(/_/g, " ")}</Badge>
          ) : null}
        </div>
        <p className="mt-3 truncate text-sm font-semibold text-[var(--color-text-1)]">
          {conversation.topic ?? conversation.signal_title ?? "Conversation"}
        </p>
        <p className="mt-1 truncate text-sm text-[var(--color-text-3)]">
          {conversation.latest_message_subject ??
            conversation.latest_message_body ??
            "No message preview"}
        </p>
      </div>
      <span className="text-xs tabular-nums text-[var(--color-text-3)]">
        {freshWhen(conversation.latest_message_created_at ?? conversation.last_activity_at)}
      </span>
    </Link>
  );
}

function ProfilePanel({ contact }: { contact: ContactProfileRow }) {
  return (
    <div className="section-note">
      <p className="text-sm font-semibold text-[var(--color-text-1)]">
        Channel handles
      </p>
      <div className="mt-4 grid gap-3">
        <Fact label="Email" value={contact.emails[0] ?? "Missing"} icon="mail" />
        <Fact label="LinkedIn" value={contact.linkedin_url ?? "Missing"} icon="linkedin" />
        <Fact label="Phone" value={contact.phones[0] ?? "Missing"} icon="send" />
        <Fact label="X" value={contact.x_handle ?? "Missing"} icon="sync_alt" />
        <Fact
          label="First seen"
          value={new Date(contact.created_at).toLocaleString()}
          icon="person_search"
        />
        <Fact
          label="Last updated"
          value={new Date(contact.updated_at).toLocaleString()}
          icon="sync_alt"
        />
      </div>
      <p className="mt-4 text-xs leading-5 text-[var(--color-text-3)]">
        Contact provenance comes from the graph, signals, and outreach threads.
      </p>
    </div>
  );
}

function CompanyPanel({ contact }: { contact: ContactProfileRow }) {
  return (
    <div className="section-note">
      <p className="text-sm font-semibold text-[var(--color-text-1)]">
        Company context
      </p>
      <div className="mt-4 grid gap-3">
        <Fact label="Company" value={contact.company_name ?? "Unknown"} icon="add_business" />
        <Fact label="Domain" value={contact.company_domain ?? "Missing"} icon="travel_explore" />
        <Fact label="Industry" value={contact.company_industry ?? "Unspecified"} icon="fact_check" />
        <Fact label="Size" value={contact.company_size_bucket ?? "Unknown"} icon="person" />
      </div>
      {contact.company_description ? (
        <p className="mt-4 text-sm leading-6 text-[var(--color-text-3)]">
          {contact.company_description}
        </p>
      ) : null}
    </div>
  );
}

function ReplyInsightPanel({ outcomes }: { outcomes: ContactOutcomeRow[] }) {
  return (
    <div className="section-note">
      <p className="text-sm font-semibold text-[var(--color-text-1)]">
        Replies and meetings
      </p>
      {outcomes.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-[var(--color-text-3)]">
          No reply or meeting insight yet.
        </p>
      ) : (
        <div className="mt-4 grid gap-3">
          {outcomes.map((outcome) => (
            <div key={outcome.id} className="border-t border-[var(--color-line-1)] pt-3 first:border-t-0 first:pt-0">
              <p className="text-sm font-semibold text-[var(--color-text-1)]">
                {outcome.kind.replace(/_/g, " ")}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-3)]">
                Score {Number(outcome.score).toFixed(2)} · {freshWhen(outcome.occurred_at)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function contactFitState(
  properties: Record<string, unknown> | null,
): ContactFitState {
  const raw =
    properties && typeof properties.contact_fit === "object"
      ? properties.contact_fit as Record<string, unknown>
      : null;
  const decision = fitDecisionValue(raw?.decision);
  return {
    decision,
    note: typeof raw?.note === "string" ? raw.note : null,
    recorded_at: typeof raw?.recorded_at === "string" ? raw.recorded_at : null,
  };
}

function fitDecisionValue(value: unknown): ContactFitDecision | null {
  return value === "fit" || value === "unsure" || value === "not_fit"
    ? value
    : null;
}

function fitLabel(decision: ContactFitDecision): string {
  if (decision === "fit") return "good fit";
  if (decision === "not_fit") return "not a fit";
  return "not sure";
}

function Fact({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[30px_1fr] gap-2 rounded-[8px] bg-[var(--color-ink-2)] p-2">
      <Icon name={icon} size={17} className="mt-0.5 text-[var(--color-accent)]" />
      <p className="min-w-0">
        <span className="block text-xs text-[var(--color-text-3)]">{label}</span>
        <span className="block truncate text-sm text-[var(--color-text-1)]">{value}</span>
      </p>
    </div>
  );
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "positive";
}) {
  return (
    <span
      className={
        "rounded-[8px] px-2.5 py-1 text-xs " +
        (tone === "positive"
          ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
          : "bg-[var(--color-ink-2)] text-[var(--color-text-2)]")
      }
    >
      {children}
    </span>
  );
}

function freshWhen(value: Date): string {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

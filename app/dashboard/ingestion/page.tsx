import Link from "next/link";
import { EmptyState } from "@/components/dashboard/Shell";
import { HeroStat, SurfaceHero, SurfaceSection } from "@/components/dashboard/SurfaceHero";
import Icon from "@/components/Icon";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import {
  loadQualifiedSignalEmailReadiness,
  loadQualifiedSignalWorkbench,
  type QualifiedSignalContact,
  type QualifiedSignalEmailReadiness,
  type QualifiedSignalItem,
} from "@/core/product/qualified-signals.ts";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspace } from "@/lib/workspace";
import {
  prepareQualifiedSignalsAction,
  decideApprovalWithDraftAction,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function SignalsPage() {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return (
      <SurfaceHero
        kicker="Qualified signals"
        title="No workspace selected."
        description="Create a prospecting profile first. Qualified signals, verified contacts, and email drafts will appear here."
      />
    );
  }

  const pool = getPool();
  const [workbench, emailReadiness] = await Promise.all([
    loadQualifiedSignalWorkbench(pool, workspace.id),
    loadQualifiedSignalEmailReadiness(pool, workspace.id),
  ]);

  return (
    <div className="space-y-10">
      <SurfaceHero
        kicker="Qualified signals"
        title={<>Signals worth <em>emailing now</em>.</>}
        description="The useful list: qualified timing signals, the top verified contacts at that company, and the personalized email draft tied to the evidence."
        meta={
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <HeroStat label="Qualified" value={workbench.stats.qualified} />
              <HeroStat label="With contacts" value={workbench.stats.with_verified_contacts} />
              <HeroStat label="Drafted" value={workbench.stats.with_email_draft} />
              <HeroStat label="Review" value={workbench.stats.ready_for_review} />
              <HeroStat label="Inbox" value={emailReadiness.status_label} />
            </div>
            <div className="flex flex-wrap gap-2">
              <form action={prepareQualifiedSignalsAction}>
                <input type="hidden" name="return_to" value="/dashboard/signals" />
                <input type="hidden" name="limit" value="25" />
                <PendingSubmitButton
                  className="btn-solid"
                  icon="send"
                  pendingLabel="Preparing"
                >
                  Prepare contacts + drafts
                </PendingSubmitButton>
              </form>
            </div>
          </div>
        }
      />

      {!emailReadiness.ready ? <EmailReadinessBanner readiness={emailReadiness} /> : null}

      <SurfaceSection title="Qualified list">
        {workbench.signals.length === 0 ? (
          <EmptyState
            title="No qualified signals yet"
            hint="Tune the prospecting profile so matched company signals have enough context to qualify."
            cta={{ href: "/dashboard/prospecting", label: "Tune prospecting", icon: "person" }}
          />
        ) : (
          <div className="grid gap-3">
            {workbench.signals.map((signal) => (
              <QualifiedSignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        )}
      </SurfaceSection>
    </div>
  );
}

function EmailReadinessBanner({
  readiness,
}: {
  readiness: QualifiedSignalEmailReadiness;
}) {
  const hasOutlook = readiness.connected_outlook_accounts > 0;
  const needsReconnect = readiness.needs_reauth_outlook_accounts > 0;
  const actionHref = needsReconnect
    ? "/api/auth/outlook"
    : hasOutlook
      ? "/dashboard/deliverability"
      : "/api/auth/outlook";
  const icon = needsReconnect ? "login" : hasOutlook ? "sync_problem" : "mail";
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[color:var(--color-line-1)] bg-[var(--color-ink-0)] px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
          <Icon name={icon} size={17} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--color-text-1)]">
            {needsReconnect
              ? "Reconnect Outlook to send"
              : hasOutlook
                ? "Outlook reply sync is being repaired"
                : "Connect Outlook to send"}
          </p>
          <p className="mt-1 text-sm leading-6 text-[var(--color-text-3)]">
            {readiness.detail}
          </p>
        </div>
      </div>
      <Link
        href={actionHref}
        prefetch={false}
        className="btn-solid"
      >
        <Icon
          name={needsReconnect ? "login" : hasOutlook ? "health_and_safety" : "mail"}
          size={15}
        />
        {needsReconnect
          ? "Reconnect Outlook"
          : hasOutlook
            ? "Review sync"
            : "Connect Outlook"}
      </Link>
    </div>
  );
}

function QualifiedSignalCard({ signal }: { signal: QualifiedSignalItem }) {
  const verifiedCount = signal.contacts.filter((contact) =>
    contact.verification.email_verified === true
  ).length;
  return (
    <article className="rounded-lg border border-[color:var(--color-line-1)] bg-[var(--color-ink-0)] p-4 md:p-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <section className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SignalBadge label={signal.kind.replace(/_/g, " ")} tone="accent" />
            <SignalBadge label={signal.status.replace(/_/g, " ")} />
            {signal.match_score != null ? (
              <SignalBadge label={`${Math.round(signal.match_score * 100)}% fit`} tone="positive" />
            ) : null}
            {verifiedCount > 0 ? (
              <SignalBadge label={`${verifiedCount} verified`} tone="positive" />
            ) : (
              <SignalBadge label="contacts pending" tone="muted" />
            )}
          </div>

          <h2 className="mt-4 text-xl font-semibold leading-tight text-[var(--color-text-1)]">
            {signal.title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-2)]">
            {signal.company.name ?? "Unknown company"}
            {signal.company.domain ? ` · ${signal.company.domain}` : ""}
            {" · "}
            Fresh {timeAgo(signal.freshness_at)}
            {signal.matched_at ? ` · qualified ${timeAgo(signal.matched_at)}` : ""}
          </p>

          {signal.content ? (
            <p className="mt-4 text-sm leading-6 text-[var(--color-text-2)]">
              {signal.content}
            </p>
          ) : null}
          {signal.match_reason ? (
            <p className="mt-4 border-l-2 border-[var(--color-accent)] pl-3 text-sm leading-6 text-[var(--color-text-2)]">
              {signal.match_reason}
            </p>
          ) : null}

          <div className="mt-5 grid gap-3 border-t border-[var(--color-line-1)] pt-4 sm:grid-cols-3">
            <Evidence label="Company" value={signal.company.name ?? "-"} icon="add_business" />
            <Evidence label="Timing" value={signal.kind.replace(/_/g, " ")} icon="sensors" />
            <Evidence
              label="Draft"
              value={signal.email_draft ? draftStatus(signal.email_draft.status) : "waiting"}
              icon={signal.email_draft ? "mail" : "refresh"}
            />
          </div>
        </section>

        <section className="grid gap-5 xl:border-l xl:border-[var(--color-line-1)] xl:pl-5">
          <ContactPanel
            contacts={signal.contacts}
            source={signal.contact_source}
            deferReason={signal.contact_defer_reason}
          />
          <EmailDraftPanel signal={signal} />
        </section>
      </div>
    </article>
  );
}

function ContactPanel({
  contacts,
  source,
  deferReason,
}: {
  contacts: QualifiedSignalContact[];
  source: QualifiedSignalItem["contact_source"];
  deferReason: string | null;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--color-text-1)]">
          Verified contacts
        </h3>
        <span className="text-xs text-[var(--color-text-3)]">
          {source === "resolution" ? "resolved" : source === "graph" ? "from graph" : "not ready"}
        </span>
      </div>
      {contacts.length === 0 ? (
        <p className="mt-3 rounded-md border border-[var(--color-line-1)] px-3 py-3 text-sm leading-6 text-[var(--color-text-3)]">
          {deferReason
            ? `Contact resolution paused: ${deferReason.replace(/_/g, " ")}.`
            : "No verified email contacts yet. Prepare contacts to run the Exa/Hunter/ZeroBounce waterfall."}
        </p>
      ) : (
        <ol className="mt-3 grid gap-2">
          {contacts.slice(0, 3).map((contact, index) => (
            <li
              key={`${contact.person_id}-${index}`}
              className="grid gap-2 border-b border-[var(--color-line-1)] pb-3 last:border-b-0 last:pb-0"
            >
              <div className="flex min-w-0 items-start gap-2">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-[var(--color-ink-2)] text-xs font-semibold tabular-nums text-[var(--color-text-2)]">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--color-text-1)]">
                    {contact.full_name}
                  </p>
                  <p className="truncate text-xs text-[var(--color-text-3)]">
                    {contact.title ?? "Relevant contact"}
                  </p>
                </div>
                <Icon
                  name={contact.verification.email_verified ? "task_alt" : "report"}
                  size={17}
                  className={
                    "ml-auto mt-0.5 " +
                    (contact.verification.email_verified
                      ? "text-[var(--color-pos)]"
                      : "text-[var(--color-text-3)]")
                  }
                />
              </div>
              <div className="ml-9 flex flex-wrap items-center gap-2">
                {contact.emails[0] ? (
                  <span className="rounded-full bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
                    {contact.emails[0]}
                  </span>
                ) : null}
                <span className="rounded-full bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-3)]">
                  {contact.verification.email_verified
                    ? contact.verification.email_status ?? "verified"
                    : "unverified"}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function EmailDraftPanel({ signal }: { signal: QualifiedSignalItem }) {
  const draft = signal.email_draft;
  return (
    <div className="border-t border-[var(--color-line-1)] pt-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--color-text-1)]">
          Personalized email
        </h3>
        {draft ? (
          <span className="text-xs text-[var(--color-text-3)]">
            {draft.eval_score != null ? `${Math.round(draft.eval_score * 100)} judge` : draftStatus(draft.status)}
          </span>
        ) : null}
      </div>
      {!draft ? (
        <p className="mt-3 rounded-md border border-[var(--color-line-1)] px-3 py-3 text-sm leading-6 text-[var(--color-text-3)]">
          No email draft yet. Once contacts resolve, the Signal-to-email Play writes and judges the draft here.
        </p>
      ) : (
        <div className="mt-3">
          <p className="text-sm font-semibold leading-5 text-[var(--color-text-1)]">
            {draft.subject ?? "(no subject)"}
          </p>
          <p className="mt-3 max-h-60 overflow-y-auto whitespace-pre-wrap rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-3 text-sm leading-6 text-[var(--color-text-2)]">
            {draft.body ?? "(no body)"}
          </p>
          <div className="mt-3 grid gap-3 border-t border-[var(--color-line-1)] pt-3 sm:grid-cols-3">
            <Evidence
              label="Judge"
              value={judgeSummary(draft)}
              icon={draft.eval_passed === false ? "report" : "task_alt"}
            />
            <Evidence
              label="Approval"
              value={approvalSummary(draft)}
              icon={draft.pending_approval_id ? "rate_review" : "check"}
            />
            <Evidence
              label="Send"
              value={sendSummary(draft)}
              icon={sendIcon(draft)}
            />
          </div>
          {draft.defer_reason ? (
            <p className="mt-3 rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-2 text-xs leading-5 text-[var(--color-text-3)]">
              Send paused: {humanize(draft.defer_reason)}
              {draft.defer_detail ? ` · ${draft.defer_detail}` : ""}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SignalBadge
              label={draft.eval_passed === false ? "judge blocked" : draftStatus(draft.status)}
              tone={draft.eval_passed === false ? "warning" : "positive"}
            />
            {draft.pending_approval_id ? (
              <>
                <Link
                  href="/dashboard/review"
                  prefetch={false}
                  className="btn-quiet-sm"
                >
                  <Icon name="rate_review" size={14} />
                  Review draft
                </Link>
                <form action={decideApprovalWithDraftAction}>
                  <input type="hidden" name="return_to" value="/dashboard/signals" />
                  <input type="hidden" name="approval_id" value={draft.pending_approval_id} />
                  <input type="hidden" name="decision" value="approved" />
                  <PendingSubmitButton
                    className="btn-solid-sm"
                    icon="check"
                    iconSize={14}
                    pendingLabel="Approving"
                  >
                    Approve
                  </PendingSubmitButton>
                </form>
                <form action={decideApprovalWithDraftAction}>
                  <input type="hidden" name="return_to" value="/dashboard/signals" />
                  <input type="hidden" name="approval_id" value={draft.pending_approval_id} />
                  <input type="hidden" name="decision" value="rejected" />
                  <PendingSubmitButton
                    className="btn-quiet-sm"
                    icon="close"
                    iconSize={14}
                    pendingLabel="Rejecting"
                  >
                    Reject
                  </PendingSubmitButton>
                </form>
              </>
            ) : draft.conversation_id ? (
              <Link
                href={`/dashboard/conversations/${draft.conversation_id}`}
                prefetch={false}
                className="btn-quiet-sm"
              >
                <Icon name="forum" size={14} />
                Open conversation
              </Link>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function judgeSummary(draft: NonNullable<QualifiedSignalItem["email_draft"]>): string {
  if (draft.eval_passed === false) return "blocked";
  if (draft.eval_passed === true) {
    return draft.eval_score != null
      ? `passed ${Math.round(draft.eval_score * 100)}%`
      : "passed";
  }
  return "not judged";
}

function approvalSummary(draft: NonNullable<QualifiedSignalItem["email_draft"]>): string {
  if (draft.pending_approval_id) return "needs review";
  if (draft.status === "draft") return "no pending review";
  if (draft.status === "deferred") return "cleared";
  if (["queued", "sent", "delivered", "replied"].includes(draft.status)) return "cleared";
  return humanize(draft.status);
}

function sendSummary(draft: NonNullable<QualifiedSignalItem["email_draft"]>): string {
  if (draft.latest_channel_event_type === "message.bounced") return "bounced";
  if (draft.delivered_at || draft.latest_channel_event_type === "message.delivered") {
    return `delivered ${timeAgo(draft.delivered_at ?? draft.latest_channel_event_at)}`;
  }
  if (draft.sent_at || draft.latest_channel_event_type === "message.sent") {
    return `sent ${timeAgo(draft.sent_at ?? draft.latest_channel_event_at)}`;
  }
  if (draft.latest_channel_event_type === "message.deferred" || draft.defer_reason) {
    return `deferred: ${humanize(draft.defer_reason ?? "needs_attention")}`;
  }
  if (draft.scheduled_at || draft.latest_channel_event_type === "message.queued") {
    return draft.scheduled_at ? `queued ${timeAgo(draft.scheduled_at)}` : "queued";
  }
  if (draft.pending_approval_id) return "waiting approval";
  if (draft.eval_passed === false) return "blocked by judge";
  return draftStatus(draft.status);
}

function sendIcon(draft: NonNullable<QualifiedSignalItem["email_draft"]>): string {
  if (draft.latest_channel_event_type === "message.bounced") return "report";
  if (draft.latest_channel_event_type === "message.deferred" || draft.defer_reason) {
    return "sync_problem";
  }
  if (draft.sent_at || draft.delivered_at || draft.latest_channel_event_type === "message.sent") {
    return "send";
  }
  if (draft.scheduled_at || draft.latest_channel_event_type === "message.queued") return "schedule";
  return "mail";
}

function Evidence({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-3)]">
        <Icon name={icon} size={14} />
        {label}
      </div>
      <p className="mt-1 truncate text-sm font-medium text-[var(--color-text-1)]">
        {value}
      </p>
    </div>
  );
}

function SignalBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "accent" | "positive" | "warning" | "muted";
}) {
  const styles = {
    neutral: "bg-[var(--color-ink-2)] text-[var(--color-text-2)]",
    accent: "bg-[var(--color-accent-bg)] text-[var(--color-accent)]",
    positive: "bg-[var(--color-pos-bg)] text-[var(--color-pos)]",
    warning: "bg-[var(--color-neg-bg)] text-[var(--color-neg)]",
    muted: "bg-[var(--color-ink-2)] text-[var(--color-text-3)]",
  }[tone];
  return (
    <span className={"rounded-full px-2.5 py-1 text-xs font-medium " + styles}>
      {label}
    </span>
  );
}

function draftStatus(status: string): string {
  if (status === "queued") return "queued to send";
  if (status === "sent" || status === "delivered" || status === "replied") return status;
  if (status === "deferred") return "needs attention";
  return humanize(status);
}

function humanize(value: string): string {
  return value.replace(/_/g, " ");
}

function timeAgo(d: Date | null): string {
  if (!d) return "never";
  const diff = Date.now() - new Date(d).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

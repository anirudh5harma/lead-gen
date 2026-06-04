import { EmptyState } from "@/components/dashboard/Shell";
import Icon from "@/components/Icon";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspace } from "@/lib/workspace";
import { decideApprovalWithDraftAction } from "../actions";

export const dynamic = "force-dynamic";

interface PendingApprovalRow {
  id: string;
  reason: string | null;
  payload: Record<string, unknown> | null;
  created_at: Date;
  subject: string | null;
  body: string | null;
  eval_score: string | null;
  eval_passed: boolean | null;
  rep_name: string | null;
  person_name: string | null;
  company_name: string | null;
  signal_title: string | null;
  signal_kind: string | null;
}

async function loadPending(workspaceId: string): Promise<PendingApprovalRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<PendingApprovalRow>(
    `select a.id, a.reason, a.payload, a.created_at,
            m.subject,
            m.body,
            m.eval_score::text as eval_score,
            m.eval_passed,
            r.name as rep_name,
            p.full_name as person_name,
            co.name as company_name,
            s.title as signal_title,
            s.kind::text as signal_kind
       from workflow_approvals a
       join workflow_runs wr on wr.id = a.run_id
       left join messages m
         on (a.payload->>'message_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and m.id = (a.payload->>'message_id')::uuid
       left join conversations c on c.id = m.conversation_id
       left join reps r on r.id = c.rep_id
       left join graph_persons p on p.id = c.counterparty_person_id
       left join graph_companies co on co.id = c.counterparty_company_id
       left join signals s on s.id = c.origin_signal_id
      where a.workspace_id = $1 and a.decision = 'pending'
      order by a.created_at desc`,
    [workspaceId],
  );
  return rows;
}

export default async function ApprovalsPage() {
  const workspace = await getActiveWorkspace();
  if (!workspace) return <CanvasEmpty label="Review" title="No workspace selected." />;

  const pending = await loadPending(workspace.id);

  return (
    <>
      <section className="section-canvas min-h-[360px] p-5 sm:p-8">
        <div className="section-thread section-thread-a" />
        <div className="grid gap-8 lg:grid-cols-[1fr_300px] lg:items-end">
          <div>
            <p className="brief-kicker">Review</p>
            <h1 className="mt-4 max-w-3xl text-[38px] font-semibold leading-[1.04] tracking-[0] text-[var(--color-text-1)] sm:text-[58px]">
              Only the work that needs your judgment.
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--color-text-2)]">
              Drafts that pass the rules stay out of your way. This canvas is for decisions, edits, and exceptions.
            </p>
          </div>
          <div className="section-note">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">Waiting now</p>
            <p className="mt-3 text-[34px] font-semibold leading-none tabular-nums text-[var(--color-text-1)]">
              {pending.length === 0 ? "Clear" : pending.length}
            </p>
            <p className="mt-3 text-sm leading-6 text-[var(--color-text-2)]">
              {pending.length === 0 ? "Nothing needs approval." : "Open each note, adjust, then approve or reject."}
            </p>
          </div>
        </div>
      </section>

      {pending.length === 0 ? (
        <EmptyState
          title="Nothing needs review"
          hint="Approved work and safe drafts stay off this canvas."
        />
      ) : (
        <section className="mt-6 grid gap-5">
          {pending.map((approval) => (
            <ReviewNote key={approval.id} approval={approval} />
          ))}
        </section>
      )}
    </>
  );
}

function ReviewNote({ approval }: { approval: PendingApprovalRow }) {
  const subject =
    approval.subject ?? stringPayload(approval.payload, "subject") ?? "(no subject)";
  const body = approval.body ?? stringPayload(approval.payload, "body") ?? "(no body)";

  return (
    <article className="section-note overflow-hidden">
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <section>
          <p className="text-sm text-[var(--color-text-3)]">
            {approval.person_name ?? "Unknown person"}
            {approval.company_name ? ` at ${approval.company_name}` : ""}
          </p>
          <h2 className="mt-2 text-2xl font-semibold leading-tight text-[var(--color-text-1)]">
            {subject}
          </h2>
          <p className="mt-3 text-sm leading-6 text-[var(--color-text-2)]">
            {approval.reason ?? "Bombsell wants a human check before this moves."}
          </p>
          <p className="mt-5 whitespace-pre-wrap rounded-[10px] bg-[rgba(255,255,255,0.58)] p-4 text-sm leading-7 text-[var(--color-text-2)]">
            {body}
          </p>
        </section>

        <aside>
          <p className="text-sm font-semibold text-[var(--color-text-1)]">Why it stopped</p>
          <div className="mt-4 grid gap-2">
            <Evidence icon="person" label="Voice" value={approval.rep_name ?? "-"} />
            <Evidence icon="sensors" label="Why now" value={approval.signal_title ?? "-"} />
            <Evidence
              icon={approval.eval_passed ? "verified" : "warning"}
              label="Check"
              value={approval.eval_passed === false ? "Needs review" : "Ready"}
            />
          </div>

          <form action={decideApprovalWithDraftAction} className="mt-5 grid gap-3 border-t border-[var(--color-line-1)] pt-5">
            <input type="hidden" name="approval_id" value={approval.id} />
            <input type="hidden" name="decision" value="approved" />
            <Field name="subject" label="Subject" defaultValue={subject} />
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-[var(--color-text-3)]">Body</span>
              <textarea
                name="body"
                rows={8}
                defaultValue={body}
                className="rounded-[8px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.72)] px-3 py-2 text-sm leading-6 text-[var(--color-text-1)]"
              />
            </label>
            <button
              type="submit"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[8px] bg-[var(--color-text-1)] px-4 text-sm font-semibold text-[var(--color-ink-0)] hover:bg-[var(--color-accent)]"
            >
              <Icon name="check" size={17} />
              Approve
            </button>
          </form>
          <form action={decideApprovalWithDraftAction} className="mt-3">
            <input type="hidden" name="approval_id" value={approval.id} />
            <input type="hidden" name="decision" value="rejected" />
            <button
              type="submit"
              className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[8px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.68)] px-4 text-sm font-semibold text-[var(--color-text-2)] hover:bg-[var(--color-ink-2)]"
            >
              <Icon name="close" size={17} />
              Reject
            </button>
          </form>
        </aside>
      </div>
    </article>
  );
}

function stringPayload(payload: Record<string, unknown> | null, key: string): string | null {
  const value = payload?.[key];
  return typeof value === "string" ? value : null;
}

function Evidence({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="grid grid-cols-[28px_1fr] gap-2 rounded-[8px] bg-[rgba(255,255,255,0.62)] p-2">
      <Icon name={icon} size={18} className="mt-0.5 text-[var(--color-accent)]" />
      <p className="min-w-0">
        <span className="block text-xs text-[var(--color-text-3)]">{label}</span>
        <span className="block truncate text-sm text-[var(--color-text-1)]">{value}</span>
      </p>
    </div>
  );
}

function Field({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-[var(--color-text-3)]">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue}
        className="min-h-10 rounded-[8px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.72)] px-3 text-sm text-[var(--color-text-1)]"
      />
    </label>
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

import { EmptyState, SectionHeader } from "@/components/dashboard/Shell";
import Icon from "@/components/Icon";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspace } from "@/lib/workspace";
import { decideApprovalWithDraftAction } from "../actions";

export const dynamic = "force-dynamic";

interface PendingApprovalRow {
  id: string;
  kind: string;
  reason: string | null;
  payload: Record<string, unknown> | null;
  created_at: Date;
  run_id: string;
  workflow_name: string;
  message_id: string | null;
  subject: string | null;
  body: string | null;
  eval_score: string | null;
  eval_passed: boolean | null;
  eval_notes: Record<string, unknown> | null;
  rep_name: string | null;
  person_name: string | null;
  company_name: string | null;
  signal_title: string | null;
  signal_kind: string | null;
}

async function loadPending(workspaceId: string): Promise<PendingApprovalRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<PendingApprovalRow>(
    `select a.id, a.kind, a.reason, a.payload, a.created_at,
            a.run_id, wr.workflow_name,
            m.id as message_id,
            m.subject,
            m.body,
            m.eval_score::text as eval_score,
            m.eval_passed,
            m.eval_notes,
            r.name as rep_name,
            p.full_name as person_name,
            co.name as company_name,
            s.title as signal_title,
            s.kind::text as signal_kind
       from workflow_approvals a
       join workflow_runs wr on wr.id = a.run_id
       left join messages m on m.id = (a.payload->>'message_id')::uuid
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
  if (!workspace) {
    return (
      <>
        <SectionHeader eyebrow="approvals" title="No workspace selected" />
      </>
    );
  }
  const pending = await loadPending(workspace.id);

  return (
    <>
      <SectionHeader
        eyebrow="approvals"
        title="Pending approvals"
        subtitle={`${pending.length} parked workflow${pending.length === 1 ? "" : "s"} waiting on you`}
      />
      {pending.length === 0 ? (
        <EmptyState
          title="No approvals pending"
          hint="Workflows that hit an approval gate appear here until you decide."
        />
      ) : (
        <ul className="divide-y divide-[var(--color-line-1)]">
          {pending.map((a) => (
            <li
              key={a.id}
              className="py-5 first:pt-0 last:pb-0"
            >
              <div className="grid gap-5 lg:grid-cols-[1fr_0.72fr]">
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-3)]">
                    {a.kind}
                  </p>
                  <p className="font-serif text-base text-[var(--color-text-1)] mt-1">
                    {a.reason ?? "(no reason given)"}
                  </p>
                  <p className="font-mono text-[10px] text-[var(--color-text-3)] mt-1">
                    workflow {a.workflow_name} · run {a.run_id.slice(0, 8)} ·{" "}
                    parked {new Date(a.created_at).toLocaleString()}
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                    <TrustMetric label="Rep" value={a.rep_name ?? "-"} />
                    <TrustMetric label="Person" value={a.person_name ?? "-"} />
                    <TrustMetric label="Company" value={a.company_name ?? "-"} />
                    <TrustMetric label="Judge" value={a.eval_score ? Number(a.eval_score).toFixed(2) : "-"} />
                  </div>
                  <div className="mt-4 rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] p-4">
                    <p className="text-sm font-semibold text-[var(--color-text-1)]">
                      {a.subject ?? stringPayload(a.payload, "subject") ?? "(no subject)"}
                    </p>
                    <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-6 text-[var(--color-text-2)]">
                      {a.body ?? stringPayload(a.payload, "body") ?? "(no body)"}
                    </pre>
                  </div>
                </div>
                <div className="grid gap-3 rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-3)]">
                    Trust evidence
                  </p>
                  <Evidence icon="sensors" label="Signal" value={a.signal_title ?? "-"} />
                  <Evidence icon="category" label="Kind" value={a.signal_kind ?? "-"} />
                  <Evidence
                    icon={a.eval_passed ? "verified" : "warning"}
                    label="Hot-path judge"
                    value={a.eval_passed ? "passed" : "needs review"}
                  />
                  <Evidence icon="policy" label="Policy" value={stringPayload(a.payload, "policy") ?? "-"} />
                  <form action={decideApprovalWithDraftAction} className="grid gap-3 border-t border-[var(--color-line-1)] pt-3">
                    <input type="hidden" name="approval_id" value={a.id} />
                    <input type="hidden" name="decision" value="approved" />
                    <Field
                      name="subject"
                      label="Subject"
                      defaultValue={a.subject ?? stringPayload(a.payload, "subject") ?? ""}
                    />
                    <label className="grid gap-1.5">
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-3)]">
                        Body
                      </span>
                      <textarea
                        name="body"
                        rows={7}
                        defaultValue={a.body ?? stringPayload(a.payload, "body") ?? ""}
                        className="rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2 text-sm leading-6 text-[var(--color-text-1)]"
                      />
                    </label>
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-[var(--color-accent-on)] hover:bg-[var(--color-accent-hi)]"
                    >
                      <Icon name="check" size={17} />
                      Approve
                    </button>
                  </form>
                  <form action={decideApprovalWithDraftAction}>
                    <input type="hidden" name="approval_id" value={a.id} />
                    <input type="hidden" name="decision" value="rejected" />
                    <button
                      type="submit"
                      className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-[var(--color-line-1)] px-3 py-2 text-sm font-semibold text-[var(--color-text-2)] hover:bg-[var(--color-ink-3)]"
                    >
                      <Icon name="close" size={17} />
                      Reject
                    </button>
                  </form>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function stringPayload(payload: Record<string, unknown> | null, key: string): string | null {
  const value = payload?.[key];
  return typeof value === "string" ? value : null;
}

function TrustMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-3)]">
        {label}
      </p>
      <p className="truncate text-sm font-semibold text-[var(--color-text-1)]">{value}</p>
    </div>
  );
}

function Evidence({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="grid grid-cols-[20px_1fr] gap-2 text-sm">
      <Icon name={icon} size={18} className="text-[var(--color-text-3)]" />
      <p className="min-w-0">
        <span className="block text-xs text-[var(--color-text-3)]">{label}</span>
        <span className="block truncate text-[var(--color-text-1)]">{value}</span>
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
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-3)]">
        {label}
      </span>
      <input
        name={name}
        defaultValue={defaultValue}
        className="min-h-10 rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 text-sm text-[var(--color-text-1)]"
      />
    </label>
  );
}

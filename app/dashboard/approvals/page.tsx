import { revalidatePath } from "next/cache";
import { EmptyState, SectionHeader } from "@/components/dashboard/Shell";
import { getPool } from "@/core/substrate/storage/index.ts";
import { createPostgresEventBus } from "@/core/substrate/events/adapters/postgres.ts";
import { getActiveWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

interface PendingApprovalRow {
  id: string;
  kind: string;
  reason: string | null;
  payload: Record<string, unknown> | null;
  created_at: Date;
  run_id: string;
  workflow_name: string;
}

async function loadPending(workspaceId: string): Promise<PendingApprovalRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<PendingApprovalRow>(
    `select a.id, a.kind, a.reason, a.payload, a.created_at,
            a.run_id, wr.workflow_name
       from workflow_approvals a
       join workflow_runs wr on wr.id = a.run_id
      where a.workspace_id = $1 and a.decision = 'pending'
      order by a.created_at desc`,
    [workspaceId],
  );
  return rows;
}

async function decide(approvalId: string, decision: "approved" | "rejected"): Promise<void> {
  "use server";
  const pool = getPool();
  // We don't have a long-lived workflow runtime instance to resolve via
  // the typed API here (the workflow that requested approval lives in
  // another process). The safe path is: write the decision, emit
  // approval.decided on the bus, let any parked workflow listening for
  // it (in-process or via Restate awakeable) wake up.
  const bus = await createPostgresEventBus({ pool });
  try {
    const result = await pool.query<{ workspace_id: string }>(
      `update workflow_approvals
          set decision = $1, decided_at = now()
        where id = $2 and decision = 'pending'
        returning workspace_id`,
      [decision, approvalId],
    );
    const row = result.rows[0];
    if (!row) return;
    await bus.publish({
      workspace_id: row.workspace_id,
      event_type: "approval.decided",
      source: "user",
      payload: {
        approval_id: approvalId,
        decision,
        decided_by: null,
      },
    });
  } finally {
    await bus.close();
  }
  revalidatePath("/dashboard/approvals");
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
        <ul className="space-y-3">
          {pending.map((a) => (
            <li
              key={a.id}
              className="border border-[var(--color-line-1)] rounded-lg p-4 bg-[var(--color-ink-0)]"
            >
              <div className="flex items-start gap-4">
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
                  {a.payload && Object.keys(a.payload).length > 0 ? (
                    <pre className="mt-3 font-mono text-[11px] text-[var(--color-text-2)] bg-[var(--color-ink-2)] rounded p-3 overflow-auto max-h-40">
                      {JSON.stringify(a.payload, null, 2)}
                    </pre>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2 w-32 shrink-0">
                  <form action={decideApproveAction.bind(null, a.id)}>
                    <button
                      type="submit"
                      className="w-full px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] rounded text-[var(--color-accent-on)] bg-[var(--color-accent)] hover:bg-[var(--color-accent-hi)]"
                    >
                      approve
                    </button>
                  </form>
                  <form action={decideRejectAction.bind(null, a.id)}>
                    <button
                      type="submit"
                      className="w-full px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] rounded text-[var(--color-text-2)] bg-[var(--color-ink-2)] hover:bg-[var(--color-ink-3)]"
                    >
                      reject
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

async function decideApproveAction(id: string): Promise<void> {
  "use server";
  return decide(id, "approved");
}
async function decideRejectAction(id: string): Promise<void> {
  "use server";
  return decide(id, "rejected");
}

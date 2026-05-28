import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { setupPg } from "./_pg.ts";
import { getEventTraceForCorrelation } from "../core/product/forensics.ts";

test("forensics: reconstructs a workspace-scoped causal event trace", async (t) => {
  const fx = await setupPg("product_forensics");
  if (!fx) return t.skip("DATABASE_URL not set");

  try {
    const workspaceId = randomUUID();
    const correlationId = randomUUID();
    const rootId = randomUUID();
    const childId = randomUUID();
    await fx.pool.query(
      `insert into workspaces (id, slug, name)
       values ($1, $2, 'Forensics Test')`,
      [workspaceId, `forensics-${workspaceId.slice(0, 8)}`],
    );
    await fx.pool.query(
      `insert into events (
         id, workspace_id, event_type, correlation_id, causation_id,
         source, producer_ref, payload, occurred_at
       ) values
         ($1, $3, 'draft.proposed', $4, null, 'agent', 'rep:test', $5::jsonb, '2026-05-26T01:00:00Z'),
         ($2, $3, 'draft.judged', $4, $1, 'system', 'judge:test', $6::jsonb, '2026-05-26T01:00:01Z')`,
      [
        rootId,
        childId,
        workspaceId,
        correlationId,
        JSON.stringify({ message_id: randomUUID() }),
        JSON.stringify({ message_id: randomUUID(), passed: true, eval_score: 0.91 }),
      ],
    );

    const trace = await getEventTraceForCorrelation(fx.pool, {
      workspace_id: workspaceId,
      correlation_id: correlationId,
    });

    assert.equal(trace.summary.event_count, 2);
    assert.equal(trace.summary.root_event_type, "draft.proposed");
    assert.equal(trace.summary.terminal_event_type, "draft.judged");
    assert.deepEqual(
      trace.events.map((event) => [event.id, event.depth]),
      [
        [rootId, 0],
        [childId, 1],
      ],
    );
  } finally {
    await fx.close();
  }
});

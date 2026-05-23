import type { WorkflowRuntime } from "../types.ts";

/**
 * Restate workflow runtime adapter — production target.
 *
 * STUB. Not yet wired. See ARCHITECTURE.md "Opinionated Tech Stack" for why
 * Restate is the production choice: Postgres-native journaling, virtual
 * actor model that maps cleanly onto Reps, low-latency durable promises.
 *
 * Implementation contract:
 *
 *   1. Map each WorkflowDefinition to a Restate service handler. The
 *      Restate SDK's `ctx.run(name, fn)` IS our `ctx.step(name, fn)` — they
 *      have identical semantics. Thin adapter, not a re-implementation.
 *   2. Map `ctx.sleep(ms)` to `ctx.sleep(ms)` in Restate.
 *   3. Map `ctx.awaitEvent` and `ctx.requestApproval` to Restate's awakeable
 *      promises; emit the awakeable id onto the bus / approval table so
 *      external callers can complete the awakeable by id.
 *   4. Map `ctx.publish` to a Restate side-effect that publishes to the
 *      bus and writes to the `events` table.
 *   5. Honour `idempotency_key` via Restate's invocation deduplication.
 *
 * Until this lands, `createInProcessWorkflowRuntime()` is the only working
 * adapter. It is sufficient for dev, tests, and demos but NOT for
 * production: workflows that are in-flight when the process dies are lost.
 */

export interface RestateRuntimeOptions {
  ingressUrl: string;
  /** Optional bearer for the Restate admin / ingress API. */
  bearer?: string;
}

export function createRestateWorkflowRuntime(
  _opts: RestateRuntimeOptions,
): WorkflowRuntime {
  throw new Error(
    "Restate workflow runtime adapter is not yet implemented. See core/substrate/workflows/adapters/restate.ts for the contract.",
  );
}

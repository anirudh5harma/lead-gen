import { randomUUID } from "node:crypto";
import type {
  ApprovalDecision,
  StartOptions,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowRuntime,
} from "../types.ts";

/**
 * Restate workflow runtime adapter — production target.
 *
 * What this adapter IS: the **client side** of Restate. It satisfies our
 * `WorkflowRuntime` interface by speaking to a running Restate server over
 * HTTP. Use it from request-time code (a Next.js route, a webhook handler,
 * a Play executor) to start invocations, query their status, and resolve
 * approval awakeables.
 *
 * What this adapter IS NOT: the workflow body host. Restate workflows run
 * inside an HTTP endpoint that hosts the `@restatedev/restate-sdk` handlers
 * — that endpoint is a separate process (typically a small Node service)
 * which Restate fetches handlers from. Hosting workflow bodies is a
 * deployment-shape concern; see the comment block at the bottom of this
 * file for the runtime topology.
 *
 *   our app  ──HTTP──▶  Restate server  ──HTTP──▶  workflow-handler process
 *      (this adapter)                              (@restatedev/restate-sdk)
 *
 * The mapping from our `defineWorkflow` shape to Restate handlers is
 * mechanical: `ctx.step` ↔ `ctx.run`, `ctx.sleep` ↔ `ctx.sleep`,
 * `ctx.awaitEvent` and `ctx.requestApproval` ↔ Restate awakeables. The
 * handler module that performs that translation lives outside this file
 * (deployment-side); foundation ships only the client/adapter so
 * production deployments can wire it without code changes here.
 */

export interface RestateRuntimeOptions {
  /**
   * The Restate ingress base URL. e.g. `http://restate:8080` or
   * `https://restate.example.com`.
   */
  ingressUrl: string;
  /** Optional bearer token for the Restate API. */
  bearer?: string;
  /**
   * Service name registered with Restate that hosts our workflow handlers.
   * Each `workflow_name` maps to a handler on this service. Defaults to
   * "bombsell_workflows".
   */
  serviceName?: string;
  /** Inject a fetch impl (tests). Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export class RestateClientError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(`${message} (status ${status}): ${body.slice(0, 300)}`);
    this.name = "RestateClientError";
    this.status = status;
    this.body = body;
  }
}

interface RestateInvocationResponse {
  invocationId?: string;
  /** Restate returns the output if the invocation completes synchronously. */
  output?: unknown;
}

interface RestateStatusResponse {
  status?: string;
  output?: unknown;
  error?: { message?: string };
  startedAt?: string;
  completedAt?: string;
}

export function createRestateWorkflowRuntime(
  opts: RestateRuntimeOptions,
): WorkflowRuntime {
  const ingressUrl = opts.ingressUrl.replace(/\/$/, "");
  const serviceName = opts.serviceName ?? "bombsell_workflows";
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  // `register()` is a logical no-op for the client — workflow handlers are
  // hosted by a separate process. We keep a local map so callers can ask
  // `WorkflowDefinition`-shaped questions (e.g., the play executor needs the
  // version string at start time) without an extra round-trip.
  const knownVersions = new Map<string, string>();

  async function request<T = unknown>(
    method: "POST" | "GET",
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(opts.bearer ? { Authorization: `Bearer ${opts.bearer}` } : {}),
      ...extraHeaders,
    };
    const response = await fetchImpl(`${ingressUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw new RestateClientError(
        `Restate ${method} ${path} failed`,
        response.status,
        await response.text(),
      );
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  return {
    register<I, O>(workflow: WorkflowDefinition<I, O>): void {
      knownVersions.set(workflow.name, workflow.version);
    },

    async start<I, O = unknown>(
      startOpts: StartOptions<I>,
    ): Promise<WorkflowRun<I, O>> {
      const headers: Record<string, string> = {};
      if (startOpts.idempotency_key) {
        headers["idempotency-key"] = startOpts.idempotency_key;
      }

      // POST to the keyed-service invocation endpoint. Restate uses the URL
      // path to route to the right service + handler.
      const path = `/${encodeURIComponent(serviceName)}/${encodeURIComponent(
        startOpts.workflow_name,
      )}/send`;
      const body = {
        request: startOpts.input,
        metadata: {
          workspace_id: startOpts.workspace_id,
          play_id: startOpts.play_id ?? null,
          play_run_id: startOpts.play_run_id ?? null,
          correlation_id: startOpts.correlation_id ?? null,
          causation_id: startOpts.causation_id ?? null,
        },
      };
      const result = await request<RestateInvocationResponse>(
        "POST",
        path,
        body,
        headers,
      );
      const invocationId = result.invocationId ?? randomUUID();
      const nowIso = new Date().toISOString();
      return {
        id: invocationId,
        workspace_id: startOpts.workspace_id,
        workflow_name: startOpts.workflow_name,
        workflow_version: knownVersions.get(startOpts.workflow_name) ?? "unknown",
        status: "running" as WorkflowRunStatus,
        input: startOpts.input,
        play_id: startOpts.play_id ?? null,
        play_run_id: startOpts.play_run_id ?? null,
        correlation_id: startOpts.correlation_id ?? null,
        causation_id: startOpts.causation_id ?? null,
        idempotency_key: startOpts.idempotency_key ?? null,
        started_at: nowIso,
        created_at: nowIso,
      };
    },

    async get<I = unknown, O = unknown>(
      run_id: string,
    ): Promise<WorkflowRun<I, O> | null> {
      const path = `/restate/invocation/${encodeURIComponent(run_id)}`;
      try {
        const status = await request<RestateStatusResponse>("GET", path);
        return {
          id: run_id,
          workspace_id: "",
          workflow_name: "",
          workflow_version: "",
          status: mapRestateStatus(status.status),
          input: undefined as I,
          output: status.output as O | undefined,
          error: status.error?.message
            ? { message: status.error.message }
            : undefined,
          started_at: status.startedAt,
          ended_at: status.completedAt,
          created_at: status.startedAt ?? new Date().toISOString(),
        };
      } catch (err) {
        if (err instanceof RestateClientError && err.status === 404) {
          return null;
        }
        throw err;
      }
    },

    async resolveApproval(
      approval_id: string,
      decision: ApprovalDecision,
    ): Promise<void> {
      // Approvals are Restate awakeables — the workflow created one and
      // its id was published on the bus. The Surface layer / approval UI
      // calls back here when the user decides; we POST the result to
      // Restate's awakeable resolve endpoint.
      const path = `/restate/awakeables/${encodeURIComponent(approval_id)}/resolve`;
      await request("POST", path, {
        decision: decision.decision,
        decided_by: decision.decided_by ?? null,
        note: decision.note ?? null,
      });
    },
  };
}

function mapRestateStatus(status: string | undefined): WorkflowRunStatus {
  switch ((status ?? "").toLowerCase()) {
    case "running":
    case "executing":
      return "running";
    case "suspended":
    case "waiting":
      return "awaiting_event";
    case "completed":
    case "succeeded":
      return "completed";
    case "failed":
    case "errored":
      return "failed";
    case "cancelled":
    case "killed":
      return "cancelled";
    default:
      return "pending";
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Deployment topology (for whoever is wiring this up):
 *
 *   1. Run a Restate server. The minimal local recipe is:
 *        docker run -p 9070:9070 -p 8080:8080 docker.restate.dev/restatedev/restate:latest
 *      9070 is the admin API; 8080 is the ingress.
 *
 *   2. Run a workflow-handler process. This is a separate Node process
 *      built around `@restatedev/restate-sdk` that translates our
 *      WorkflowDefinitions into Restate handlers. The skeleton:
 *
 *        import * as restate from "@restatedev/restate-sdk";
 *        import { handlerForWorkflow } from "./bridge.ts";
 *        import { createSeriesAColdOpenPlay } from "@/core/plays";
 *
 *        const svc = restate.service({
 *          name: "bombsell_workflows",
 *          handlers: {
 *            series_a_cold_open: handlerForWorkflow(createSeriesAColdOpenPlay(deps)),
 *          },
 *        });
 *        restate.endpoint().bind(svc).listen(9080);
 *
 *      The bridge module (`handlerForWorkflow`) maps our RunContext shape
 *      to Restate's. See `core/substrate/workflows/types.ts` — the mapping
 *      is mechanical (step ↔ run, sleep ↔ sleep, awakeable for parks).
 *      That bridge is intentionally NOT in foundation: it requires the
 *      Restate runtime + handler process to validate, which is heavier
 *      than what fits in pre-production foundation.
 *
 *   3. Register the workflow service with Restate:
 *        curl -X POST http://localhost:9070/deployments \
 *          -d '{"uri":"http://handlers:9080"}'
 *
 *   4. In your app, construct this adapter:
 *        const runtime = createRestateWorkflowRuntime({
 *          ingressUrl: process.env.RESTATE_INGRESS_URL,
 *          serviceName: "bombsell_workflows",
 *        });
 *
 *      Now `runtime.start({...})` invokes the workflow over HTTP, Restate
 *      journals everything, and crashes don't lose in-flight work.
 *
 * Until that's deployed, `createPostgresWorkflowRuntime` is the production
 * choice: it journals to Postgres + survives crashes for completed steps,
 * but doesn't resume parked workflows across process restarts. Single-
 * process deployments don't need Restate yet.
 * ────────────────────────────────────────────────────────────────────── */

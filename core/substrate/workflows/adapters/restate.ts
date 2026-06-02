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
 * Each WorkflowDefinition must be deployed as a native Restate workflow
 * named after `workflow.name`. Restate invokes its `run` handler with a
 * stable workflow key; our idempotency key becomes that key when provided.
 * `ctx.awaitEvent` and `ctx.requestApproval` are hosted by the SDK worker:
 * approvals resolve Restate awakeables, while typed event waits resolve
 * workflow-bound durable promises through the signal bridge.
 */

export interface RestateRuntimeOptions {
  /**
   * The Restate ingress base URL. e.g. `http://restate:8080` or
   * `https://restate.example.com`.
   */
  ingressUrl: string;
  /** Optional bearer token for the Restate API. */
  bearer?: string;
  /** Inject a fetch impl (tests). Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export function restateBearerFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return env.RESTATE_BEARER_TOKEN?.trim()
    || env.RESTATE_AUTH_TOKEN?.trim()
    || undefined;
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

interface RestateOutputResponse {
  message?: string;
}

export function createRestateWorkflowRuntime(
  opts: RestateRuntimeOptions,
): WorkflowRuntime {
  const ingressUrl = opts.ingressUrl.replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  // `register()` is a logical no-op for the client — workflow handlers are
  // hosted by a separate process. We keep a local map so callers can ask
  // `WorkflowDefinition`-shaped questions (e.g., the play executor needs the
  // version string at start time) without an extra round-trip.
  const knownVersions = new Map<string, string>();

  async function requestResponse(
    method: "POST" | "GET",
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<Response> {
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
    return response;
  }

  async function request<T = unknown>(
    method: "POST" | "GET",
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const response = await requestResponse(method, path, body, extraHeaders);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async function getRun<I = unknown, O = unknown>(
    run_id: string,
  ): Promise<WorkflowRun<I, O> | null> {
    const path = `/restate/invocation/${encodeURIComponent(run_id)}/output`;
    try {
      const response = await requestResponse("GET", path);
      const text = await response.text();
      const payload = text ? (JSON.parse(text) as RestateOutputResponse | O) : undefined;
      if (isRestateOutputMessage(payload, "not found")) return null;
      const nowIso = new Date().toISOString();
      return {
        id: run_id,
        execution_scope: "workspace",
        workspace_id: "",
        workflow_name: "",
        workflow_version: "",
        status: isRestateOutputMessage(payload, "not ready")
          ? "running"
          : "completed",
        input: undefined as I,
        output: isRestateOutputResponse(payload) ? undefined : payload as O | undefined,
        ended_at: isRestateOutputMessage(payload, "not ready") ? undefined : nowIso,
        created_at: nowIso,
      };
    } catch (err) {
      if (err instanceof RestateClientError && err.status === 404) {
        return null;
      }
      if (
        err instanceof RestateClientError &&
        err.status === 470 &&
        err.body.includes("has not completed yet")
      ) {
        const nowIso = new Date().toISOString();
        return {
          id: run_id,
          execution_scope: "workspace",
          workspace_id: "",
          workflow_name: "",
          workflow_version: "",
          status: "running",
          input: undefined as I,
          created_at: nowIso,
        };
      }
      throw err;
    }
  }

  return {
    register<I, O>(workflow: WorkflowDefinition<I, O>): void {
      knownVersions.set(workflow.name, workflow.version);
    },

    async start<I, O = unknown>(
      startOpts: StartOptions<I>,
    ): Promise<WorkflowRun<I, O>> {
      // Native Restate workflows are keyed. Reusing an idempotency key
      // invokes the same workflow instance; otherwise each start is a fresh
      // workflow invocation.
      const workflowKey = startOpts.idempotency_key ?? randomUUID();
      const path = `/${encodeURIComponent(
        startOpts.workflow_name,
      )}/${encodeURIComponent(workflowKey)}/run/send`;
      const body = {
        request: startOpts.input,
        metadata: {
          execution_scope: startOpts.execution_scope ?? "workspace",
          workspace_id: startOpts.workspace_id,
          play_id: startOpts.play_id ?? null,
          play_run_id: startOpts.play_run_id ?? null,
          correlation_id: startOpts.correlation_id ?? null,
          causation_id: startOpts.causation_id ?? null,
        },
      };
      const response = await requestResponse(
        "POST",
        path,
        body,
      );
      const text = await response.text();
      const result = text
        ? (JSON.parse(text) as RestateInvocationResponse)
        : undefined;
      const invocationId =
        response.headers.get("x-restate-id") ??
        result?.invocationId ??
        workflowKey;
      const nowIso = new Date().toISOString();
      return {
        id: invocationId,
        execution_scope: startOpts.execution_scope ?? "workspace",
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
      return getRun<I, O>(run_id);
    },

    async resume<I = unknown, O = unknown>(
      run_id: string,
    ): Promise<WorkflowRun<I, O> | null> {
      // Restate owns durable execution; there is no local worker journal to
      // replay from the client side. Returning the invocation state preserves
      // the WorkflowRuntime contract for callers that need to probe/resume.
      return getRun<I, O>(run_id);
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

function isRestateOutputResponse(value: unknown): value is RestateOutputResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      "message" in value &&
      typeof (value as RestateOutputResponse).message === "string",
  );
}

function isRestateOutputMessage(
  value: unknown,
  message: string,
): value is RestateOutputResponse {
  return isRestateOutputResponse(value) && value.message === message;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Deployment topology (for whoever is wiring this up):
 *
 *   1. Run a Restate server. The minimal local recipe is:
 *        docker run -p 9070:9070 -p 8080:8080 docker.restate.dev/restatedev/restate:latest
 *      9070 is the admin API; 8080 is the ingress.
 *
 *   2. Run a workflow-handler process built on `@restatedev/restate-sdk`.
 *      Each WorkflowDefinition must be exposed as `restate.workflow({
 *      name: definition.name, handlers: { run: ... } })`. The handler bridge
 *      must map steps and sleeps to Restate journaled operations and map
 *      event waits/approval decisions to a tested durable signal mechanism.
 *
 *   3. Register the workflow service with Restate:
 *        curl -X POST http://localhost:9070/deployments \
 *          -d '{"uri":"http://handlers:9080"}'
 *
 *   4. In your app, construct this adapter:
 *        const runtime = createRestateWorkflowRuntime({
 *          ingressUrl: process.env.RESTATE_INGRESS_URL,
 *          bearer: process.env.RESTATE_BEARER_TOKEN,
 *        });
 *
 *      Now `runtime.start({...})` invokes the workflow over HTTP, Restate
 *      journals everything, and crashes don't lose in-flight work.
 *
 * Until that's deployed, `createPostgresWorkflowRuntime` is a development
 * bridge: it journals to Postgres for observability, but it cannot resume
 * parked workflows across process restarts and is not the production
 * runtime specified by ARCHITECTURE.md.
 * ────────────────────────────────────────────────────────────────────── */

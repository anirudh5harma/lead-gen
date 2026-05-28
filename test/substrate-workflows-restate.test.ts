import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createRestateWorkflowRuntime,
  RestateClientError,
} from "../core/substrate/workflows/adapters/restate.ts";
import { defineWorkflow } from "../core/substrate/workflows/define.ts";

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function spyFetch(
  responder: (req: RecordedRequest) => {
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
  },
): { fetchImpl: typeof fetch; calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headersRaw: Record<string, string> = {};
    const incoming = init?.headers;
    if (incoming) {
      if (incoming instanceof Headers) {
        incoming.forEach((v, k) => {
          headersRaw[k.toLowerCase()] = v;
        });
      } else if (Array.isArray(incoming)) {
        for (const [k, v] of incoming) headersRaw[k.toLowerCase()] = v;
      } else {
        for (const [k, v] of Object.entries(incoming)) {
          headersRaw[k.toLowerCase()] = String(v);
        }
      }
    }
    let parsedBody: unknown = undefined;
    if (typeof init?.body === "string" && init.body.length > 0) {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }
    const url = typeof input === "string" ? input : (input as URL).toString();
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: headersRaw,
      body: parsedBody,
    });
    const { status = 200, body, headers } = responder(calls[calls.length - 1]);
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const ingress = "http://restate.local:8080";

test("restate client: start() submits a keyed native workflow with input + metadata", async () => {
  const { fetchImpl, calls } = spyFetch(() => ({
    headers: { "x-restate-id": "inv-1" },
  }));
  const runtime = createRestateWorkflowRuntime({
    ingressUrl: ingress,
    bearer: "secret",
    fetchImpl,
  });
  runtime.register(
    defineWorkflow<{ a: number }, number>({
      name: "demo",
      version: "v3",
      async run() {
        return 0;
      },
    }),
  );

  const workspace_id = randomUUID();
  const run = await runtime.start<{ a: number }>({
    workspace_id,
    workflow_name: "demo",
    input: { a: 41 },
    idempotency_key: "run-key-1",
    correlation_id: "cor-1",
  });

  assert.equal(run.id, "inv-1");
  assert.equal(run.workflow_name, "demo");
  assert.equal(run.workflow_version, "v3");
  assert.equal(run.status, "running");
  assert.deepEqual(run.input, { a: 41 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, `${ingress}/demo/run-key-1/run/send`);
  assert.equal(calls[0].headers.authorization, "Bearer secret");
  assert.equal(calls[0].headers["idempotency-key"], "run-key-1");
  assert.deepEqual(calls[0].body, {
    request: { a: 41 },
    metadata: {
      execution_scope: "workspace",
      workspace_id,
      play_id: null,
      play_run_id: null,
      correlation_id: "cor-1",
      causation_id: null,
    },
  });
});

test("restate client: platform starts carry explicit platform scope without a tenant id", async () => {
  const { fetchImpl, calls } = spyFetch(() => ({
    headers: { "x-restate-id": "inv-platform" },
  }));
  const runtime = createRestateWorkflowRuntime({ ingressUrl: ingress, fetchImpl });

  const run = await runtime.start({
    execution_scope: "platform",
    workspace_id: null,
    workflow_name: "ingest_expire_sweep",
    input: {},
    idempotency_key: "maintenance:expire:2026-05-27",
  });

  assert.equal(run.execution_scope, "platform");
  assert.equal(run.workspace_id, null);
  assert.deepEqual(calls[0].body, {
    request: {},
    metadata: {
      execution_scope: "platform",
      workspace_id: null,
      play_id: null,
      play_run_id: null,
      correlation_id: null,
      causation_id: null,
    },
  });
});

test("restate client: idempotency_key is both workflow key and request idempotency header", async () => {
  const { fetchImpl, calls } = spyFetch(() => ({ body: { invocationId: "x" } }));
  const runtime = createRestateWorkflowRuntime({
    ingressUrl: ingress,
    fetchImpl,
  });
  runtime.register(
    defineWorkflow({ name: "demo", version: "1", async run() {} }),
  );
  await runtime.start({
    workspace_id: randomUUID(),
    workflow_name: "demo",
    input: null,
    idempotency_key: "key-1",
  });
  assert.equal(calls[0].headers["idempotency-key"], "key-1");
  assert.equal(calls[0].url, `${ingress}/demo/key-1/run/send`);
});

test("restate client: starts without an idempotency key receive distinct workflow keys", async () => {
  const { fetchImpl, calls } = spyFetch(() => ({ headers: { "x-restate-id": "x" } }));
  const runtime = createRestateWorkflowRuntime({ ingressUrl: ingress, fetchImpl });
  runtime.register(
    defineWorkflow({ name: "demo", version: "1", async run() {} }),
  );
  await runtime.start({
    workspace_id: randomUUID(),
    workflow_name: "demo",
    input: null,
  });
  await runtime.start({
    workspace_id: randomUUID(),
    workflow_name: "demo",
    input: null,
  });
  assert.match(calls[0].url, new RegExp(`^${ingress}/demo/[^/]+/run/send$`));
  assert.match(calls[1].url, new RegExp(`^${ingress}/demo/[^/]+/run/send$`));
  assert.notEqual(calls[0].url, calls[1].url);
});

test("restate client: get() maps Restate statuses to our WorkflowRunStatus", async () => {
  const cases: Array<{ restate: string; ours: string }> = [
    { restate: "Running", ours: "running" },
    { restate: "Suspended", ours: "awaiting_event" },
    { restate: "Completed", ours: "completed" },
    { restate: "Failed", ours: "failed" },
    { restate: "Cancelled", ours: "cancelled" },
    { restate: "wat", ours: "pending" },
  ];
  for (const c of cases) {
    const { fetchImpl } = spyFetch(() => ({
      body: { status: c.restate, output: { ok: true }, startedAt: "2026-01-01T00:00:00Z" },
    }));
    const runtime = createRestateWorkflowRuntime({
      ingressUrl: ingress,
      fetchImpl,
    });
    const run = await runtime.get("inv-1");
    assert.equal(run?.status, c.ours, `restate=${c.restate}`);
  }
});

test("restate client: get() returns null on 404 (unknown invocation)", async () => {
  const { fetchImpl } = spyFetch(() => ({ status: 404, body: { error: "not found" } }));
  const runtime = createRestateWorkflowRuntime({ ingressUrl: ingress, fetchImpl });
  assert.equal(await runtime.get("missing"), null);
});

test("restate client: get() rethrows non-404 errors as RestateClientError", async () => {
  const { fetchImpl } = spyFetch(() => ({ status: 500, body: { error: "boom" } }));
  const runtime = createRestateWorkflowRuntime({ ingressUrl: ingress, fetchImpl });
  await assert.rejects(runtime.get("anything"), RestateClientError);
});

test("restate client: resolveApproval POSTs the decision to the awakeable endpoint", async () => {
  const { fetchImpl, calls } = spyFetch(() => ({ status: 204 }));
  const runtime = createRestateWorkflowRuntime({ ingressUrl: ingress, fetchImpl });
  await runtime.resolveApproval("awk-1", {
    decision: "approved",
    decided_by: "user-1",
    note: "lgtm",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(
    calls[0].url,
    `${ingress}/restate/awakeables/awk-1/resolve`,
  );
  assert.deepEqual(calls[0].body, {
    decision: "approved",
    decided_by: "user-1",
    note: "lgtm",
  });
});

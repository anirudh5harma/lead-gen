import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  createRestateRuntimeProbeWorkflow,
  createRestateWorkflowRuntime,
  RESTATE_RUNTIME_PROBE_WORKFLOW,
  restateBearerFromEnv,
  type RestateRuntimeProbeInput,
  type RestateRuntimeProbeOutput,
  type WorkflowRun,
  type WorkflowRuntime,
} from "../core/substrate/workflows/index.ts";

interface RestateRuntimeProbeOptions {
  runtime?: WorkflowRuntime;
  marker?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  env?: Record<string, string | undefined>;
}

export interface RestateRuntimeProbeResult {
  ok: boolean;
  run_id: string;
  status: WorkflowRun["status"];
  detail: string;
  output?: RestateRuntimeProbeOutput;
}

const TERMINAL_STATUSES = new Set<WorkflowRun["status"]>([
  "completed",
  "failed",
  "cancelled",
]);

export async function runRestateRuntimeProbe(
  opts: RestateRuntimeProbeOptions = {},
): Promise<RestateRuntimeProbeResult> {
  const env = opts.env ?? process.env;
  const runtime = opts.runtime ?? runtimeFromEnv(env);
  const workflow = createRestateRuntimeProbeWorkflow();
  runtime.register(workflow);

  const marker = opts.marker ?? `probe-${randomUUID()}`;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = opts.timeoutMs ?? numberFromEnv(env.RESTATE_RUNTIME_PROBE_TIMEOUT_MS, 60_000);
  const pollIntervalMs = opts.pollIntervalMs
    ?? numberFromEnv(env.RESTATE_RUNTIME_PROBE_POLL_INTERVAL_MS, 1_000);
  const startedAt = now();

  const started = await runtime.start<RestateRuntimeProbeInput, RestateRuntimeProbeOutput>({
    workflow_name: RESTATE_RUNTIME_PROBE_WORKFLOW,
    execution_scope: "platform",
    workspace_id: null,
    idempotency_key: `runtime-probe:${marker}`,
    input: { marker },
  });

  let latest: WorkflowRun<RestateRuntimeProbeInput, RestateRuntimeProbeOutput> = started;
  while (!TERMINAL_STATUSES.has(latest.status)) {
    if (now() - startedAt >= timeoutMs) {
      return {
        ok: false,
        run_id: latest.id,
        status: latest.status,
        detail: `timed out after ${timeoutMs}ms waiting for ${RESTATE_RUNTIME_PROBE_WORKFLOW}`,
      };
    }
    await sleep(pollIntervalMs);
    latest = (await runtime.get<RestateRuntimeProbeInput, RestateRuntimeProbeOutput>(started.id)) ?? latest;
  }

  if (latest.status !== "completed") {
    return {
      ok: false,
      run_id: latest.id,
      status: latest.status,
      detail: latest.error?.message ?? `${RESTATE_RUNTIME_PROBE_WORKFLOW} did not complete`,
    };
  }

  if (
    latest.output?.marker !== marker ||
    latest.output?.checkpoint !== "ok"
  ) {
    return {
      ok: false,
      run_id: latest.id,
      status: latest.status,
      detail: "runtime probe completed with an unexpected output payload",
      output: latest.output,
    };
  }

  return {
    ok: true,
    run_id: latest.id,
    status: latest.status,
    detail: "runtime completed a durable checkpoint",
    output: latest.output,
  };
}

function runtimeFromEnv(env: Record<string, string | undefined>): WorkflowRuntime {
  const ingressUrl = env.RESTATE_INGRESS_URL?.trim();
  if (!ingressUrl) {
    throw new Error("RESTATE_INGRESS_URL is required");
  }
  return createRestateWorkflowRuntime({
    ingressUrl,
    bearer: restateBearerFromEnv(env),
  });
}

function numberFromEnv(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main(): Promise<void> {
  console.log("Restate runtime probe");
  try {
    const result = await runRestateRuntimeProbe();
    console.log(
      `  ${result.ok ? "OK  " : "FAIL"} ${RESTATE_RUNTIME_PROBE_WORKFLOW} — ${result.detail}`,
    );
    console.log(`  run_id: ${result.run_id}`);
    console.log(`  status: ${result.status}`);
    if (!result.ok) process.exit(1);
    console.log("\nRestate runtime verified.");
  } catch (err) {
    console.error(
      `  FAIL ${RESTATE_RUNTIME_PROBE_WORKFLOW} — ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

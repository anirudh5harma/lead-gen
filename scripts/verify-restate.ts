import { pathToFileURL } from "node:url";
import { restateBearerFromEnv } from "../core/substrate/workflows/index.ts";
import {
  summarizeRestateDeployments,
  type RestateDeploymentSummary,
} from "../core/product/health.ts";

interface RestateDeploymentsResponse {
  deployments?: Parameters<typeof summarizeRestateDeployments>[0]["deployments"];
}

const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

function record(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name} — ${detail}`);
}

function restateAdminUrl(): string | null {
  const explicit = process.env.RESTATE_ADMIN_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const ingress = process.env.RESTATE_INGRESS_URL?.trim();
  if (!ingress) return null;

  try {
    const url = new URL(ingress);
    url.port = "9070";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

async function requestAdmin(path: string): Promise<Response> {
  const base = restateAdminUrl();
  if (!base) throw new Error("RESTATE_ADMIN_URL or RESTATE_INGRESS_URL is required");

  const bearer = restateBearerFromEnv();
  const headers: Record<string, string> = {};
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  return fetch(`${base}${path}`, { headers });
}

async function main(): Promise<void> {
  console.log("Restate readiness checks");

  const admin = restateAdminUrl();
  record(
    "admin endpoint configured",
    Boolean(admin),
    admin ? "RESTATE_ADMIN_URL/derived admin endpoint is configured" : "missing Restate admin endpoint",
  );

  const bearer = restateBearerFromEnv();
  const cloudAdmin = admin ? new URL(admin).hostname.endsWith(".restate.cloud") : false;
  record(
    "admin bearer configured",
    !cloudAdmin || Boolean(bearer),
    cloudAdmin
      ? bearer
        ? "RESTATE_BEARER_TOKEN/RESTATE_AUTH_TOKEN is configured"
        : "Restate Cloud admin API requires RESTATE_BEARER_TOKEN"
      : "not required for non-Cloud admin endpoints",
  );

  if (!admin || (cloudAdmin && !bearer)) finish();

  let response: Response;
  try {
    response = await requestAdmin("/deployments");
  } catch (err) {
    record("admin deployments reachable", false, err instanceof Error ? err.message : String(err));
    finish();
    return;
  }

  const text = await response.text();
  record(
    "admin deployments reachable",
    response.ok,
    response.ok ? `HTTP ${response.status}` : `HTTP ${response.status}: ${text.slice(0, 300)}`,
  );
  if (!response.ok) finish();

  let payload: RestateDeploymentsResponse;
  try {
    payload = JSON.parse(text) as RestateDeploymentsResponse;
  } catch {
    record("admin deployments JSON", false, "response was not valid JSON");
    finish();
    return;
  }
  record("admin deployments JSON", true, "response parsed");

  const summary = summarizeRestateDeployments(payload);
  for (const deployment of summary.deployments) {
    record(
      `deployment ${deployment.id ?? "unknown"}`,
      true,
      `${deployment.uri ?? "unknown URI"} services: ${
        deployment.services.length ? deployment.services.join(", ") : "none"
      }`,
    );
  }
  record(
    "workflow services registered",
    summary.missing.length === 0,
    summary.missing.length === 0
      ? "all expected services are registered"
      : `missing: ${summary.missing.join(", ")}`,
  );
  record(
    "workflow deployments complete",
    summary.incompleteRequiredDeployments.length === 0,
    summary.incompleteRequiredDeployments.length === 0
      ? "every deployment that advertises required services has the full required workflow set"
      : summary.incompleteRequiredDeployments
          .map(
            (deployment) =>
              `${deployment.id ?? "unknown"}@${
                deployment.uri ?? "unknown"
              } missing ${deployment.missingRequiredServices.join(", ")}`,
          )
          .join("; "),
  );

  finish();
}

export { summarizeRestateDeployments, type RestateDeploymentSummary };

function finish(): never {
  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} Restate readiness check(s) failed.`);
    process.exit(1);
  }
  console.log("\nRestate deployment verified.");
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

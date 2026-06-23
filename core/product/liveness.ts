import { checkProductEnvironment } from "./env.ts";
import type {
  ProductReadiness,
  ProductReadinessCheck,
  ProductReadinessStatus,
} from "./health.ts";

export function checkProductLiveness(
  env: Record<string, string | undefined> = process.env,
): ProductReadiness {
  return formatReadiness([formatEnvironmentCheck(env)]);
}

function formatEnvironmentCheck(
  env: Record<string, string | undefined>,
): ProductReadinessCheck {
  const report = checkProductEnvironment(env);
  if (report.status === "ok") {
    return {
      name: "environment",
      status: "ok",
      detail:
        env.NODE_ENV === "production"
          ? "Required production environment configuration is present."
          : "Production key enforcement is active when NODE_ENV=production.",
    };
  }
  return {
    name: "environment",
    status: "degraded",
    detail: "Required production environment configuration is missing.",
  };
}

function formatReadiness(checks: ProductReadinessCheck[]): ProductReadiness {
  const status: ProductReadinessStatus = checks.some((check) => check.status === "degraded")
    ? "degraded"
    : checks.some((check) => check.status === "unconfigured")
      ? "unconfigured"
      : "ok";
  return {
    service: "bombsell-product",
    status,
    ready: status === "ok",
    checked_at: new Date().toISOString(),
    checks,
  };
}

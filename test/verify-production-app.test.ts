import { test } from "node:test";
import assert from "node:assert/strict";
import { runProductionAppSmoke } from "../scripts/verify-production-app.ts";

const origin = "https://www.bombsell.com";

function response(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function redirect(location: string, status = 307): Response {
  return new Response(null, {
    status,
    headers: { location },
  });
}

function healthPayload(extraChecks: Array<{ name: string; status: string; detail?: string }> = []) {
  return {
    service: "bombsell-product",
    status: extraChecks.length ? "degraded" : "ok",
    ready: extraChecks.length === 0,
    checks: [
      { name: "environment", status: "ok" },
      { name: "nats.credentials", status: "ok" },
      { name: "restate.ingress", status: "ok" },
      { name: "substrate", status: "ok" },
      { name: "database", status: "ok" },
      { name: "schema.tables", status: "ok" },
      { name: "schema.migrations", status: "ok" },
      ...extraChecks,
    ],
  };
}

test("production app smoke passes for a fully ready production app", async () => {
  const result = await runProductionAppSmoke({
    origin,
    fetchImpl: async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/health") return response(healthPayload());
      if (path === "/dashboard") return redirect("/auth/google?next=%2Fdashboard");
      if (path === "/onboarding") return redirect("/auth/google?next=%2Fonboarding");
      return new Response(null, { status: 404 });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(
    result.checks.find((check) => check.name === "health.ready")?.status,
    "ok",
  );
});

test("production app smoke allows only the known LinkedIn provider readiness gap", async () => {
  const result = await runProductionAppSmoke({
    origin,
    fetchImpl: async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/health") {
        return response(
          healthPayload([
            {
              name: "linkedin.provider",
              status: "degraded",
              detail: "Missing LinkedIn provider env keys",
            },
          ]),
          { status: 503 },
        );
      }
      if (path === "/dashboard") return redirect("/auth/google?next=%2Fdashboard");
      if (path === "/onboarding") return redirect("/auth/google?next=%2Fonboarding");
      return new Response(null, { status: 404 });
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.checks.filter((check) => check.status === "warn").map((check) => check.name),
    ["health.linkedin.provider"],
  );
});

test("production app smoke fails when dashboard does not go straight to Google OAuth", async () => {
  const result = await runProductionAppSmoke({
    origin,
    fetchImpl: async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/health") return response(healthPayload());
      if (path === "/dashboard") return redirect("/login?next=%2Fdashboard");
      if (path === "/onboarding") return redirect("/auth/google?next=%2Fonboarding");
      return new Response(null, { status: 404 });
    },
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.checks.find((check) => check.name === "auth/dashboard")?.status,
    "fail",
  );
});

test("production app smoke fails on unexpected degraded health checks", async () => {
  const result = await runProductionAppSmoke({
    origin,
    fetchImpl: async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/health") {
        return response(
          healthPayload([
            { name: "database", status: "degraded", detail: "connection failed" },
          ]),
        );
      }
      if (path === "/dashboard") return redirect("/auth/google?next=%2Fdashboard");
      if (path === "/onboarding") return redirect("/auth/google?next=%2Fonboarding");
      return new Response(null, { status: 404 });
    },
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.checks.find((check) => check.name === "health.degraded")?.status,
    "fail",
  );
});

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

function landingPage(html = ""): Response {
  return new Response(
    html || [
      '<a href="/auth/google?next=%2Fdashboard">Log in</a>',
      '<form action="/auth/start" method="GET"></form>',
      '<a href="/auth/google?next=%2Fonboarding">Get started free</a>',
    ].join(""),
    { status: 200, headers: { "Content-Type": "text/html" } },
  );
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

function protectedAuthResponse(path: string): Response | null {
  if (
    path === "/api/auth/outlook" ||
    path === "/api/auth/microsoft-mail/callback" ||
    path === "/api/auth/linkedin"
  ) {
    return new Response("authentication required", { status: 401 });
  }
  return null;
}

test("production app smoke passes for a fully ready production app", async () => {
  const result = await runProductionAppSmoke({
    origin,
    fetchImpl: async (url) => {
      const path = new URL(String(url)).pathname;
      const protectedResponse = protectedAuthResponse(path);
      if (protectedResponse) return protectedResponse;
      if (path === "/") return landingPage();
      if (path === "/api/health") return response(healthPayload());
      if (path === "/api/health/readiness") {
        return response({ error: "authentication required" }, { status: 401 });
      }
      if (path === "/dashboard") return redirect("/auth/google?next=%2Fdashboard");
      if (path === "/onboarding") return redirect("/auth/google?next=%2Fonboarding");
      return new Response(null, { status: 404 });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(
    result.checks.find((check) => check.name === "health.readiness.protected")?.status,
    "ok",
  );
});

test("production app smoke allows only the known LinkedIn provider readiness gap", async () => {
  const cookie = "sb-access-token=fake; sb-refresh-token=fake";
  const result = await runProductionAppSmoke({
    origin,
    authCookieHeader: cookie,
    fetchImpl: async (url, init) => {
      const path = new URL(String(url)).pathname;
      const requestCookie = new Headers(init?.headers).get("cookie");
      const signedIn = requestCookie === cookie;
      const protectedResponse = protectedAuthResponse(path);
      if (protectedResponse) return protectedResponse;
      if (path === "/") return landingPage();
      if (path === "/api/health") {
        return response(healthPayload());
      }
      if (path === "/api/health/readiness") {
        return signedIn
          ? response(
              healthPayload([
                {
                  name: "linkedin.provider",
                  status: "degraded",
                  detail: "Missing LinkedIn provider env keys",
                },
              ]),
              { status: 503 },
            )
          : response({ error: "authentication required" }, { status: 401 });
      }
      if (path === "/dashboard") {
        return signedIn
          ? new Response("<main>Brief</main>", {
              status: 200,
              headers: { "Content-Type": "text/html" },
            })
          : redirect("/auth/google?next=%2Fdashboard");
      }
      if (path === "/onboarding") {
        return signedIn
          ? redirect("/dashboard")
          : redirect("/auth/google?next=%2Fonboarding");
      }
      if (path === "/dashboard/health") {
        return signedIn
          ? new Response("<main>Health</main>", {
              status: 200,
              headers: { "Content-Type": "text/html" },
            })
          : redirect("/auth/google?next=%2Fdashboard%2Fhealth");
      }
      if (path === "/api/mcp") {
        return signedIn
          ? response({
              workspace_id: "00000000-0000-4000-8000-000000000001",
              tools: ["bombsell_brief_get"],
            })
          : response({ workspace_id: null, tools: [] }, { status: 401 });
      }
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
      const protectedResponse = protectedAuthResponse(path);
      if (protectedResponse) return protectedResponse;
      if (path === "/") return landingPage();
      if (path === "/api/health") return response(healthPayload());
      if (path === "/api/health/readiness") {
        return response({ error: "authentication required" }, { status: 401 });
      }
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

test("production app smoke fails when the landing page keeps stale auth entrypoints", async () => {
  const result = await runProductionAppSmoke({
    origin,
    fetchImpl: async (url) => {
      const path = new URL(String(url)).pathname;
      const protectedResponse = protectedAuthResponse(path);
      if (protectedResponse) return protectedResponse;
      if (path === "/") {
        return landingPage([
          '<a href="/login">Log in</a>',
          '<form action="/onboarding" method="GET"></form>',
        ].join(""));
      }
      if (path === "/api/health") return response(healthPayload());
      if (path === "/api/health/readiness") {
        return response({ error: "authentication required" }, { status: 401 });
      }
      if (path === "/dashboard") return redirect("/auth/google?next=%2Fdashboard");
      if (path === "/onboarding") return redirect("/auth/google?next=%2Fonboarding");
      return new Response(null, { status: 404 });
    },
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.checks.find((check) => check.name === "public.entry")?.status,
    "fail",
  );
});

test("production app smoke fails on unexpected degraded health checks", async () => {
  const cookie = "sb-access-token=fake; sb-refresh-token=fake";
  const result = await runProductionAppSmoke({
    origin,
    authCookieHeader: cookie,
    fetchImpl: async (url, init) => {
      const path = new URL(String(url)).pathname;
      const requestCookie = new Headers(init?.headers).get("cookie");
      const signedIn = requestCookie === cookie;
      const protectedResponse = protectedAuthResponse(path);
      if (protectedResponse) return protectedResponse;
      if (path === "/") return landingPage();
      if (path === "/api/health") {
        return response(healthPayload());
      }
      if (path === "/api/health/readiness") {
        return signedIn
          ? response(
              healthPayload([
                { name: "database", status: "degraded", detail: "connection failed" },
              ]),
            )
          : response({ error: "authentication required" }, { status: 401 });
      }
      if (path === "/dashboard") {
        return signedIn
          ? new Response("<main>Brief</main>", {
              status: 200,
              headers: { "Content-Type": "text/html" },
            })
          : redirect("/auth/google?next=%2Fdashboard");
      }
      if (path === "/onboarding") {
        return signedIn
          ? redirect("/dashboard")
          : redirect("/auth/google?next=%2Fonboarding");
      }
      if (path === "/dashboard/health") {
        return signedIn
          ? new Response("<main>Health</main>", {
              status: 200,
              headers: { "Content-Type": "text/html" },
            })
          : redirect("/auth/google?next=%2Fdashboard%2Fhealth");
      }
      if (path === "/api/mcp") {
        return signedIn
          ? response({
              workspace_id: "00000000-0000-4000-8000-000000000001",
              tools: ["bombsell_brief_get"],
            })
          : response({ workspace_id: null, tools: [] }, { status: 401 });
      }
      return new Response(null, { status: 404 });
    },
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.checks.find((check) => check.name === "health.degraded")?.status,
    "fail",
  );
});

test("production app smoke verifies a signed-in completed workspace session", async () => {
  const cookie = "sb-access-token=fake; sb-refresh-token=fake";
  const result = await runProductionAppSmoke({
    origin,
    authCookieHeader: cookie,
    fetchImpl: async (url, init) => {
      const path = new URL(String(url)).pathname;
      const requestCookie = new Headers(init?.headers).get("cookie");
      const signedIn = requestCookie === cookie;
      if (!signedIn) {
        const protectedResponse = protectedAuthResponse(path);
        if (protectedResponse) return protectedResponse;
      }
      if (path === "/") return landingPage();
      if (path === "/api/health") return response(healthPayload());
      if (path === "/api/health/readiness") {
        return signedIn
          ? response(healthPayload())
          : response({ error: "authentication required" }, { status: 401 });
      }
      if (path === "/dashboard") {
        return signedIn
          ? new Response("<main>Brief</main>", {
              status: 200,
              headers: { "Content-Type": "text/html" },
            })
          : redirect("/auth/google?next=%2Fdashboard");
      }
      if (path === "/onboarding") {
        return signedIn
          ? redirect("/dashboard")
          : redirect("/auth/google?next=%2Fonboarding");
      }
      if (path === "/dashboard/health") {
        return signedIn
          ? new Response("<main>Health</main>", {
              status: 200,
              headers: { "Content-Type": "text/html" },
            })
          : redirect("/auth/google?next=%2Fdashboard%2Fhealth");
      }
      if (path === "/api/mcp") {
        return signedIn
          ? response({
              workspace_id: "00000000-0000-4000-8000-000000000001",
              tools: ["bombsell_brief_get"],
            })
          : response({ workspace_id: null, tools: [] }, { status: 401 });
      }
      return new Response(null, { status: 404 });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(
    result.checks.find((check) => check.name === "auth.session/dashboard")?.status,
    "ok",
  );
  assert.equal(
    result.checks.find((check) => check.name === "auth.session/onboarding")?.status,
    "ok",
  );
  assert.equal(
    result.checks.find((check) => check.name === "auth.session/dashboard/health")?.status,
    "ok",
  );
  assert.equal(
    result.checks.find((check) => check.name === "auth.mcp.manifest")?.status,
    "ok",
  );
  assert.equal(
    result.checks.find((check) => check.name === "health.ready")?.status,
    "ok",
  );
});

test("production app smoke fails when a completed session still sees onboarding", async () => {
  const result = await runProductionAppSmoke({
    origin,
    authCookieHeader: "sb-access-token=fake",
    fetchImpl: async (url) => {
      const path = new URL(String(url)).pathname;
      const protectedResponse = protectedAuthResponse(path);
      if (protectedResponse) return protectedResponse;
      if (path === "/") return landingPage();
      if (path === "/api/health") return response(healthPayload());
      if (path === "/api/health/readiness") return response(healthPayload());
      if (path === "/dashboard") return new Response("<main>Brief</main>", { status: 200 });
      if (path === "/onboarding") {
        return new Response("<form>Company URL</form>", { status: 200 });
      }
      if (path === "/dashboard/health") return new Response("<main>Health</main>", { status: 200 });
      if (path === "/api/mcp") {
        return response({
          workspace_id: "00000000-0000-4000-8000-000000000001",
          tools: ["bombsell_brief_get"],
        });
      }
      return new Response(null, { status: 404 });
    },
  });

  assert.equal(result.ok, false);
  assert.match(
    result.checks.find((check) => check.name === "auth.session/onboarding")?.detail ?? "",
    /still sees onboarding/,
  );
});

test("production app smoke can verify MCP readiness discovery with a bearer token", async () => {
  const result = await runProductionAppSmoke({
    origin,
    bearerToken: "supabase-access-token",
    fetchImpl: async (url, init) => {
      const path = new URL(String(url)).pathname;
      const authorization = new Headers(init?.headers).get("authorization");
      const protectedResponse = protectedAuthResponse(path);
      if (protectedResponse) return protectedResponse;
      if (path === "/") return landingPage();
      if (path === "/api/health") return response(healthPayload());
      if (path === "/api/health/readiness") {
        return response({ error: "authentication required" }, { status: 401 });
      }
      if (path === "/dashboard") return redirect("/auth/google?next=%2Fdashboard");
      if (path === "/onboarding") return redirect("/auth/google?next=%2Fonboarding");
      if (path === "/api/mcp" && authorization === "Bearer supabase-access-token") {
        return response({
          workspace_id: "00000000-0000-4000-8000-000000000001",
          tools: ["bombsell_brief_get"],
        });
      }
      return new Response(null, { status: 404 });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(
    result.checks.find((check) => check.name === "auth.mcp.manifest")?.status,
    "ok",
  );
  assert.equal(
    result.checks.some((check) => check.name === "auth.session/dashboard"),
    false,
  );
});

test("production app smoke fails when Outlook OAuth starts without a workspace session", async () => {
  const result = await runProductionAppSmoke({
    origin,
    fetchImpl: async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/") return landingPage();
      if (path === "/api/health") return response(healthPayload());
      if (path === "/api/health/readiness") {
        return response({ error: "authentication required" }, { status: 401 });
      }
      if (path === "/dashboard") return redirect("/auth/google?next=%2Fdashboard");
      if (path === "/onboarding") return redirect("/auth/google?next=%2Fonboarding");
      if (path === "/api/auth/outlook") {
        return redirect("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
      }
      if (path === "/api/auth/linkedin") {
        return new Response("authentication required", { status: 401 });
      }
      return new Response(null, { status: 404 });
    },
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.checks.find((check) => check.name === "auth.outlook.protected")?.status,
    "fail",
  );
});

test("production app smoke fails when LinkedIn OAuth exposes provider setup before auth", async () => {
  const result = await runProductionAppSmoke({
    origin,
    fetchImpl: async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/") return landingPage();
      if (path === "/api/health") return response(healthPayload());
      if (path === "/api/health/readiness") {
        return response({ error: "authentication required" }, { status: 401 });
      }
      if (path === "/dashboard") return redirect("/auth/google?next=%2Fdashboard");
      if (path === "/onboarding") return redirect("/auth/google?next=%2Fonboarding");
      if (path === "/api/auth/outlook") {
        return new Response("authentication required", { status: 401 });
      }
      if (path === "/api/auth/linkedin") {
        return new Response("LINKEDIN_PROVIDER_AUTH_URL is not set", { status: 500 });
      }
      return new Response(null, { status: 404 });
    },
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.checks.find((check) => check.name === "auth.linkedin.protected")?.status,
    "fail",
  );
});

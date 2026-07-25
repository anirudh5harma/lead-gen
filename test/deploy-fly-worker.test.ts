import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectFlyWorkerSecrets,
  normalizePersistentWorkerDatabaseUrl,
  parseFlyAppName,
  registerRestateDeployment,
  restateAdminUrl,
} from "../scripts/deploy-fly-worker.ts";
import { REQUIRED_RESTATE_SERVICES } from "../core/product/health.ts";

test("deploy fly worker parses app name from fly.toml", () => {
  assert.equal(parseFlyAppName('app = "bombsell-production-worker"\n'), "bombsell-production-worker");
  assert.equal(parseFlyAppName("primary_region = \"iad\"\n"), null);
});

test("deploy fly worker collects required and optional secrets", () => {
  const result = collectFlyWorkerSecrets({
    APP_ORIGIN: "https://www.bombsell.com",
    CREDENTIALS_ENCRYPTION_KEY: "base64-secret",
    DATABASE_URL: "postgresql://db",
    DEEPSEEK_API_KEY: "ds",
    EXA_API_KEY: "exa",
    FIRECRAWL_API_KEY: "fc",
    MICROSOFT_CLIENT_ID: "ms-id",
    MICROSOFT_CLIENT_SECRET: "ms-secret",
    NATS_URL: "nats://example",
    OPENAI_API_KEY: "openai",
    RESTATE_AUTH_TOKEN: "restate-token",
    RESTATE_INGRESS_URL: "https://restate.example.com",
    NATS_STREAM_MAX_BYTES: "1024",
    LINKEDIN_PROVIDER_URL: "https://linkedin.example.com",
    ZEROBOUNCE_API_KEY: "zb",
  });

  assert.deepEqual(result.missingRequiredKeys, []);
  assert.deepEqual(result.missingRecommendedKeys, []);
  assert.deepEqual(
    result.secrets.map((entry) => entry.key),
    [
      "APP_ORIGIN",
      "CREDENTIALS_ENCRYPTION_KEY",
      "DATABASE_URL",
      "DEEPSEEK_API_KEY",
      "EXA_API_KEY",
      "FIRECRAWL_API_KEY",
      "LINKEDIN_PROVIDER_URL",
      "MICROSOFT_CLIENT_ID",
      "MICROSOFT_CLIENT_SECRET",
      "NATS_STREAM_MAX_BYTES",
      "NATS_URL",
      "OPENAI_API_KEY",
      "RESTATE_AUTH_TOKEN",
      "RESTATE_INGRESS_URL",
      "ZEROBOUNCE_API_KEY",
    ],
  );
});

test("deploy fly worker reports missing conditional worker providers", () => {
  const result = collectFlyWorkerSecrets({
    APP_ORIGIN: "https://www.bombsell.com",
    DATABASE_URL: "postgresql://db",
    DEEPSEEK_API_KEY: "ds",
    MICROSOFT_CLIENT_ID: "ms-id",
    MICROSOFT_CLIENT_SECRET: "ms-secret",
    NATS_URL: "nats://example",
    OPENAI_API_KEY: "openai",
    RESTATE_INGRESS_URL: "https://restate.example.com",
  });

  assert.deepEqual(result.missingRequiredKeys, [
    "CREDENTIALS_ENCRYPTION_KEY",
    "HUNTER_API_KEY | EXA_API_KEY",
    "HUNTER_API_KEY | ZEROBOUNCE_API_KEY",
    "RESTATE_BEARER_TOKEN | RESTATE_AUTH_TOKEN",
  ]);
  assert.deepEqual(result.missingRecommendedKeys, ["FIRECRAWL_API_KEY"]);
});

test("deploy fly worker switches persistent Supabase connections to session mode", () => {
  assert.equal(
    normalizePersistentWorkerDatabaseUrl(
      "postgresql://user:pass@aws-1.pooler.supabase.com:6543/postgres",
    ),
    "postgresql://user:pass@aws-1.pooler.supabase.com:5432/postgres",
  );
  assert.equal(
    normalizePersistentWorkerDatabaseUrl("postgresql://db.example.com:6543/postgres"),
    "postgresql://db.example.com:6543/postgres",
  );
});

test("deploy fly worker derives the Restate Cloud admin endpoint", () => {
  assert.equal(
    restateAdminUrl({
      RESTATE_INGRESS_URL: "https://tenant.env.us.restate.cloud:8080",
    }),
    "https://tenant.env.us.restate.cloud:9070",
  );
});

test("deploy fly worker registers and validates the complete Restate contract", async () => {
  let request: { input: string; init?: RequestInit } | undefined;
  const result = await registerRestateDeployment(
    "https://worker.example.com",
    {
      RESTATE_INGRESS_URL: "https://tenant.env.us.restate.cloud:8080",
      RESTATE_AUTH_TOKEN: "secret",
    },
    async (input, init) => {
      request = { input: String(input), init };
      return new Response(
        JSON.stringify({
          services: REQUIRED_RESTATE_SERVICES.map((name) => ({ name })),
        }),
        { status: 200 },
      );
    },
  );

  assert.equal(result.serviceCount, REQUIRED_RESTATE_SERVICES.length);
  assert.equal(request?.input, "https://tenant.env.us.restate.cloud:9070/deployments");
  assert.equal(request?.init?.method, "POST");
  assert.match(String(request?.init?.body), /https:\/\/worker\.example\.com\//);
  assert.equal(
    (request?.init?.headers as Record<string, string>).Authorization,
    "Bearer secret",
  );
});

test("deploy fly worker fails registration when a required service is absent", async () => {
  await assert.rejects(
    registerRestateDeployment(
      "https://worker.example.com",
      {
        RESTATE_ADMIN_URL: "https://tenant.env.us.restate.cloud:9070",
        RESTATE_BEARER_TOKEN: "secret",
      },
      async () =>
        new Response(JSON.stringify({ services: [] }), { status: 200 }),
    ),
    /omitted required services/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { checkProductReadiness } from "../core/product/health.ts";
import { setupPg } from "./_pg.ts";

test("product health: reports unconfigured when no pool is provided", async () => {
  const readiness = await checkProductReadiness(null);

  assert.equal(readiness.status, "unconfigured");
  assert.equal(readiness.ready, false);
  assert.equal(readiness.checks[0].name, "database");
});

test("product health: reports ready against a migrated schema", async (t) => {
  const fx = await setupPg("product_health");
  if (!fx) return t.skip("DATABASE_URL not set");

  try {
    const readiness = await checkProductReadiness(fx.pool);

    assert.equal(readiness.status, "ok");
    assert.equal(readiness.ready, true);
    assert.deepEqual(
      readiness.checks.map((check) => check.status),
      ["ok", "ok", "ok", "ok", "ok", "ok", "ok"],
    );
  } finally {
    await fx.close();
  }
});

test("product health: NGS NATS requires complete creds in production", async () => {
  const readiness = await checkProductReadiness(readyPool(), {
    NODE_ENV: "production",
    NATS_URL: "tls://connect.ngs.global",
    NATS_CREDS: "-----BEGIN NATS USER JWT-----",
    RESTATE_INGRESS_URL: "https://restate.example",
  });

  assert.equal(readiness.ready, false);
  const nats = readiness.checks.find((check) => check.name === "nats.credentials");
  assert.equal(nats?.status, "degraded");
  assert.match(nats?.detail ?? "", /user NKEY seed/);
});

test("product health: production NATS Restate mode verifies live NATS auth", async () => {
  const readiness = await checkProductReadiness(
    readyPool(),
    { ...productionEnv(), BOMBSELL_SUBSTRATE: "nats_restate" },
    {
      probeNatsConnection: async () => {
        throw new Error("BAD_CREDS");
      },
    },
  );

  assert.equal(readiness.ready, false);
  const nats = readiness.checks.find((check) => check.name === "nats.credentials");
  assert.equal(nats?.status, "degraded");
  assert.match(nats?.detail ?? "", /BAD_CREDS/);
});

test("product health: production NATS Restate mode is ready when NATS probe passes", async () => {
  const readiness = await checkProductReadiness(
    readyPool(),
    {
      ...productionEnv(),
      BOMBSELL_SUBSTRATE: "nats_restate",
      RESTATE_INGRESS_URL: "https://tenant.env.us.restate.cloud:8080",
      RESTATE_BEARER_TOKEN: "restate-token",
    },
    { probeNatsConnection: async () => undefined },
  );

  assert.equal(readiness.ready, true);
  const nats = readiness.checks.find((check) => check.name === "nats.credentials");
  assert.equal(nats?.status, "ok");
  assert.match(nats?.detail ?? "", /authenticated/);
});

test("product health: production Restate Cloud ingress requires bearer token", async () => {
  const readiness = await checkProductReadiness(
    readyPool(),
    {
      ...productionEnv(),
      BOMBSELL_SUBSTRATE: "nats_restate",
      RESTATE_INGRESS_URL: "https://tenant.env.us.restate.cloud:8080",
    },
    { probeNatsConnection: async () => undefined },
  );

  assert.equal(readiness.ready, false);
  const restate = readiness.checks.find((check) => check.name === "restate.ingress");
  assert.equal(restate?.status, "degraded");
  assert.match(restate?.detail ?? "", /RESTATE_BEARER_TOKEN/);
});

test("product health: production degrades while product substrate uses Postgres bridge", async () => {
  const readiness = await checkProductReadiness(readyPool(), productionEnv());

  assert.equal(readiness.ready, false);
  const substrate = readiness.checks.find((check) => check.name === "substrate");
  assert.equal(substrate?.status, "degraded");
  assert.match(substrate?.detail ?? "", /Postgres event bus \+ workflow journal bridge/);
});

test("product health: production env gaps degrade readiness", async () => {
  const readiness = await checkProductReadiness(null, {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://example",
  });

  assert.equal(readiness.ready, false);
  const environment = readiness.checks.find((check) => check.name === "environment");
  assert.equal(environment?.status, "degraded");
  assert.match(environment?.detail ?? "", /NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(environment?.detail ?? "", /RESEND_WEBHOOK_SECRET/);
});

test("product health: reports unsupported substrate configuration", async (t) => {
  const fx = await setupPg("product_health_substrate");
  if (!fx) return t.skip("DATABASE_URL not set");

  const original = process.env.BOMBSELL_SUBSTRATE;
  process.env.BOMBSELL_SUBSTRATE = "restate";
  try {
    const readiness = await checkProductReadiness(fx.pool);

    assert.equal(readiness.status, "degraded");
    assert.equal(readiness.ready, false);
    const substrate = readiness.checks.find((check) => check.name === "substrate");
    assert.equal(substrate?.status, "degraded");
    assert.match(substrate?.detail ?? "", /Unsupported BOMBSELL_SUBSTRATE=restate/);
  } finally {
    if (original === undefined) {
      delete process.env.BOMBSELL_SUBSTRATE;
    } else {
      process.env.BOMBSELL_SUBSTRATE = original;
    }
    await fx.close();
  }
});

function readyPool(): Pool {
  return {
    query: async () => ({ rows: [] }),
  } as unknown as Pool;
}

function productionEnv(): Record<string, string> {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://example",
    APP_ORIGIN: "https://example.com",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SESSION_SECRET: "secret",
    CREDENTIALS_ENCRYPTION_KEY: "key",
    DEEPSEEK_API_KEY: "sk",
    OPENAI_API_KEY: "sk",
    RESEND_API_KEY: "re",
    RESEND_WEBHOOK_SECRET: "whsec",
    AWS_REGION: "us-east-1",
    AWS_SNS_TOPIC_ARNS: "arn:aws:sns:us-east-1:123456789012:bombsell-ses-events",
    MICROSOFT_CLIENT_ID: "client",
    MICROSOFT_CLIENT_SECRET: "secret",
    MICROSOFT_REDIRECT_URI: "https://example.com/api/auth/outlook/callback",
    NATS_URL: "tls://connect.ngs.global",
    NATS_CREDS:
      "-----BEGIN NATS USER JWT-----\nxxx\n------END NATS USER JWT------\n" +
      "-----BEGIN USER NKEY SEED-----\nSUxxx\n------END USER NKEY SEED------",
    RESTATE_INGRESS_URL: "https://restate.example",
    MAINTENANCE_TRIGGER_SECRET: "secret",
  };
}

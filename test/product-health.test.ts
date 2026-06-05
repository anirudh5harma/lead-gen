import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import {
  REQUIRED_RESTATE_SERVICES,
  checkProductReadiness,
  checkProductReadinessCached,
  resetProductReadinessCacheForTests,
} from "../core/product/health.ts";
import { checkProductLiveness } from "../core/product/liveness.ts";
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
      ["ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok"],
    );
  } finally {
    await fx.close();
  }
});

test("product health: Restate readiness covers critical Play and channel workflows", () => {
  for (const workflow of [
    "play.signal_to_email.v1",
    "play.signal_to_linkedin.v1",
    "play.reply_to_email.v1",
    "channel.email_domain_provision.v1",
    "channel.email_domain_warmup.v1",
  ]) {
    assert.ok(
      REQUIRED_RESTATE_SERVICES.includes(workflow),
      `expected readiness to require ${workflow}`,
    );
  }
});

test("product health: liveness stays on the cheap environment boundary", () => {
  const liveness = checkProductLiveness(productionEnv());

  assert.equal(liveness.ready, true);
  assert.deepEqual(
    liveness.checks.map((check) => check.name),
    ["environment"],
  );
});

test("product health: cached readiness reuses recent expensive probes", async () => {
  resetProductReadinessCacheForTests();
  let natsProbeCalls = 0;
  let restateIngressProbeCalls = 0;
  let restateServiceProbeCalls = 0;
  let linkedInProbeCalls = 0;
  const options = {
    pool: readyPool(),
    env: {
      ...productionEnv(),
      BOMBSELL_SUBSTRATE: "nats_restate",
      RESTATE_INGRESS_URL: "https://tenant.env.us.restate.cloud:8080",
      RESTATE_AUTH_TOKEN: "valid-token",
    },
    deps: {
      probeNatsConnection: async () => {
        natsProbeCalls += 1;
      },
      probeRestateIngress: async () => {
        restateIngressProbeCalls += 1;
      },
      probeRestateServices: async () => {
        restateServiceProbeCalls += 1;
      },
      probeLinkedInProvider: async () => {
        linkedInProbeCalls += 1;
      },
    },
    ttlMs: 1_000,
  };

  try {
    const first = await checkProductReadinessCached(options);
    const second = await checkProductReadinessCached(options);
    const fresh = await checkProductReadinessCached({ ...options, forceRefresh: true });

    assert.equal(first.ready, true);
    assert.equal(second, first);
    assert.equal(fresh.ready, true);
    assert.equal(natsProbeCalls, 2);
    assert.equal(restateIngressProbeCalls, 2);
    assert.equal(restateServiceProbeCalls, 2);
    assert.equal(linkedInProbeCalls, 2);
  } finally {
    resetProductReadinessCacheForTests();
  }
});

test("product health: default cached readiness avoids live provider probes", async () => {
  resetProductReadinessCacheForTests();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("default cached readiness should not fetch");
  }) as typeof fetch;

  try {
    const readiness = await checkProductReadinessCached({
      pool: readyPool(),
      env: {
        ...productionEnv(),
        BOMBSELL_SUBSTRATE: "nats_restate",
        RESTATE_INGRESS_URL: "https://tenant.env.us.restate.cloud:8080",
        RESTATE_AUTH_TOKEN: "valid-token",
      },
      ttlMs: 0,
    });

    assert.equal(readiness.ready, true);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    resetProductReadinessCacheForTests();
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
      probeRestateIngress: async () => undefined,
      probeRestateServices: async () => undefined,
      probeLinkedInProvider: async () => undefined,
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
    {
      probeNatsConnection: async () => undefined,
      probeRestateIngress: async () => undefined,
      probeRestateServices: async () => undefined,
      probeLinkedInProvider: async () => undefined,
    },
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
    {
      probeNatsConnection: async () => undefined,
      probeRestateIngress: async () => undefined,
      probeRestateServices: async () => undefined,
      probeLinkedInProvider: async () => undefined,
    },
  );

  assert.equal(readiness.ready, false);
  const restate = readiness.checks.find((check) => check.name === "restate.ingress");
  assert.equal(restate?.status, "degraded");
  assert.match(restate?.detail ?? "", /RESTATE_BEARER_TOKEN/);
});

test("product health: production NATS Restate mode verifies live Restate auth", async () => {
  const readiness = await checkProductReadiness(
    readyPool(),
    {
      ...productionEnv(),
      BOMBSELL_SUBSTRATE: "nats_restate",
      RESTATE_INGRESS_URL: "https://tenant.env.us.restate.cloud:8080",
      RESTATE_AUTH_TOKEN: "admin-only-token",
    },
    {
      probeNatsConnection: async () => undefined,
      probeRestateIngress: async () => {
        throw new Error("HTTP 403");
      },
      probeRestateServices: async () => undefined,
      probeLinkedInProvider: async () => undefined,
    },
  );

  assert.equal(readiness.ready, false);
  const restate = readiness.checks.find((check) => check.name === "restate.ingress");
  assert.equal(restate?.status, "degraded");
  assert.match(restate?.detail ?? "", /HTTP 403/);
});

test("product health: production NATS Restate mode verifies registered services", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    assert.equal(String(input), "https://tenant.env.us.restate.cloud:9070/deployments");
    return new Response(
      JSON.stringify({
        deployments: [
          {
            id: "dp_old",
            uri: "https://old-worker.example.com/",
            services: [
              { name: "series_a_cold_open" },
              { name: "ingest_workspace_poll" },
            ],
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const readiness = await checkProductReadiness(
      readyPool(),
      {
        ...productionEnv(),
        BOMBSELL_SUBSTRATE: "nats_restate",
        RESTATE_INGRESS_URL: "https://tenant.env.us.restate.cloud:8080",
        RESTATE_AUTH_TOKEN: "valid-token",
      },
      {
        probeNatsConnection: async () => undefined,
        probeRestateIngress: async () => undefined,
        probeLinkedInProvider: async () => undefined,
      },
    );

    assert.equal(readiness.ready, false);
    const restate = readiness.checks.find((check) => check.name === "restate.ingress");
    assert.equal(restate?.status, "degraded");
    assert.match(restate?.detail ?? "", /missing workflow services/);
    assert.match(restate?.detail ?? "", /https:\/\/old-worker\.example\.com/);
    assert.match(restate?.detail ?? "", /series_a_cold_open/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("product health: production degrades on stale partial Restate deployments", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    assert.equal(String(input), "https://tenant.env.us.restate.cloud:9070/deployments");
    return new Response(
      JSON.stringify({
        deployments: [
          {
            id: "dp_new",
            uri: "https://new-worker.example.com/",
            services: REQUIRED_RESTATE_SERVICES.map((name) => ({ name })),
          },
          {
            id: "dp_old",
            uri: "https://old-worker.example.com/",
            services: [
              { name: "series_a_cold_open" },
              { name: "ingest_workspace_poll" },
            ],
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const readiness = await checkProductReadiness(
      readyPool(),
      {
        ...productionEnv(),
        BOMBSELL_SUBSTRATE: "nats_restate",
        RESTATE_INGRESS_URL: "https://tenant.env.us.restate.cloud:8080",
        RESTATE_AUTH_TOKEN: "valid-token",
      },
      {
        probeNatsConnection: async () => undefined,
        probeRestateIngress: async () => undefined,
        probeLinkedInProvider: async () => undefined,
      },
    );

    assert.equal(readiness.ready, false);
    const restate = readiness.checks.find((check) => check.name === "restate.ingress");
    assert.equal(restate?.status, "degraded");
    assert.match(restate?.detail ?? "", /incomplete workflow deployments/);
    assert.match(restate?.detail ?? "", /https:\/\/old-worker\.example\.com/);
    assert.match(restate?.detail ?? "", /play\.signal_to_email\.v1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("product health: production degrades while product substrate uses Postgres bridge", async () => {
  const readiness = await checkProductReadiness(
    readyPool(),
    productionEnv(),
    { probeLinkedInProvider: async () => undefined },
  );

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

test("product health: production reports missing LinkedIn provider config", async () => {
  const env = productionEnv();
  delete env.LINKEDIN_PROVIDER_URL;
  delete env.LINKEDIN_PROVIDER_HEALTH_URL;
  delete env.LINKEDIN_PROVIDER_API_KEY;
  delete env.LINKEDIN_PROVIDER_WEBHOOK_SECRET;

  const readiness = await checkProductReadiness(readyPool(), {
    ...env,
    BOMBSELL_SUBSTRATE: "nats_restate",
  }, {
    probeNatsConnection: async () => undefined,
    probeRestateIngress: async () => undefined,
    probeRestateServices: async () => undefined,
    probeLinkedInProvider: async () => undefined,
  });

  assert.equal(readiness.ready, false);
  const linkedin = readiness.checks.find((check) => check.name === "linkedin.provider");
  assert.equal(linkedin?.status, "degraded");
  assert.match(linkedin?.detail ?? "", /LINKEDIN_PROVIDER_URL/);
  assert.match(linkedin?.detail ?? "", /LINKEDIN_PROVIDER_HEALTH_URL/);
});

test("product health: production requires HTTPS LinkedIn provider URLs", async () => {
  const readiness = await checkProductReadiness(readyPool(), {
    ...productionEnv(),
    BOMBSELL_SUBSTRATE: "nats_restate",
    LINKEDIN_PROVIDER_URL: "http://provider.example/send",
  }, {
    probeNatsConnection: async () => undefined,
    probeRestateIngress: async () => undefined,
    probeRestateServices: async () => undefined,
    probeLinkedInProvider: async () => undefined,
  });

  assert.equal(readiness.ready, false);
  const linkedin = readiness.checks.find((check) => check.name === "linkedin.provider");
  assert.equal(linkedin?.status, "degraded");
  assert.match(linkedin?.detail ?? "", /HTTPS/);
});

test("product health: production verifies live LinkedIn provider health", async () => {
  const readiness = await checkProductReadiness(readyPool(), {
    ...productionEnv(),
    BOMBSELL_SUBSTRATE: "nats_restate",
  }, {
    probeNatsConnection: async () => undefined,
    probeRestateIngress: async () => undefined,
    probeRestateServices: async () => undefined,
    probeLinkedInProvider: async () => {
      throw new Error("HTTP 503");
    },
  });

  assert.equal(readiness.ready, false);
  const linkedin = readiness.checks.find((check) => check.name === "linkedin.provider");
  assert.equal(linkedin?.status, "degraded");
  assert.match(linkedin?.detail ?? "", /HTTP 503/);
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
    FIRECRAWL_API_KEY: "fc",
    EXA_API_KEY: "exa",
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
    LINKEDIN_PROVIDER_URL: "https://linkedin-provider.example/send",
    LINKEDIN_PROVIDER_HEALTH_URL: "https://linkedin-provider.example/health",
    LINKEDIN_PROVIDER_API_KEY: "provider-key",
    LINKEDIN_PROVIDER_WEBHOOK_SECRET: "webhook-secret",
  };
}

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  ProductEnvironmentError,
  PRODUCT_ENV_VARS,
  checkProductEnvironment,
  requireOutboundEmailExecutionEnvironment,
  resolveProductEmailTransportMode,
  resolveProductLinkedInTransportMode,
} from "../core/product/env.ts";

const ROOT = new URL("..", import.meta.url).pathname;

test("product env: production readiness reports missing required keys", () => {
  const report = checkProductEnvironment({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://example",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  });

  assert.equal(report.status, "degraded");
  assert.deepEqual(report.missingProductionKeys, [
    "APP_ORIGIN",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SESSION_SECRET",
    "CREDENTIALS_ENCRYPTION_KEY",
    "DEEPSEEK_API_KEY",
    "OPENAI_API_KEY",
    "FIRECRAWL_API_KEY",
    "EXA_API_KEY",
    "HUNTER_API_KEY",
    "RESEND_API_KEY",
    "RESEND_WEBHOOK_SECRET",
    "DODO_API_KEY",
    "DODO_WEBHOOK_SECRET",
    "DODO_PRODUCT_LAUNCH_MONTHLY",
    "DODO_PRODUCT_LAUNCH_ANNUAL",
    "DODO_BUSINESS_ID",
    "MICROSOFT_CLIENT_ID",
    "MICROSOFT_CLIENT_SECRET",
    "MICROSOFT_REDIRECT_URI",
    "NATS_URL",
    "RESTATE_INGRESS_URL",
    "MAINTENANCE_TRIGGER_SECRET",
  ]);
});

test("product env: local readiness does not require production secrets", () => {
  const report = checkProductEnvironment({ NODE_ENV: "development" });

  assert.equal(report.status, "ok");
  assert.deepEqual(report.missingProductionKeys, []);
});

test("product env: email transport can be dry-run only outside production", () => {
  assert.equal(
    resolveProductEmailTransportMode({ NODE_ENV: "development" }),
    "dry-run",
  );
  assert.equal(
    resolveProductEmailTransportMode({ NODE_ENV: "production" }),
    "unconfigured",
  );
  assert.equal(
    resolveProductEmailTransportMode({
      NODE_ENV: "production",
      RESEND_API_KEY: "re_live",
    }),
    "unconfigured",
  );
  assert.equal(
    resolveProductEmailTransportMode({
      NODE_ENV: "production",
      RESEND_API_KEY: "re_live",
      MANAGED_OWNED_DOMAIN_EMAIL_ENABLED: "1",
    }),
    "resend",
  );
});

test("product env: LinkedIn transport can be dry-run only outside production", () => {
  assert.equal(
    resolveProductLinkedInTransportMode({ NODE_ENV: "development" }),
    "dry-run",
  );
  assert.equal(
    resolveProductLinkedInTransportMode({ NODE_ENV: "production" }),
    "unconfigured",
  );
  assert.equal(
    resolveProductLinkedInTransportMode({
      NODE_ENV: "production",
      LINKEDIN_PROVIDER_URL: "https://provider.example/send",
      LINKEDIN_PROVIDER_API_KEY: "provider-key",
    }),
    "provider",
  );
});

test("product env: outbound email execution fails closed when production trust keys are absent", () => {
  assert.throws(
    () =>
      requireOutboundEmailExecutionEnvironment({
        NODE_ENV: "production",
        DEEPSEEK_API_KEY: "sk_live",
      }),
    (err) => {
      assert.ok(err instanceof ProductEnvironmentError);
      assert.deepEqual(err.missingKeys, [
        "MICROSOFT_CLIENT_ID",
        "MICROSOFT_CLIENT_SECRET",
      ]);
      return true;
    },
  );

  assert.doesNotThrow(() =>
    requireOutboundEmailExecutionEnvironment({ NODE_ENV: "development" }),
  );
});

test("product env: .env.example tracks every manifest key", () => {
  const example = readFileSync(join(ROOT, ".env.example"), "utf8");
  const missing = PRODUCT_ENV_VARS.map((item) => item.name).filter(
    (name) => !new RegExp(`^${name}=`, "m").test(example),
  );

  assert.deepEqual(missing, []);
});

// Ambient OS/runtime variables that are not product configuration and are
// intentionally excluded from the PRODUCT_ENV_VARS manifest.
const AMBIENT_ENV_ALLOWLIST = new Set(["HOME"]);

test("product env: runtime process.env keys are tracked in the manifest", () => {
  const documented = new Set(PRODUCT_ENV_VARS.map((item) => item.name));
  const used = new Set<string>();
  for (const file of runtimeFiles()) {
    const body = readFileSync(file, "utf8");
    for (const match of body.matchAll(/\bprocess\.env\.([A-Z0-9_]+)/g)) {
      used.add(match[1]);
    }
  }

  const missing = [...used]
    .filter((name) => !documented.has(name) && !AMBIENT_ENV_ALLOWLIST.has(name))
    .sort();
  assert.deepEqual(missing, []);
});

function runtimeFiles(): string[] {
  return ["app", "core", "scripts"].flatMap((dir) =>
    collectFiles(join(ROOT, dir)).filter((file) => file.endsWith(".ts") || file.endsWith(".tsx")),
  );
}

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...collectFiles(path));
    } else {
      out.push(path);
    }
  }
  return out;
}

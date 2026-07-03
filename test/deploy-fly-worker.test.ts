import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectFlyWorkerSecrets,
  parseFlyAppName,
} from "../scripts/deploy-fly-worker.ts";

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
  ]);
  assert.deepEqual(result.missingRecommendedKeys, ["FIRECRAWL_API_KEY"]);
});

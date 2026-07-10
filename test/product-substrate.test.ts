import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import {
  createProductSubstrate,
  resolveProductSubstrateMode,
} from "../core/product/substrate.ts";

test("product substrate: defaults to the supported durable postgres substrate", () => {
  assert.deepEqual(resolveProductSubstrateMode(undefined), {
    mode: "postgres",
    status: "ok",
    detail: "Postgres event bus + Postgres workflow journal",
  });
});

test("product substrate: supports production NATS + Restate mode", () => {
  assert.deepEqual(resolveProductSubstrateMode("nats_restate"), {
    mode: "nats_restate",
    status: "ok",
    detail: "Journaled NATS event bus + Restate workflow ingress",
  });
});

test("product substrate: production auto-promotes postgres to durable Restate mode when ingress is configured", () => {
  assert.deepEqual(
    resolveProductSubstrateMode("postgres", {
      NODE_ENV: "production",
      RESTATE_INGRESS_URL: "https://restate.example.com",
    }),
    {
      mode: "nats_restate",
      status: "ok",
      detail: "Production auto-promoted from postgres to durable Restate workflow ingress",
    },
  );
});

test("product substrate: rejects aspirational adapter modes explicitly", () => {
  const resolution = resolveProductSubstrateMode("nats");

  assert.equal(resolution.mode, null);
  assert.equal(resolution.status, "unsupported");
  assert.match(resolution.detail, /Unsupported BOMBSELL_SUBSTRATE=nats/);
  assert.match(resolution.detail, /Supported: postgres, nats_restate/);
});

test("product substrate: nats_restate web ingress does not require a NATS dial", async () => {
  const previousSubstrate = process.env.BOMBSELL_SUBSTRATE;
  const previousRestate = process.env.RESTATE_INGRESS_URL;
  const previousNats = process.env.NATS_URL;
  try {
    process.env.BOMBSELL_SUBSTRATE = "nats_restate";
    process.env.RESTATE_INGRESS_URL = "http://127.0.0.1:9080";
    delete process.env.NATS_URL;

    const substrate = await createProductSubstrate({} as Pool);

    assert.equal(substrate.mode, "nats_restate");
    await substrate.bus.close();
  } finally {
    restoreEnv("BOMBSELL_SUBSTRATE", previousSubstrate);
    restoreEnv("RESTATE_INGRESS_URL", previousRestate);
    restoreEnv("NATS_URL", previousNats);
  }
});

test("product substrate: production refuses the non-durable postgres bridge when Restate is unavailable", async () => {
  const previousSubstrate = process.env.BOMBSELL_SUBSTRATE;
  const previousRestate = process.env.RESTATE_INGRESS_URL;
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    process.env.BOMBSELL_SUBSTRATE = "postgres";
    delete process.env.RESTATE_INGRESS_URL;
    process.env.NODE_ENV = "production";

    await assert.rejects(
      () => createProductSubstrate({} as Pool),
      /Production requires the durable nats_restate substrate/,
    );
  } finally {
    restoreEnv("BOMBSELL_SUBSTRATE", previousSubstrate);
    restoreEnv("RESTATE_INGRESS_URL", previousRestate);
    restoreEnv("NODE_ENV", previousNodeEnv);
  }
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

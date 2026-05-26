import assert from "node:assert/strict";
import test from "node:test";
import { resolveProductSubstrateMode } from "../core/product/substrate.ts";

test("product substrate: defaults to the supported durable postgres substrate", () => {
  assert.deepEqual(resolveProductSubstrateMode(undefined), {
    mode: "postgres",
    status: "ok",
    detail: "Postgres event bus + Postgres workflow journal",
  });
});

test("product substrate: rejects aspirational adapter modes explicitly", () => {
  const resolution = resolveProductSubstrateMode("nats");

  assert.equal(resolution.mode, null);
  assert.equal(resolution.status, "unsupported");
  assert.match(resolution.detail, /Unsupported BOMBSELL_SUBSTRATE=nats/);
});

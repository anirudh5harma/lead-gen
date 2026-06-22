import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ENVIRONMENT_KEY_NAMES } from "../core/config/env.ts";

const root = join(import.meta.dirname, "..");

// System-provided variables read by scripts (e.g. shell/OS env). These are not
// product configuration, so they are not declared in the deployment contract.
const SYSTEM_ENV_VARS = new Set(["HOME"]);

function sourceFiles(path: string): string[] {
  return readdirSync(path).flatMap((entry) => {
    const full = join(path, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

test("environment example tracks the checked deployment contract", () => {
  const example = readFileSync(join(root, ".env.example"), "utf8");
  const supplied = new Set(
    Array.from(example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm), (match) => match[1]),
  );
  for (const key of ENVIRONMENT_KEY_NAMES) {
    assert.ok(supplied.has(key), `.env.example is missing ${key}`);
  }
});

test("runtime process.env reads are registered in the deployment contract", () => {
  const files = [
    ...sourceFiles(join(root, "app")),
    ...sourceFiles(join(root, "core")),
    ...sourceFiles(join(root, "lib")),
    ...sourceFiles(join(root, "scripts")),
    join(root, "proxy.ts"),
  ];
  const referenced = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      referenced.add(match[1]);
    }
  }
  for (const key of referenced) {
    if (SYSTEM_ENV_VARS.has(key)) continue;
    assert.ok(ENVIRONMENT_KEY_NAMES.has(key), `${key} is read but not tracked`);
  }
});

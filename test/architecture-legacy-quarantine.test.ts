import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  ".agents",
  ".codex",
  "build",
  "coverage",
  "legacy",
  "node_modules",
  "out",
]);

test("architecture: archived legacy code is not imported by pivot-v2 runtime", async () => {
  const offenders: string[] = [];

  for (const file of await sourceFiles(ROOT)) {
    const source = await readFile(file, "utf8");
    for (const specifier of importSpecifiers(source)) {
      if (pointsAtLegacy(file, specifier)) {
        offenders.push(`${relative(file)} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      files.push(...(await sourceFiles(path.join(dir, entry.name))));
      continue;
    }

    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(path.join(dir, entry.name));
    }
  }

  return files;
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^"'()]+?\s+from\s+)?["']([^"']+)["']/g,
    /\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }

  return specifiers;
}

function pointsAtLegacy(file: string, specifier: string): boolean {
  if (specifier === "legacy" || specifier.startsWith("legacy/")) return true;
  if (!specifier.startsWith(".")) return false;

  const resolved = path.resolve(path.dirname(file), specifier);
  const rel = relative(resolved);
  return rel === "legacy" || rel.startsWith("legacy/");
}

function relative(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

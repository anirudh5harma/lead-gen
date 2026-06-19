#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const pluginDir = "integrations/bombsell-claude-code";
const marketplaceDir = "integrations/bombsell-claude-code-marketplace";
const marketplaceFile = `${marketplaceDir}/.claude-plugin/marketplace.json`;

interface Marketplace {
  name?: unknown;
  plugins?: Array<{
    name?: unknown;
    version?: unknown;
    source?: {
      source?: unknown;
      url?: unknown;
      path?: unknown;
      sha?: unknown;
    };
  }>;
}

function main(): void {
  run("claude", ["plugin", "validate", "--strict", pluginDir]);
  run("claude", ["plugin", "validate", "--strict", marketplaceDir]);

  const marketplace = JSON.parse(readFileSync(marketplaceFile, "utf8")) as Marketplace;
  const plugin = marketplace.plugins?.find((item) => item.name === "bombsell");
  if (!plugin) {
    fail("Marketplace must contain the bombsell plugin entry.");
  }

  const source = plugin.source;
  if (marketplace.name !== "bombsell") {
    fail("Marketplace name must be bombsell.");
  }
  if (plugin.version !== "0.1.0") {
    fail("Marketplace plugin version must match the packaged plugin release.");
  }
  if (source?.source !== "git-subdir") {
    fail("Marketplace plugin source must use git-subdir.");
  }
  if (source?.url !== "https://github.com/anirudh5harma/lead-gen.git") {
    fail("Marketplace plugin source must point at the Bombsell repo.");
  }
  if (source?.path !== pluginDir) {
    fail(`Marketplace plugin path must be ${pluginDir}.`);
  }
  if (typeof source?.sha !== "string" || !/^[0-9a-f]{40}$/.test(source.sha)) {
    fail("Marketplace plugin source must be pinned to a 40-character commit SHA.");
  }

  run("git", ["cat-file", "-e", `${source.sha}^{commit}`]);
  console.log("Claude Code plugin and marketplace verified.");
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  if (result.error) {
    fail(`${command} ${args.join(" ")} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} exited with ${result.status ?? "unknown"}.`);
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

main();

#!/usr/bin/env node
/**
 * Live product activation smoke.
 *
 * This exercises the same backend path the onboarding form uses after Google
 * auth: website profile extraction, workspace creation, company graph memory,
 * Rep/ICP/Play setup, default signal sources, and one signal aggregator pass.
 *
 * Usage:
 *   npm run verify:activation -- https://www.bombsell.com
 *
 * By default the verification workspace is deleted after the counts are read.
 * Set KEEP_VERIFY_WORKSPACE=1 to inspect it in the app.
 */

import fs from "node:fs";
import { randomUUID } from "node:crypto";
import {
  analyzeCompanyWebsite,
} from "../core/product/company-profile.ts";
import {
  configureActivationSetup,
  configureDefaultSignalAggregator,
  configureIcpSegment,
  configureSignalEmailPlay,
  configureWorkspaceCompanyProfile,
  createProductWorkspaceForUser,
  resetProductEngineForTests,
  runWorkspaceSignalAggregatorOnce,
} from "../core/product/app.ts";
import { getPool } from "../core/substrate/storage/index.ts";

loadDotenvLocal();

const websiteUrl = process.argv[2] ?? "https://www.bombsell.com";
const companyHint = process.argv[3];

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Put it in .env.local or export it.");
  process.exit(1);
}

const userId =
  process.env.BOMBSELL_DEMO_USER_ID?.trim() ||
  `00000000-0000-4000-8000-${randomUUID().slice(24)}`;
const stamp = Date.now().toString(36);
const workspaceSlug = `activation-verify-${stamp}`;
const pool = getPool();
let workspaceId: string | null = null;

try {
  const profile = await analyzeCompanyWebsite({
    websiteUrl,
    companyHint,
    allowedIndustries: [
      "B2B SaaS",
      "AI",
      "Fintech",
      "Healthcare",
      "Developer tools",
      "Ecommerce",
      "Cybersecurity",
      "Other",
    ],
  });
  if (!profile) throw new Error("profile extraction returned null");

  const companyName = profile.company_name ?? companyHint ?? "Bombsell Workspace";
  const workspace = await createProductWorkspaceForUser(
    {
      name: `${companyName} GTM ${stamp}`,
      slug: workspaceSlug,
    },
    userId,
  );
  workspaceId = workspace.id;
  const session = { workspace_id: workspace.id, user_id: userId };

  const company = await configureWorkspaceCompanyProfile(
    {
      company_name: companyName,
      website_url: profile.website_url,
      industry: profile.industry,
      description: profile.description,
    },
    session,
  );

  const activation = await configureActivationSetup(
    {
      rep: {
        name: "Sampark",
        role: "sdr",
        voice: "Clear, specific, low-hype, and useful.",
        story: `Turns market movement around ${companyName} into careful founder-led conversations.`,
        daily_cap: 15,
        approval: "approve_first",
      },
      icp: {
        name: `${companyName} press and market signals`,
        description: `${profile.description} Match companies and people showing public momentum.`,
        signal_kind: "press_mention",
        match_threshold: 0.6,
        nice_to_haves: [
          `Relevant to ${companyName}`,
          profile.industry ? `Mentions ${profile.industry}` : "Clear market timing",
          "Fresh enough to justify outreach",
        ],
      },
      play: {
        signal_kind: "press_mention",
        daily_cap: 15,
        approval: "approve_first",
      },
      email: {
        display_name: "sampark@go.bombsell.com",
        daily_cap: 15,
      },
    },
    session,
  );

  const hiringIcp = await configureIcpSegment(
    {
      name: `${companyName} hiring signals`,
      description: `Hiring changes around ${profile.industry ?? "this market"}.`,
      signal_kind: "hiring",
      match_threshold: 0.6,
    },
    session,
  );
  await configureSignalEmailPlay(
    {
      rep_id: activation.rep_id,
      name: `${companyName} Hiring Signal Email`,
      signal_kind: "hiring",
      icp_name: hiringIcp.icp_id,
      daily_cap: 10,
      approval: "approve_first",
    },
    session,
  );

  const launchIcp = await configureIcpSegment(
    {
      name: `${companyName} launch signals`,
      description: `Launches around ${profile.industry ?? "this market"}.`,
      signal_kind: "product_launch",
      match_threshold: 0.6,
    },
    session,
  );
  await configureSignalEmailPlay(
    {
      rep_id: activation.rep_id,
      name: `${companyName} Launch Signal Email`,
      signal_kind: "product_launch",
      icp_name: launchIcp.icp_id,
      daily_cap: 10,
      approval: "approve_first",
    },
    session,
  );

  const sources = await configureDefaultSignalAggregator(
    {
      company_name: companyName,
      website_url: profile.website_url,
      industry: profile.industry,
      description: profile.description,
    },
    session,
  );
  const aggregator = await runWorkspaceSignalAggregatorOnce(
    { limit: Number(process.env.ACTIVATION_VERIFY_AGGREGATOR_LIMIT ?? 4) },
    session,
  );

  const counts = await pool.query(
    `select
       (select count(*)::int from graph_companies where workspace_id = $1) as companies,
       (select count(*)::int from reps where workspace_id = $1) as reps,
       (select count(*)::int from workspace_icps where workspace_id = $1) as icps,
       (select count(*)::int from plays where workspace_id = $1) as plays,
       (select count(*)::int from graph_sources where workspace_id = $1) as sources,
       (select count(*)::int from workflow_runs where workspace_id = $1) as workflow_runs,
       (select count(*)::int from events where workspace_id = $1) as events`,
    [workspace.id],
  );

  const result = {
    ok: true,
    workspace_id: workspace.id,
    workspace_slug: workspace.slug,
    kept: process.env.KEEP_VERIFY_WORKSPACE === "1",
    profile: {
      company_name: profile.company_name,
      domain: profile.domain,
      source: profile.source,
      has_firecrawl_key: Boolean(process.env.FIRECRAWL_API_KEY?.trim()),
    },
    company_id: company.company_id,
    rep_id: activation.rep_id,
    source_count: sources.source_count,
    aggregator,
    counts: counts.rows[0],
  };

  console.log(JSON.stringify(result, null, 2));

  if (process.env.KEEP_VERIFY_WORKSPACE !== "1") {
    await archiveVerifyWorkspace(workspace.id);
    workspaceId = null;
  }
  await resetProductEngineForTests();
  process.exit(0);
} catch (error) {
  if (process.env.KEEP_VERIFY_WORKSPACE !== "1") {
    if (workspaceId) {
      await archiveVerifyWorkspace(workspaceId).catch(() => {});
    } else {
      await pool.query(
        `update workspaces set archived_at = now() where slug = $1`,
        [workspaceSlug],
      ).catch(() => {});
    }
  }
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  await resetProductEngineForTests().catch(() => {});
  process.exit(1);
}

function loadDotenvLocal(): void {
  const path = ".env.local";
  if (!fs.existsSync(path)) return;
  const parsed = parseEnvFile(fs.readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] ??= value;
  }
}

async function archiveVerifyWorkspace(workspaceId: string): Promise<void> {
  await pool.query(`update workspaces set archived_at = now() where id = $1`, [workspaceId]);
}

function parseEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  const lines = text.split(/\n/);
  let key: string | null = null;
  let quote: string | null = null;
  let value: string[] = [];
  for (const raw of lines) {
    if (key && quote) {
      if (raw.endsWith(quote)) {
        value.push(raw.slice(0, -1));
        env[key] = value.join("\n");
        key = null;
        quote = null;
        value = [];
      } else {
        value.push(raw);
      }
      continue;
    }
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let nextValue = match[2];
    if (
      (nextValue.startsWith('"') && !nextValue.endsWith('"')) ||
      (nextValue.startsWith("'") && !nextValue.endsWith("'"))
    ) {
      key = match[1];
      quote = nextValue[0];
      value = [nextValue.slice(1)];
      continue;
    }
    if (
      (nextValue.startsWith('"') && nextValue.endsWith('"')) ||
      (nextValue.startsWith("'") && nextValue.endsWith("'"))
    ) {
      nextValue = nextValue.slice(1, -1);
    }
    env[match[1]] = nextValue;
  }
  return env;
}

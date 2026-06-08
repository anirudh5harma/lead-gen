#!/usr/bin/env node
/**
 * End-to-end outreach pipeline smoke.
 *
 * Local mode proves the durable signal -> contact resolution -> personalized
 * draft -> hot-path eval -> dry-run send -> Outcome learning path without
 * touching live inboxes. Strict mode additionally requires customer-connected
 * Outlook readiness, which is the launch-critical outbound path.
 */

import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import {
  CONTACT_RESOLUTION_WORKFLOW,
  createContactResolutionProviders,
  createContactResolutionWorkflow,
  type ContactResolutionInput,
  type ContactResolutionOutput,
} from "../core/contacts/index.ts";
import { runFirstVerticalSlice } from "../core/plays/index.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";
import {
  createInProcessWorkflowRuntime,
  type WorkflowRuntime,
} from "../core/substrate/workflows/index.ts";
import {
  runOutlookReadinessProbe,
  type OutlookReadinessProbeOptions,
} from "./verify-outlook-readiness.ts";

type ProbeStatus = "ok" | "warn" | "fail";

export interface OutreachPipelineProbeStep {
  name: string;
  status: ProbeStatus;
  detail: string;
}

export interface OutreachPipelineProbeResult {
  ok: boolean;
  strict: boolean;
  steps: OutreachPipelineProbeStep[];
}

export interface OutreachPipelineProbeOptions {
  strict?: boolean;
  env?: Record<string, string | undefined>;
  outlookPool?: OutlookReadinessProbeOptions["pool"];
  includeLocalPipeline?: boolean;
  liveProviderSmoke?: boolean;
  liveProviderRunner?: () => Promise<LiveProviderSmokeResult>;
}

interface ContactGraphRow {
  id: string;
  full_name: string;
  title: string | null;
  company_id: string;
  emails: string[];
  linkedin_url: string | null;
  properties: Record<string, unknown>;
  provenance: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

interface ContactFixtureResult {
  decision: ContactResolutionOutput["decision"];
  candidateNames: string[];
  selectedPersonId: string | null;
  providerOrder: string[];
  verifiedCount: number;
}

interface LiveProviderSmokeResult {
  decision: ContactResolutionOutput["decision"];
  candidateNames: string[];
  selectedPersonId: string | null;
  providerOrder: string[];
  verifiedCount: number;
  keptWorkspaceId: string | null;
}

export async function runOutreachPipelineProbe(
  opts: OutreachPipelineProbeOptions = {},
): Promise<OutreachPipelineProbeResult> {
  const env = opts.env ?? process.env;
  const strict = opts.strict ?? env.OUTREACH_PIPELINE_STRICT?.trim() === "1";
  const steps: OutreachPipelineProbeStep[] = [];

  const outlook = await runOutlookReadinessProbe({
    env,
    pool: opts.outlookPool,
  });
  steps.push({
    name: "connected_outlook_inbox",
    status: outlook.ok ? "ok" : strict ? "fail" : "warn",
    detail: outlook.ok
      ? `${outlook.connectedAccounts} connected Outlook account(s), ${outlook.activeSubscriptions} active reply-sync subscription(s)`
      : `Strict staging mode requires Outlook readiness; local mode continues with dry-run channel. ${outlook.steps
        .filter((step) => step.status === "fail")
        .map((step) => step.detail ?? step.label)
        .join(" | ")}`,
  });

  if (opts.includeLocalPipeline ?? true) {
    const contacts = await runContactResolutionFixture();
    steps.push({
      name: "top_three_contact_resolution",
      status: contacts.decision === "resolved" &&
          contacts.candidateNames.length === 3 &&
          contacts.providerOrder[0] === "graph_cache"
        ? "ok"
        : "fail",
      detail: contacts.decision === "resolved"
        ? `Selected ${contacts.candidateNames[0]} from ${contacts.candidateNames.join(", ")} via ${contacts.providerOrder.join(" -> ")}`
        : "Contact resolver did not produce a top-three candidate set",
    });

    const providerContacts = await runProviderWaterfallFixture();
    steps.push({
      name: "provider_waterfall_contact_resolution",
      status: providerContacts.decision === "resolved" &&
          providerContacts.candidateNames.length === 3 &&
          providerContacts.verifiedCount === 3 &&
          providerContacts.providerOrder.includes("probe.exa_people") &&
          providerContacts.providerOrder.includes("probe.hunter_verify")
        ? "ok"
        : "fail",
      detail: providerContacts.decision === "resolved"
        ? `Resolved ${providerContacts.candidateNames.join(", ")} through ${providerContacts.providerOrder.join(" -> ")} with ${providerContacts.verifiedCount} verified email(s)`
        : "Provider waterfall did not produce three verified contacts from an empty graph cache",
    });

    const vertical = await runPersonalizedVerticalSliceFixture();
    steps.push(...vertical);
  }

  const liveProviderSmoke =
    opts.liveProviderSmoke ?? env.OUTREACH_PIPELINE_LIVE_PROVIDER_SMOKE?.trim() === "1";
  if (liveProviderSmoke) {
    try {
      const live = opts.liveProviderRunner
        ? await opts.liveProviderRunner()
        : await runLiveProviderSmoke(env);
      const liveResolved = live.decision === "resolved" &&
        live.candidateNames.length === 3 &&
        live.verifiedCount === 3;
      steps.push({
        name: "live_provider_contact_resolution",
        status: liveResolved ? "ok" : "fail",
        detail: liveResolved
          ? `Resolved ${live.candidateNames.join(", ")} through ${live.providerOrder.join(" -> ")} with ${live.verifiedCount} verified email(s)${live.keptWorkspaceId ? `; kept workspace ${live.keptWorkspaceId}` : ""}`
          : `Live provider resolver did not produce three verified contacts; decision=${live.decision}, candidates=${live.candidateNames.length}, verified=${live.verifiedCount}`,
      });
    } catch (error) {
      steps.push({
        name: "live_provider_contact_resolution",
        status: "fail",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    ok: steps.every((step) => step.status !== "fail"),
    strict,
    steps,
  };
}

async function runLiveProviderSmoke(
  env: Record<string, string | undefined>,
): Promise<LiveProviderSmokeResult> {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for OUTREACH_PIPELINE_LIVE_PROVIDER_SMOKE=1");
  }
  const companyName = env.OUTREACH_PIPELINE_VERIFY_COMPANY_NAME?.trim();
  const companyDomain = env.OUTREACH_PIPELINE_VERIFY_COMPANY_DOMAIN?.trim();
  if (!companyName || !companyDomain) {
    throw new Error(
      "OUTREACH_PIPELINE_VERIFY_COMPANY_NAME and OUTREACH_PIPELINE_VERIFY_COMPANY_DOMAIN are required for live provider smoke",
    );
  }
  const pool = new Pool({ connectionString: databaseUrl });
  const workspaceId = randomUUID();
  const companyId = randomUUID();
  const signalId = randomUUID();
  const playId = randomUUID();
  const repId = randomUUID();
  const keepWorkspace = env.KEEP_VERIFY_WORKSPACE === "1";
  try {
    await seedLiveProviderSmokeRows(pool, {
      workspaceId,
      companyId,
      signalId,
      playId,
      repId,
      companyName,
      companyDomain,
    });
    const bus = createInMemoryEventBus();
    const runtime = createInProcessWorkflowRuntime({ bus });
    runtime.register(
      createContactResolutionWorkflow({
        pool,
        ...createContactResolutionProviders({ pool, env }),
      }),
    );
    const run = await runtime.start<ContactResolutionInput, ContactResolutionOutput>({
      workspace_id: workspaceId,
      workflow_name: CONTACT_RESOLUTION_WORKFLOW,
      input: {
        workspace_id: workspaceId,
        signal_id: signalId,
        company_id: companyId,
        play_id: playId,
        rep_id: repId,
        channel: "email",
        limit: 3,
      },
    });
    const completed = await waitForCompletedRun(runtime, run.id, 90_000);
    if (completed.status !== "completed") {
      throw new Error("Live provider contact resolution workflow did not complete");
    }
    const output = completed.output;
    if (!output) throw new Error("Live provider contact resolution returned no output");
    const resolved = bus.published.find((event) => event.event_type === "contact.resolved");
    return {
      decision: output.decision,
      candidateNames: output.candidates.map((candidate) => candidate.full_name),
      selectedPersonId: output.selected_person_id,
      verifiedCount: output.candidates.filter((candidate) =>
        candidate.verification.email_verified
      ).length,
      providerOrder: Array.isArray(resolved?.payload.provider_order)
        ? resolved.payload.provider_order.filter((provider): provider is string =>
          typeof provider === "string"
        )
        : [],
      keptWorkspaceId: keepWorkspace ? workspaceId : null,
    };
  } finally {
    if (!keepWorkspace) {
      await pool.query(`delete from workspaces where id = $1`, [workspaceId]).catch(() => {});
    }
    await pool.end();
  }
}

async function seedLiveProviderSmokeRows(
  pool: Pool,
  input: {
    workspaceId: string;
    companyId: string;
    signalId: string;
    playId: string;
    repId: string;
    companyName: string;
    companyDomain: string;
  },
): Promise<void> {
  await pool.query(
    `insert into workspaces (id, slug, name, settings)
     values ($1, $2, $3, $4::jsonb)`,
    [
      input.workspaceId,
      `outreach-verify-${Date.now().toString(36)}`,
      `Outreach Verify ${input.companyName}`,
      JSON.stringify({ mode: "outreach-provider-verify" }),
    ],
  );
  await pool.query(
    `insert into graph_companies (
       id, workspace_id, name, domain, industry, size_bucket, description, properties, provenance
     ) values (
       $1, $2, $3, $4, 'Unknown', null, $5, '{}'::jsonb, $6::jsonb
     )`,
    [
      input.companyId,
      input.workspaceId,
      input.companyName,
      input.companyDomain,
      `Temporary outreach verification target for ${input.companyName}.`,
      JSON.stringify({ source: "verify-outreach-pipeline" }),
    ],
  );
  await pool.query(
    `insert into signals (
       id, workspace_id, kind, title, content, url, novelty_key, novelty_score,
       freshness_at, audience_hint, match_score, match_reason,
       related_company_id, related_person_id, status, properties, provenance
     ) values (
       $1, $2, 'funding', $3, $4, null, $5, 0.9,
       now(), $6::jsonb, 0.9, $7,
       $8, null, 'matched', '{}'::jsonb, $9::jsonb
     )`,
    [
      input.signalId,
      input.workspaceId,
      `${input.companyName} live provider contact-resolution smoke`,
      `Find senior contacts at ${input.companyName} for a controlled outreach verification run.`,
      `outreach-verify:${input.companyDomain}:${Date.now()}`,
      JSON.stringify({
        icp_segment: "live-provider-smoke",
        confidence: 0.9,
        rationale: "Controlled verification of contact discovery and verification providers.",
      }),
      "Controlled live provider smoke for contact resolution.",
      input.companyId,
      JSON.stringify({ source: "verify-outreach-pipeline" }),
    ],
  );
  await pool.query(
    `insert into reps (
       id, workspace_id, name, role, status, persona, channels, autonomy, created_at, updated_at
     ) values (
       $1, $2, 'Verify Rep', 'sdr', 'active', $3::jsonb, array['email'], '{}'::jsonb, now(), now()
     )`,
    [
      input.repId,
      input.workspaceId,
      JSON.stringify({
        voice: "Clear and careful.",
        story: "Verifies contact resolution.",
        kpis: ["verified contacts"],
        do_not: ["Do not send."],
        samples: [],
      }),
    ],
  );
  await pool.query(
    `insert into plays (
       id, workspace_id, name, declaration, status, default_rep_id,
       compiled, autonomy, created_at, updated_at
     ) values (
       $1, $2, 'Verify Contact Resolution', $3, 'active', $4,
       $5::jsonb, '{}'::jsonb, now(), now()
     )`,
    [
      input.playId,
      input.workspaceId,
      `Resolve three verified email contacts at ${input.companyName} for a controlled no-send outreach smoke.`,
      input.repId,
      JSON.stringify({
        workflow: "play.signal_to_email.v1",
        channel: "email",
        trigger: { kind: "signal", filter: { kind: "funding" } },
      }),
    ],
  );
}

async function runContactResolutionFixture(): Promise<ContactFixtureResult> {
  const workspaceId = randomUUID();
  const signalId = randomUUID();
  const companyId = randomUUID();
  const playId = randomUUID();
  const repId = randomUUID();
  const now = new Date();
  const rows: ContactGraphRow[] = [
    contactRow({
      companyId,
      fullName: "Ava Founder",
      title: "Founder and CEO",
      email: "ava@example.com",
      now,
    }),
    contactRow({
      companyId,
      fullName: "Ben Revenue",
      title: "VP Revenue",
      email: "ben@example.com",
      now,
    }),
    contactRow({
      companyId,
      fullName: "Cara Growth",
      title: "Head of Growth",
      email: "cara@example.com",
      now,
    }),
  ];
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  runtime.register(
    createContactResolutionWorkflow({
      pool: contactRowsPool(rows),
      discoveryProviders: [],
    }),
  );

  const run = await runtime.start<ContactResolutionInput, ContactResolutionOutput>({
    workspace_id: workspaceId,
    workflow_name: CONTACT_RESOLUTION_WORKFLOW,
    input: {
      workspace_id: workspaceId,
      signal_id: signalId,
      company_id: companyId,
      play_id: playId,
      rep_id: repId,
      channel: "email",
      limit: 3,
    },
  });
  const completed = await waitForCompletedRun(runtime, run.id);
  const resolved = bus.published.find((event) => event.event_type === "contact.resolved");
  return {
    decision: completed.output?.decision ?? "deferred",
    candidateNames: completed.output?.candidates.map((candidate) => candidate.full_name) ?? [],
    selectedPersonId: completed.output?.selected_person_id ?? null,
    verifiedCount: completed.output?.candidates.filter((candidate) =>
      candidate.verification.email_verified
    ).length ?? 0,
    providerOrder: Array.isArray(resolved?.payload.provider_order)
      ? resolved.payload.provider_order.filter((provider): provider is string =>
        typeof provider === "string"
      )
      : [],
  };
}

async function runProviderWaterfallFixture(): Promise<ContactFixtureResult> {
  const workspaceId = randomUUID();
  const signalId = randomUUID();
  const companyId = randomUUID();
  const playId = randomUUID();
  const repId = randomUUID();
  const pool = new MutableContactRowsPool([]);
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  runtime.register(
    createContactResolutionWorkflow({
      pool: pool.asPool(),
      discoveryProviders: [{
        name: "probe.exa_people",
        async discover() {
          return [
            {
              full_name: "Devika Founder",
              title: "Founder and CEO",
              emails: ["devika@example.com"],
              linkedin_url: "https://www.linkedin.com/in/devika-founder",
              confidence: 0.96,
              source: "exa",
              evidence: { signal_fit: "executive owns the timing" },
            },
            {
              full_name: "Eshan Revenue",
              title: "VP Revenue",
              emails: ["eshan@example.com"],
              linkedin_url: "https://www.linkedin.com/in/eshan-revenue",
              confidence: 0.91,
              source: "exa",
              evidence: { signal_fit: "GTM owner" },
            },
            {
              full_name: "Farah Growth",
              title: "Head of Growth",
              emails: ["farah@example.com"],
              linkedin_url: "https://www.linkedin.com/in/farah-growth",
              confidence: 0.88,
              source: "exa",
              evidence: { signal_fit: "growth owner" },
            },
          ];
        },
      }],
      emailVerifier: {
        name: "probe.hunter_verify",
        async verify(email) {
          return {
            status: "valid",
            verified: true,
            confidence: 0.99,
            raw: { email },
          };
        },
      },
    }),
  );

  const run = await runtime.start<ContactResolutionInput, ContactResolutionOutput>({
    workspace_id: workspaceId,
    workflow_name: CONTACT_RESOLUTION_WORKFLOW,
    input: {
      workspace_id: workspaceId,
      signal_id: signalId,
      company_id: companyId,
      play_id: playId,
      rep_id: repId,
      channel: "email",
      limit: 3,
    },
  });
  const completed = await waitForCompletedRun(runtime, run.id);
  const resolved = bus.published.find((event) => event.event_type === "contact.resolved");
  const candidates = completed.output?.candidates ?? [];
  return {
    decision: completed.output?.decision ?? "deferred",
    candidateNames: candidates.map((candidate) => candidate.full_name),
    selectedPersonId: completed.output?.selected_person_id ?? null,
    verifiedCount: candidates.filter((candidate) => candidate.verification.email_verified).length,
    providerOrder: Array.isArray(resolved?.payload.provider_order)
      ? resolved.payload.provider_order.filter((provider): provider is string =>
        typeof provider === "string"
      )
      : [],
  };
}

async function runPersonalizedVerticalSliceFixture(): Promise<OutreachPipelineProbeStep[]> {
  const writerPrompts: string[] = [];
  const result = await runFirstVerticalSlice({
    workspaceContextMarkdown:
      "# Targeting Workspace\n\nBombsell helps GTM teams act on timely market signals with careful, outcome-learning outreach.",
    writerLlm: {
      async complete(request) {
        writerPrompts.push(request.messages.map((message) => message.content).join("\n"));
        return {
          content: JSON.stringify({
            subject: "Congrats on the Series A",
            body:
              "Hi Nisha,\n\nSaw the Series A and the distributed payroll expansion. That usually creates a timely moment to tighten pipeline quality before hiring ramps.\n\nWorth comparing notes this week?\n\n-Maya",
          }),
          model: "probe-llm",
          finish_reason: "stop",
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        };
      },
    },
  });
  const eventTypes = result.eventTypes;
  const message = result.state.messages[0];
  const personalization = String(
    message?.properties.personalization_context_markdown ?? "",
  );
  const writerPrompt = writerPrompts[0] ?? "";

  return [
    {
      name: "signal_to_email_workflow",
      status: result.output.decision === "sent" &&
          eventTypes.includes("draft.proposed") &&
          eventTypes.includes("draft.judged")
        ? "ok"
        : "fail",
      detail:
        `Workflow decision=${result.output.decision}; events=${eventTypes.join(", ")}`,
    },
    {
      name: "personalized_email_context",
      status: personalization.includes("Targeting Company") &&
          personalization.includes("Targeted Company And Contact") &&
          personalization.includes("Signal Timing And Why Now") &&
          writerPrompt.includes("Outcome learnings")
        ? "ok"
        : "fail",
      detail:
        "Draft context includes targeting company, targeted company/contact, timing, and outcome-derived exemplars.",
    },
    {
      name: "hot_path_eval_gate",
      status: eventTypes.indexOf("draft.judged") >= 0 &&
          eventTypes.indexOf("message.sent") > eventTypes.indexOf("draft.judged") &&
          (result.output.eval_score ?? 0) >= 0.55
        ? "ok"
        : "fail",
      detail: `Eval score=${result.output.eval_score ?? "unknown"}; send occurs after draft.judged.`,
    },
    {
      name: "dry_run_channel_send",
      status: result.sentEmailCount === 1 && eventTypes.includes("message.sent")
        ? "ok"
        : "fail",
      detail: `Dry-run transport sent ${result.sentEmailCount} email(s).`,
    },
    {
      name: "outcome_learning_loop",
      status: result.proceduralScoreAfterOutcome > 0.55 &&
          eventTypes.includes("outcome.recorded")
        ? "ok"
        : "fail",
      detail:
        `Procedural exemplar score after simulated positive reply=${result.proceduralScoreAfterOutcome}.`,
    },
  ];
}

function contactRow(input: {
  companyId: string;
  fullName: string;
  title: string;
  email: string;
  now: Date;
}): ContactGraphRow {
  return {
    id: randomUUID(),
    full_name: input.fullName,
    title: input.title,
    company_id: input.companyId,
    emails: [input.email],
    linkedin_url: null,
    properties: {
      email_verification: {
        [input.email.toLowerCase()]: {
          provider: "probe",
          status: "valid",
          verified: true,
          checked_at: input.now.toISOString(),
        },
      },
    },
    provenance: { source: "verify-outreach-pipeline" },
    created_at: input.now,
    updated_at: input.now,
  };
}

function contactRowsPool(rows: ContactGraphRow[]): Pool {
  return {
    async query() {
      return { rows };
    },
  } as unknown as Pool;
}

class MutableContactRowsPool {
  private readonly rows: ContactGraphRow[];

  constructor(rows: ContactGraphRow[]) {
    this.rows = rows;
  }

  asPool(): Pool {
    return {
      query: async (sql: string, params: unknown[]) => this.query(sql, params),
    } as unknown as Pool;
  }

  private async query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }> {
    if (sql.includes("select id,") && sql.includes("from graph_persons")) {
      const companyId = String(params[1]);
      const channel = String(params[2]);
      return {
        rows: this.rows.filter((row) =>
          row.company_id === companyId &&
          (channel === "email" ? row.emails.length > 0 : Boolean(row.linkedin_url))
        ),
      };
    }
    if (sql.includes("select id from graph_persons")) {
      const linkedinUrl = params[1] == null ? null : String(params[1]);
      const emails = Array.isArray(params[2]) ? params[2].map(String) : [];
      const companyId = String(params[3]);
      const fullName = String(params[4]).toLowerCase();
      const existing = this.rows.find((row) =>
        (linkedinUrl && row.linkedin_url === linkedinUrl) ||
        emails.some((email) => row.emails.map((value) => value.toLowerCase()).includes(email.toLowerCase())) ||
        (row.company_id === companyId && row.full_name.toLowerCase() === fullName)
      );
      return { rows: existing ? [{ id: existing.id }] : [] };
    }
    if (sql.includes("insert into graph_persons")) {
      const now = new Date();
      this.rows.push({
        id: randomUUID(),
        full_name: String(params[1]),
        title: typeof params[2] === "string" ? params[2] : null,
        company_id: String(params[3]),
        emails: Array.isArray(params[4]) ? params[4].map(String) : [],
        linkedin_url: typeof params[5] === "string" ? params[5] : null,
        properties: parseRecord(params[6]),
        provenance: parseRecord(params[7]),
        created_at: now,
        updated_at: now,
      });
      return { rows: [] };
    }
    if (sql.includes("update graph_persons") && sql.includes("set properties = properties ||")) {
      const personId = String(params[1]);
      const properties = parseRecord(params[2]);
      const row = this.rows.find((candidate) => candidate.id === personId);
      if (row) {
        row.properties = { ...row.properties, ...properties };
        row.updated_at = new Date();
      }
      return { rows: [] };
    }
    if (sql.includes("update graph_persons") && sql.includes("full_name =")) {
      const personId = String(params[8]);
      const row = this.rows.find((candidate) => candidate.id === personId);
      if (row) {
        row.full_name = String(params[1]);
        if (typeof params[2] === "string") row.title = params[2];
        row.company_id = row.company_id ?? String(params[3]);
        const emails = Array.isArray(params[4]) ? params[4].map(String) : [];
        row.emails = [...new Set([...row.emails, ...emails])];
        if (typeof params[5] === "string") row.linkedin_url = params[5];
        row.properties = { ...row.properties, ...parseRecord(params[6]) };
        row.provenance = { ...row.provenance, ...parseRecord(params[7]) };
        row.updated_at = new Date();
      }
      return { rows: [] };
    }
    throw new Error(`Unhandled probe SQL: ${sql}`);
  }
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function waitForCompletedRun(
  runtime: WorkflowRuntime,
  runId: string,
  timeoutMs = 1000,
): Promise<{ output?: ContactResolutionOutput | null; status: string }> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const current = await runtime.get<ContactResolutionInput, ContactResolutionOutput>(runId);
    if (current?.status === "completed" || current?.status === "failed") {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for contact resolution fixture");
}

async function main(): Promise<void> {
  loadDotenvLocal();
  const result = await runOutreachPipelineProbe();
  console.log("Outreach pipeline verification");
  for (const step of result.steps) {
    const label = step.status.toUpperCase().padEnd(4, " ");
    console.log(`  ${label} ${step.name} - ${step.detail}`);
  }
  if (result.ok) {
    console.log(
      result.strict
        ? "\nOutreach pipeline strict verification passed."
        : "\nOutreach pipeline local verification passed. Use OUTREACH_PIPELINE_STRICT=1 with production/staging env to require Outlook readiness.",
    );
    return;
  }
  console.error("\nOutreach pipeline verification failed.");
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

function loadDotenvLocal(): void {
  const path = ".env.local";
  if (!fs.existsSync(path)) return;
  const parsed = parseEnvFile(fs.readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] ??= value;
  }
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
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim();
    const rest = line.slice(idx + 1).trim();
    if (
      (rest.startsWith("\"") && !rest.endsWith("\"")) ||
      (rest.startsWith("'") && !rest.endsWith("'"))
    ) {
      key = name;
      quote = rest[0]!;
      value = [rest.slice(1)];
      continue;
    }
    env[name] = stripQuotes(rest);
  }
  return env;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

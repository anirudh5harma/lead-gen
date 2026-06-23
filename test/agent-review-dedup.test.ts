import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const agentPageStubs = new Map<string, string>([
  ["next/link", 'export default function Link() { return null; }'],
  [
    "@/components/dashboard/Shell",
    "export function EmptyState() { return null; }",
  ],
  [
    "@/components/dashboard/SurfaceHero",
    "export function SurfaceHero() { return null; } export function SurfaceSection() { return null; }",
  ],
  ["@/components/BrandIcon", 'export default function BrandIcon() { return null; }'],
  ["@/components/Icon", 'export default function Icon() { return null; }'],
  [
    "@/components/PendingSubmitButton",
    'export default function PendingSubmitButton() { return null; }',
  ],
  [
    "@/core/product/launch-readiness.ts",
    'export async function loadWorkspaceLaunchReadiness() { throw new Error("test stub"); }',
  ],
  [
    "@/core/product/output-destinations.ts",
    "export function buildOutputDestinations() { return []; }",
  ],
  [
    "@/core/product/qualified-signals.ts",
    'export async function loadQualifiedSignalWorkbench() { throw new Error("test stub"); }',
  ],
  [
    "@/core/substrate/storage/index.ts",
    'export function getPool() { throw new Error("test stub"); }',
  ],
  [
    "@/core/ingest/account-intent.ts",
    "export async function getHeatingUpAccountCount() { return 0; }",
  ],
  [
    "@/lib/workspace",
    'export async function getActiveWorkspaceSessionForDashboard() { throw new Error("test stub"); }',
  ],
  [
    "../actions",
    [
      "export async function checkAgentSourcesAction() {}",
      "export async function decideApprovalWithDraftAction() {}",
      "export async function dismissQualifiedSignalAction() {}",
      "export async function generateMeetingPrepAction() {}",
      "export async function optimizeCampaignStrategyAction() {}",
      "export async function optimizePlaySkillsAction() {}",
      "export async function prepareQualifiedSignalsAction() {}",
      "export async function recordPersonFitFeedbackAction() {}",
      "export async function resolveQualifiedSignalContactsAction() {}",
      "export async function updateWorkspaceAutonomyAction() {}",
    ].join(" "),
  ],
  [
    "../server-data",
    'export async function loadDashboardData() { throw new Error("test stub"); }',
  ],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = agentPageStubs.get(specifier);
    if (stub) {
      return {
        format: "module",
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(stub)}`,
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".ts") || url.endsWith(".tsx")) {
      const filename = fileURLToPath(url);
      const source = readFileSync(filename, "utf8");
      const { outputText } = ts.transpileModule(source, {
        compilerOptions: {
          allowImportingTsExtensions: true,
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
        fileName: path.basename(filename),
      });
      return { format: "module", shortCircuit: true, source: outputText };
    }
    return nextLoad(url, context);
  },
});

const { dedupeReviewRows } = await import("../app/dashboard/agent/AgentPage.tsx");

type AgentReviewRow = Parameters<typeof dedupeReviewRows>[0][number];

function reviewRow(
  overrides: Partial<AgentReviewRow> & Pick<AgentReviewRow, "id">,
): AgentReviewRow {
  return {
    id: overrides.id,
    run_id: overrides.run_id ?? `run-${overrides.id}`,
    kind: overrides.kind ?? "approval_gate",
    reason: overrides.reason ?? null,
    payload: overrides.payload ?? {},
    created_at: overrides.created_at ?? new Date("2026-06-23T00:00:00Z"),
    expires_at: overrides.expires_at ?? null,
    conversation_id: overrides.conversation_id ?? `conversation-${overrides.id}`,
    message_id: overrides.message_id ?? `message-${overrides.id}`,
    counterparty_person_id:
      overrides.counterparty_person_id ?? `person-${overrides.id}`,
    counterparty_name: overrides.counterparty_name ?? `Person ${overrides.id}`,
    company_name: overrides.company_name ?? "Default Co",
    signal_title: overrides.signal_title ?? "Fresh signal",
    message_subject: overrides.message_subject ?? "Subject",
    channel: overrides.channel ?? "email",
    eval_score: overrides.eval_score ?? "0.91",
    eval_passed: overrides.eval_passed ?? true,
    emails: overrides.emails ?? [`${overrides.id}@example.com`],
    linkedin_url: overrides.linkedin_url ?? null,
  };
}

test("dedupeReviewRows keeps the newest pending row for the same person/conversation", () => {
  const deduped = dedupeReviewRows([
    reviewRow({
      id: "newest",
      counterparty_person_id: "person-1",
      conversation_id: "conversation-1",
      created_at: new Date("2026-06-23T10:00:00Z"),
    }),
    reviewRow({
      id: "older",
      counterparty_person_id: "person-1",
      conversation_id: "conversation-1",
      created_at: new Date("2026-06-22T10:00:00Z"),
      message_id: "message-older",
    }),
  ]);

  assert.deepEqual(
    deduped.map((row) => row.id),
    ["newest"],
  );
  assert.equal(deduped[0]?.created_at.toISOString(), "2026-06-23T10:00:00.000Z");
});

test("dedupeReviewRows keeps distinct people", () => {
  const deduped = dedupeReviewRows([
    reviewRow({ id: "person-a", counterparty_person_id: "person-a" }),
    reviewRow({ id: "person-b", counterparty_person_id: "person-b" }),
    reviewRow({ id: "person-c", counterparty_person_id: "person-c" }),
  ]);

  assert.deepEqual(
    deduped.map((row) => row.id),
    ["person-a", "person-b", "person-c"],
  );
});

test("dedupeReviewRows preserves the first-seen order for unique rows", () => {
  const deduped = dedupeReviewRows([
    reviewRow({ id: "first", counterparty_person_id: "person-first" }),
    reviewRow({ id: "duplicate", counterparty_person_id: "person-first" }),
    reviewRow({ id: "second", counterparty_person_id: "person-second" }),
    reviewRow({ id: "third", counterparty_person_id: "person-third" }),
  ]);

  assert.deepEqual(
    deduped.map((row) => row.id),
    ["first", "second", "third"],
  );
});

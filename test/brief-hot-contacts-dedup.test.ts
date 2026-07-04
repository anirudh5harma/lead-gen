import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const dashboardStubs = new Map<string, string>([
  ["next/link", 'export default function Link() { return null; }'],
  ["@/components/Icon", 'export default function Icon() { return null; }'],
  [
    "@/components/PendingSubmitButton",
    'export default function PendingSubmitButton() { return null; }',
  ],
  [
    "@/core/substrate/storage/index.ts",
    'export function getPool() { throw new Error("test stub"); }',
  ],
  [
    "@/lib/workspace",
    'export async function getActiveWorkspaceSessionForDashboard() { throw new Error("test stub"); }',
  ],
  [
    "@/components/dashboard/SurfaceHero",
    "export function SurfaceSection() { return null; }",
  ],
  [
    "@/components/dashboard/FirstSignalsLoading",
    'export default function FirstSignalsLoading() { return null; }',
  ],
  [
    "@/components/dashboard/RouteRefresh",
    'export default function RouteRefresh() { return null; }',
  ],
  [
    "../actions",
    "export async function generateMeetingPrepAction() {} export async function prepareQualifiedSignalsAction() {}",
  ],
  [
    "../server-data",
    'export async function loadDashboardData() { throw new Error("test stub"); }',
  ],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = dashboardStubs.get(specifier);
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

const { dedupeHotContacts } = await import("../app/dashboard/brief/page.tsx");

type BriefHotContact = Parameters<typeof dedupeHotContacts>[0][number];

function contact(
  overrides: Partial<BriefHotContact> & Pick<BriefHotContact, "id">,
): BriefHotContact {
  return {
    id: overrides.id,
    full_name: overrides.full_name ?? `Contact ${overrides.id}`,
    title: overrides.title ?? "Founder",
    emails: overrides.emails ?? [`${overrides.id}@example.com`],
    linkedin_url: overrides.linkedin_url ?? null,
    email_status: overrides.email_status ?? "verified",
    company_name:
      "company_name" in overrides ? (overrides.company_name ?? null) : "Default Co",
    company_domain:
      "company_domain" in overrides
        ? (overrides.company_domain ?? null)
        : "default.example",
    latest_signal_title: overrides.latest_signal_title ?? "Fresh signal",
    latest_signal_kind: overrides.latest_signal_kind ?? "funding",
    last_signal_at: overrides.last_signal_at ?? new Date("2026-06-23T00:00:00Z"),
    contact_fit_decision: overrides.contact_fit_decision ?? "high_intent",
  };
}

test("dedupeHotContacts keeps the first contact for a company and preserves input ordering", () => {
  const rows: BriefHotContact[] = [
    contact({
      id: "fresh-acme",
      company_name: "Acme",
      company_domain: "acme.com",
      last_signal_at: new Date("2026-06-23T10:00:00Z"),
      contact_fit_decision: "high_intent",
    }),
    contact({
      id: "older-acme",
      company_name: "Acme",
      company_domain: "acme.com",
      last_signal_at: new Date("2026-06-22T10:00:00Z"),
      contact_fit_decision: "medium_intent",
      emails: ["older-acme@example.com"],
    }),
    contact({
      id: "beta",
      company_name: "Beta",
      company_domain: "beta.com",
    }),
    contact({
      id: "gamma",
      company_name: "Gamma",
      company_domain: "gamma.com",
    }),
  ];

  const deduped = dedupeHotContacts(rows);

  assert.deepEqual(
    deduped.map((row) => row.id),
    ["fresh-acme", "beta", "gamma"],
  );
  assert.equal(deduped[0]?.last_signal_at.toISOString(), "2026-06-23T10:00:00.000Z");
});

test("dedupeHotContacts keeps separate rows when company metadata is missing", () => {
  const deduped = dedupeHotContacts([
    contact({
      id: "no-company-a",
      company_name: null,
      company_domain: null,
      emails: ["no-company-a@example.com"],
    }),
    contact({
      id: "no-company-b",
      company_name: null,
      company_domain: null,
      emails: ["no-company-b@example.com"],
    }),
  ]);

  assert.deepEqual(
    deduped.map((row) => row.id),
    ["no-company-a", "no-company-b"],
  );
});

test("dedupeHotContacts works with the brief caller cap after deduping", () => {
  const rows: BriefHotContact[] = [
    contact({ id: "acme-1", company_name: "Acme", company_domain: "acme.com" }),
    contact({
      id: "acme-2",
      company_name: "Acme",
      company_domain: "acme.com",
      emails: ["acme-2@example.com"],
    }),
    contact({ id: "beta", company_name: "Beta", company_domain: "beta.com" }),
    contact({ id: "gamma", company_name: "Gamma", company_domain: "gamma.com" }),
    contact({ id: "delta", company_name: "Delta", company_domain: "delta.com" }),
    contact({ id: "epsilon", company_name: "Epsilon", company_domain: "epsilon.com" }),
    contact({ id: "zeta", company_name: "Zeta", company_domain: "zeta.com" }),
  ];

  const capped = dedupeHotContacts(rows).slice(0, 5);

  assert.deepEqual(
    capped.map((row) => row.id),
    ["acme-1", "beta", "gamma", "delta", "epsilon"],
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("dashboard chrome streams non-critical banners after the shell", () => {
  const layout = source("app/dashboard/layout.tsx");
  const shell = source("components/dashboard/Shell.tsx");

  assert.match(layout, /<Suspense fallback=\{null\}>/);
  assert.match(layout, /<DashboardBanners workspaceId=\{chrome\.workspaceId\} \/>/);
  assert.match(layout, /async function DashboardBanners/);
  assert.doesNotMatch(layout, /billing:\s*WorkspaceBillingState/);
  assert.doesNotMatch(layout, /activation:\s*WorkspaceActivationState/);
  assert.match(shell, /banners\?: ReactNode/);
  assert.match(shell, /\{banners\}/);
  assert.doesNotMatch(shell, /billing\?: WorkspaceBillingState/);
  assert.doesNotMatch(shell, /activation\?: WorkspaceActivationState/);
});

test("outreach renders its heading before the leads query resolves", () => {
  const outreach = source("app/dashboard/outreach/page.tsx");

  assert.match(outreach, /export default function OutreachPage/);
  assert.match(outreach, /<Suspense fallback=\{<OutreachResultsSkeleton \/>\}>/);
  assert.match(outreach, /async function OutreachLeads/);
  assert.match(outreach, /with recent_signals as materialized/);
  assert.match(outreach, /e\.payload \? 'signal_id'/);
  assert.match(outreach, />Account</);
  assert.match(outreach, />Signal</);
  assert.match(outreach, />Fit</);
  assert.match(outreach, />Contact</);
  assert.match(outreach, />Detected</);
  assert.match(outreach, /name="kind"/);
  assert.match(outreach, /name="readiness"/);
  assert.match(outreach, /name="freshness"/);
  assert.match(outreach, /name="size"/);
  assert.match(outreach, /name="industry"/);
});

test("Conversations is the canonical filtered thread surface", () => {
  const conversations = source("app/dashboard/conversations/page.tsx");
  const detail = source("app/dashboard/conversations/[id]/page.tsx");
  const config = source("next.config.ts");

  assert.match(conversations, /name="status"/);
  assert.match(conversations, /name="channel"/);
  assert.match(conversations, /exists \(\s*select 1\s*from messages/);
  assert.match(conversations, />Contact</);
  assert.match(conversations, />Conversation</);
  assert.match(conversations, />Status</);
  assert.match(conversations, />Activity</);
  assert.doesNotMatch(detail, /redirect\(/);
  assert.doesNotMatch(
    config,
    /source: "\/dashboard\/conversations\/:id"/,
  );
});

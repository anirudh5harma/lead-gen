import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function exists(path: string): boolean {
  return existsSync(new URL(`../${path}`, import.meta.url));
}

test("dashboard navigation uses active product surface routes", () => {
  const shell = source("components/dashboard/Shell.tsx");
  const primaryNav = shell.slice(
    shell.indexOf("const NAV"),
    shell.indexOf("function isActivePath"),
  );

  // Left-nav surfaces (2026-07 launch): Outreach is the default landing,
  // followed by Conversations, Reddit marketing, Integrations, Settings.
  assert.match(primaryNav, /href: "\/dashboard\/outreach",\s+label: "Outreach"/);
  assert.match(
    primaryNav,
    /matches: \["\/dashboard\/outreach", "\/dashboard"\]/,
  );
  assert.match(
    primaryNav,
    /href: "\/dashboard\/conversations",\s+label: "Conversations"/,
  );
  assert.match(
    primaryNav,
    /href: "\/dashboard\/reddit",\s+label: "Reddit marketing"/,
  );
  assert.match(
    primaryNav,
    /href: "\/dashboard\/integrations",\s+label: "Integrations"/,
  );
  assert.match(primaryNav, /href: "\/dashboard\/settings",\s+label: "Settings"/);
  assert.doesNotMatch(primaryNav, /label: "Brief"/);
  assert.doesNotMatch(primaryNav, /label: "Agent"/);
  assert.doesNotMatch(primaryNav, /label: "Profile"/);
  assert.doesNotMatch(primaryNav, /"\/dashboard\/reps"/);
  assert.doesNotMatch(primaryNav, /"\/dashboard\/signals"/);
  assert.doesNotMatch(primaryNav, /"\/dashboard\/plays"/);
  assert.doesNotMatch(primaryNav, /"\/dashboard\/outcomes"/);
  assert.doesNotMatch(primaryNav, /label: "Prospects"/);
  assert.doesNotMatch(primaryNav, /label: "Inbox"/);
  assert.match(shell, /hrefPath\(href\) === pathname/);
  assert.match(shell, /candidate !== "\/dashboard"/);
  assert.doesNotMatch(shell, /ProductFlowRail/);
  assert.doesNotMatch(shell, /aria-label="Product flow"/);
  assert.doesNotMatch(shell, /const FLOW/);
  assert.doesNotMatch(shell, /isActiveFlowItem/);
  assert.doesNotMatch(shell, /window\.location\.hash/);
  assert.doesNotMatch(shell, /hashchange/);
});

test("launch docs describe three user-facing dashboard surfaces", () => {
  const readme = source("README.md");
  const outlookCallback = source("app/api/auth/outlook/callback/route.ts");

  assert.match(readme, /Dashboard UI \(Brief, Agent, Profile\)/);
  assert.match(readme, /\/dashboard\/brief` — last-day and last-week qualified signals/);
  assert.match(readme, /\/dashboard\/agent` — live work, qualified signals/);
  assert.match(readme, /\/dashboard\/profile` — company Profile, buyer fit, Outlook\/LinkedIn/);
  assert.match(readme, /\/dashboard\/health` — owner-only runtime readiness/);
  assert.match(outlookCallback, /redirects to Profile's channel section/);
  assert.doesNotMatch(readme, /Dashboard UI \(Brief, Agent, Profile, Health\)/);
  assert.doesNotMatch(outlookCallback, /Deliverability surface/);
});

test("dashboard shell keeps route chrome simple and avoids extra flow queries", () => {
  const shell = source("components/dashboard/Shell.tsx");
  const layout = source("app/dashboard/layout.tsx");
  const workspace = source("lib/workspace.ts");

  assert.match(shell, /DashboardShell/);
  assert.match(shell, /md:w-\[calc\(100%-240px\)\]/);
  assert.match(shell, /const NAV/);
  assert.match(shell, /label: "Outreach"/);
  assert.match(shell, /label: "Conversations"/);
  assert.match(shell, /label: "Reddit marketing"/);
  assert.match(shell, /label: "Integrations"/);
  assert.match(shell, /label: "Settings"/);
  assert.match(shell, /WorkspaceModeSwitch/);
  assert.match(shell, /label="Auto"/);
  assert.match(shell, /label="Review"/);
  assert.match(shell, /updateWorkspaceAutonomyAction/);
  assert.match(shell, />Sign out</);
  assert.match(layout, /autonomyMode=\{chrome\.autonomyMode\}/);
  assert.match(layout, /<DashboardShell/);
  assert.match(layout, /getActiveWorkspaceSession/);
  assert.match(layout, /loadDashboardChrome/);
  assert.match(layout, /DashboardUnavailable/);
  assert.match(layout, /getActiveWorkspaceSessionForDashboard\("layout"\)/);
  assert.match(layout, /listWorkspacesForDashboard\("layout"\)/);
  assert.match(layout, /listWorkspaces/);
  assert.match(workspace, /getActiveWorkspaceSessionForDashboard/);
  assert.match(workspace, /listWorkspacesForDashboard/);
  assert.match(workspace, /failed to load active workspace/);
  assert.match(workspace, /failed to list workspaces/);

  assert.doesNotMatch(shell, /ProductFlowMetrics/);
  assert.doesNotMatch(shell, /DEFAULT_FLOW_METRICS/);
  assert.doesNotMatch(shell, /flowMetrics/);
  assert.doesNotMatch(layout, /loadProductFlowMetrics/);
  assert.doesNotMatch(layout, /EMPTY_FLOW_METRICS/);
  assert.doesNotMatch(layout, /from graph_companies gc/);
  assert.doesNotMatch(layout, /from workspace_source_configs wsc/);
  assert.doesNotMatch(layout, /from signals s/);
  assert.doesNotMatch(layout, /from messages m/);
});

test("dashboard shell mounts the global voice assistant drawer", () => {
  const shell = source("components/dashboard/Shell.tsx");
  const drawer = source("components/dashboard/VoiceAssistantDrawer.tsx");
  const transport = source("components/dashboard/assistantTransport.ts");

  assert.match(shell, /VoiceAssistantDrawer/);
  assert.match(shell, /<VoiceAssistantDrawer \/>/);
  assert.match(drawer, /aria-label="Open voice assistant"/);
  assert.match(drawer, /Talk to Bombsell/);
  assert.match(drawer, /Push to talk|Hold to talk/);
  assert.match(drawer, /\/api\/assistant\/tool/);
  assert.match(drawer, /\/api\/assistant\/chat/);
  assert.match(transport, /\/api\/assistant\/session/);
  assert.match(transport, /input_audio_transcription/);
});

test("dashboard data loaders preserve pool capacity for route-critical workspace lookups", () => {
  const serverData = source("app/dashboard/server-data.ts");
  const workspace = source("lib/workspace.ts");
  const env = source("core/config/env.ts");

  assert.match(serverData, /DASHBOARD_DATA_CONCURRENCY/);
  assert.match(serverData, /DEFAULT_DASHBOARD_DATA_CONCURRENCY = 4/);
  assert.match(serverData, /dashboardLoadWaiters/);
  assert.match(serverData, /acquireDashboardDataSlot/);
  assert.match(serverData, /releaseDashboardDataSlot/);
  assert.match(serverData, /DATABASE_POOL_MAX/);
  assert.match(workspace, /withTransientConnectionRetry/);
  assert.match(env, /DASHBOARD_DATA_CONCURRENCY/);
});

test("Agent is the canonical dashboard surface route", () => {
  const agentPage = source("app/dashboard/agent/page.tsx");
  const agentDetailPage = source("app/dashboard/agent/[id]/page.tsx");

  assert.match(agentPage, /export const dynamic = "force-dynamic"/);
  assert.match(agentPage, /from "\.\/AgentPage"/);
  assert.match(agentDetailPage, /export const dynamic = "force-dynamic"/);
  assert.match(agentDetailPage, /redirect\("\/dashboard\/agent#system"\)/);
  assert.match(
    source("app/dashboard/reps/page.tsx"),
    /redirect\("\/dashboard\/agent"\)/,
  );
  assert.match(
    source("app/dashboard/reps/[id]/page.tsx"),
    /redirect\("\/dashboard\/agent#system"\)/,
  );
  // Live routes ship instant loading.tsx skeletons for fast tab switches.
  assert.equal(exists("app/dashboard/loading.tsx"), true);
  assert.equal(exists("app/dashboard/agent/loading.tsx"), true);
  assert.equal(exists("app/dashboard/profile/loading.tsx"), true);
  assert.equal(exists("app/dashboard/profile/page.tsx"), true);
  assert.equal(exists("app/dashboard/settings/loading.tsx"), false);
  assert.match(
    source("app/dashboard/profile/page.tsx"),
    /from "\.\/ProfilePage"/,
  );
  // Settings is a live surface in the new nav (company profile + tone +
  // subscription). Advanced ICP tuning links back to Agent.
  assert.match(
    source("app/dashboard/settings/page.tsx"),
    /Settings \| Bombsell/,
  );
  assert.doesNotMatch(source("next.config.ts"), /source: "\/dashboard\/settings"/);
  assert.equal(exists("app/dashboard/agent/[id]/loading.tsx"), false);
  assert.equal(exists("app/dashboard/agent/contacts/[id]/loading.tsx"), true);

  const productLinks = [
    source("components/dashboard/Shell.tsx"),
    source("app/dashboard/brief/page.tsx"),
    source("app/dashboard/agent/AgentPage.tsx"),
    source("app/dashboard/agent/contacts/[id]/ContactPage.tsx"),
    source("app/dashboard/setup/page.tsx"),
    source("app/dashboard/actions.ts"),
    source("core/product/launch-readiness.ts"),
  ].join("\n");

  assert.match(productLinks, /\/dashboard\/agent/);
  assert.doesNotMatch(productLinks, /href="\/dashboard\/reps/);
  assert.doesNotMatch(productLinks, /href=\{`\/dashboard\/reps/);
  assert.doesNotMatch(productLinks, /value="\/dashboard\/reps/);
  assert.doesNotMatch(productLinks, /Configure Rep", \["product\.rep\.configure"\], "\/dashboard\/reps"/);
});

test("legacy list and Profile routes redirect to current product hubs", () => {
  const nextConfig = source("next.config.ts");

  // Settings is now a live surface — see "Settings surface" test below.
  assert.match(
    source("app/dashboard/prospecting/page.tsx"),
    /redirect\("\/dashboard\/profile#profile"\)/,
  );
  assert.match(
    source("app/dashboard/setup/page.tsx"),
    /redirect\("\/dashboard\/profile#profile"\)/,
  );
  assert.match(
    source("app/dashboard/deliverability/page.tsx"),
    /redirect\("\/dashboard\/profile#channels"\)/,
  );
  assert.match(
    source("app/dashboard/signals/page.tsx"),
    /redirect\("\/dashboard\/agent#qualified-signals"\)/,
  );
  assert.match(
    source("app/dashboard/ingestion/page.tsx"),
    /redirect\("\/dashboard\/agent#qualified-signals"\)/,
  );
  assert.match(
    source("app/dashboard/prospects/page.tsx"),
    /redirect\("\/dashboard\/agent#verified-contacts"\)/,
  );
  // Conversations is a live surface with a canonical detail route.
  assert.match(
    source("app/dashboard/conversations/[id]/page.tsx"),
    /AgentOutreachDetailPage/,
  );
  assert.match(
    source("app/dashboard/review/page.tsx"),
    /redirect\("\/dashboard\/agent#review-queue"\)/,
  );
  assert.match(
    source("app/dashboard/approvals/page.tsx"),
    /redirect\("\/dashboard\/agent#review-queue"\)/,
  );
  assert.match(
    source("app/dashboard/outcomes/page.tsx"),
    /redirect\("\/dashboard\/brief"\)/,
  );
  assert.match(
    source("app/dashboard/prospecting/loading.tsx"),
    /surface="profile"/,
  );
  assert.match(source("app/dashboard/setup/loading.tsx"), /surface="profile"/);
  assert.match(
    source("app/dashboard/deliverability/loading.tsx"),
    /surface="profile"/,
  );
  assert.match(
    source("app/dashboard/signals/loading.tsx"),
    /surface="agent"/,
  );
  assert.match(source("app/dashboard/ingestion/loading.tsx"), /surface="agent"/);
  assert.match(source("app/dashboard/prospects/loading.tsx"), /surface="agent"/);
  assert.match(source("app/dashboard/conversations/loading.tsx"), /surface="agent"/);
  assert.match(source("app/dashboard/outcomes/loading.tsx"), /surface="brief"/);
  assert.match(nextConfig, /source: "\/dashboard\/prospecting"/);
  assert.match(nextConfig, /source: "\/dashboard\/setup"/);
  assert.doesNotMatch(nextConfig, /source: "\/dashboard\/settings"/);
  assert.match(nextConfig, /source: "\/dashboard\/deliverability"/);
  assert.match(nextConfig, /source: "\/dashboard\/signals"/);
  assert.match(nextConfig, /source: "\/dashboard\/ingestion"/);
  assert.match(nextConfig, /source: "\/dashboard\/prospects"/);
  assert.match(nextConfig, /source: "\/dashboard\/prospects\/:id"/);
  assert.doesNotMatch(nextConfig, /source: "\/dashboard\/conversations"/);
  assert.doesNotMatch(nextConfig, /source: "\/dashboard\/conversations\/:id"/);
  assert.match(nextConfig, /source: "\/dashboard\/review"/);
  assert.match(nextConfig, /source: "\/dashboard\/approvals"/);
  assert.match(nextConfig, /source: "\/dashboard\/outcomes"/);
  assert.doesNotMatch(nextConfig, /source: "\/dashboard\/integrations"/);
  assert.match(nextConfig, /destination: "\/dashboard\/brief"/);
  assert.match(nextConfig, /destination: "\/dashboard\/profile#profile"/);
  assert.match(nextConfig, /destination: "\/dashboard\/profile#channels"/);
  assert.match(nextConfig, /destination: "\/dashboard\/agent#qualified-signals"/);
  assert.match(nextConfig, /destination: "\/dashboard\/agent#verified-contacts"/);
  assert.match(nextConfig, /destination: "\/dashboard\/agent\/contacts\/:id"/);
  assert.doesNotMatch(nextConfig, /destination: "\/dashboard\/agent\/outreach\/:id"/);

  const actions = source("app/dashboard/actions.ts");
  assert.match(actions, /revalidatePath\("\/dashboard\/profile"\)/);
  assert.doesNotMatch(actions, /revalidatePath\("\/dashboard\/settings"\)/);
  assert.doesNotMatch(actions, /revalidatePath\("\/dashboard\/review"\)/);
  assert.match(actions, /revalidatePath\("\/dashboard\/agent"\)/);
  assert.doesNotMatch(actions, /revalidatePath\("\/dashboard\/prospecting"\)/);
  assert.doesNotMatch(actions, /revalidatePath\("\/dashboard\/setup"\)/);
  assert.doesNotMatch(actions, /revalidatePath\("\/dashboard\/signals"\)/);
  assert.doesNotMatch(actions, /revalidatePath\("\/dashboard\/ingestion"\)/);
  assert.doesNotMatch(actions, /revalidatePath\("\/dashboard\/conversations"\)/);
});

test("retired product surfaces redirect to Agent", () => {
  const nextConfig = source("next.config.ts");
  const focusDoc = source("docs/product-focus-prospecting-outbound-2026-06-12.md");

  assert.match(nextConfig, /source: "\/dashboard\/reps"/);
  assert.match(nextConfig, /source: "\/dashboard\/reps\/:id"/);
  assert.match(nextConfig, /destination: "\/dashboard\/agent#system"/);
  assert.match(nextConfig, /source: "\/dashboard\/content"/);
  assert.match(nextConfig, /source: "\/dashboard\/aeo"/);
  assert.match(nextConfig, /source: "\/dashboard\/ops"/);
  assert.match(nextConfig, /destination: "\/dashboard\/health"/);
  assert.match(
    source("app/dashboard/content/page.tsx"),
    /redirect\("\/dashboard\/agent"\)/,
  );
  assert.match(
    source("app/dashboard/aeo/page.tsx"),
    /redirect\("\/dashboard\/agent"\)/,
  );
  assert.match(focusDoc, /# Product Focus: Signal-Led Outbound/);
  assert.match(focusDoc, /- Brief\n- Agent\n- Profile/);
  assert.match(focusDoc, /to `\/dashboard\/agent`/);
  assert.doesNotMatch(focusDoc, /to `\/dashboard\/campaigns`/);
});

test("Dashboard routes setup work through Profile and current surfaces", () => {
  const dashboard = source("app/dashboard/brief/page.tsx");
  const profile = source("app/dashboard/profile/ProfilePage.tsx");
  const appLayout = source("app/layout.tsx");
  const urlStart = source("components/UrlStart.tsx");

  assert.match(dashboard, /Morning brief for \{workspaceLabel\}/);
  assert.match(dashboard, /BriefPrimaryAction/);
  assert.match(dashboard, /BriefApprovalsCard/);
  assert.match(dashboard, /BriefLandedCard/);
  assert.match(dashboard, /Fresh qualified contacts/);
  assert.match(dashboard, /This week the agent learned/);
  assert.match(dashboard, /BriefFunnelSummary/);
  assert.match(dashboard, /loadBriefHotContacts/);
  assert.match(dashboard, /loadBriefOutcomeInsights/);
  assert.match(dashboard, /loadBriefLearningInsight/);
  assert.match(dashboard, /loadBriefSignalHealth/);
  assert.match(dashboard, /loadBriefContactReadiness/);
  assert.match(dashboard, /loadBriefChannelReadiness/);
  assert.match(dashboard, /loadBriefCapabilityReadiness/);
  assert.match(dashboard, /Qualified signals/);
  assert.match(dashboard, /emails_sent_24h/);
  assert.match(dashboard, /emails_sent_7d/);
  assert.match(dashboard, /dms_sent_24h/);
  assert.match(dashboard, /dms_sent_7d/);
  assert.match(dashboard, /Replies/);
  assert.match(dashboard, /Meetings/);
  const dayDmMetric = dashboard.slice(
    dashboard.indexOf("as dms_sent_24h") - 360,
    dashboard.indexOf("as dms_sent_24h") + 80,
  );
  const weekDmMetric = dashboard.slice(
    dashboard.indexOf("as dms_sent_7d") - 360,
    dashboard.indexOf("as dms_sent_7d") + 80,
  );
  assert.match(dayDmMetric, /m\.channel in \('linkedin_dm','linkedin_inmail'\)/);
  assert.match(weekDmMetric, /m\.channel in \('linkedin_dm','linkedin_inmail'\)/);
  assert.doesNotMatch(dayDmMetric, /linkedin_connection|linkedin_comment/);
  assert.doesNotMatch(weekDmMetric, /linkedin_connection|linkedin_comment/);
  assert.match(dashboard, /href="\/dashboard\/agent#qualified-signals"/);
  assert.match(dashboard, /href="\/dashboard\/agent#outreach"/);
  assert.match(dashboard, /href: "\/dashboard\/brief#reply-insights"/);
  assert.match(dashboard, /id="reply-insights" className="scroll-mt-28/);
  assert.match(dashboard, /What landed/);
  assert.match(dashboard, /Replies and meetings with the conversation proof attached/);
  assert.match(dashboard, /Open conversations/);
  assert.match(dashboard, /label: "Contacts"/);
  assert.match(dashboard, /label: "Drafts"/);
  assert.match(dashboard, /label: "Sent"/);
  assert.match(dashboard, /No weekly learning yet/);
  assert.match(dashboard, /Open learning/);
  assert.match(dashboard, /href="\/dashboard\/agent#learning"/);
  assert.match(dashboard, /contactReadiness/);
  assert.match(dashboard, /channelReadiness/);
  assert.match(dashboard, /signal_backed/);
  assert.match(dashboard, /verified_email/);
  assert.match(dashboard, /needs_email_verification/);
  assert.match(dashboard, /email_connected/);
  assert.match(dashboard, /linkedin_connected/);
  assert.match(dashboard, /connected_count/);
  assert.match(dashboard, /ca\.kind = 'oauth_outlook'/);
  assert.match(dashboard, /ca\.kind in \('linkedin_oauth','linkedin_session'\)/);
  assert.match(dashboard, /emailStatusLabel\(contact\.email_status\)/);
  assert.match(dashboard, /Email found/);
  assert.match(dashboard, /Connect accounts/);
  assert.match(dashboard, /Connect Outlook or LinkedIn before qualified signals can become sent outreach/);
  assert.match(dashboard, /href: "\/dashboard\/profile#channels"/);
  assert.match(dashboard, /href: "\/dashboard\/profile#signal-setup"/);
  assert.match(dashboard, /generateMeetingPrepAction/);
  assert.match(dashboard, /meeting_prep_generated_at/);
  assert.match(dashboard, /meeting\.prep\.generated/);
  assert.match(dashboard, /insightNeedsMeetingPrep/);
  assert.match(dashboard, /value="\/dashboard\/brief#reply-insights"/);
  assert.match(dashboard, /Prepare meeting/);
  assert.match(dashboard, /Meeting prep ready/);
  assert.match(dashboard, /\/dashboard\/conversations\/\$\{insight\.conversation_id\}/);
  assert.doesNotMatch(dashboard, /Signal mix/);
  assert.doesNotMatch(dashboard, /href: "\/dashboard\/prospecting"/);

  assert.match(profile, /<SurfaceSection title="Company & ICP">/);
  assert.match(profile, /<SurfaceSection title="Channels">/);
  assert.match(profile, /<SurfaceSection title="Voice & autonomy">/);
  assert.match(profile, /ProfileAdvancedDrawer/);
  assert.match(profile, /Advanced setup/);
  assert.match(profile, /Long-tail company fields/);
  assert.match(profile, /Signal watchlist and contact-quality gates/);
  assert.match(profile, /Blocklist \/ contact protection/);
  assert.match(profile, /Developer destinations and contracts/);
  assert.match(profile, /from "@\/core\/product\/output-destinations\.ts"/);
  assert.match(profile, /buildOutputDestinations/);
  assert.match(profile, /destinationIcon/);
  assert.match(profile, /BrandIcon name="microsoft"/);
  assert.match(profile, /BrandIcon name="linkedin"/);
  assert.doesNotMatch(profile, /const planned = \[/);

  assert.match(source("app/dashboard/brief/page.tsx"), /dynamic = "force-dynamic"/);
  // Brief content now lives in brief/page.tsx directly (the top-level
  // dashboard route is a redirect to /dashboard/outreach).
  assert.match(source("app/brief/page.tsx"), /redirect\("\/dashboard\/brief"\)/);
  assert.match(appLayout, /Grow your sales with high-intent outreach/);
  assert.doesNotMatch(appLayout, /Prospecting, signal ingestion/);
  assert.match(urlStart, /draft your profile, audience, and voice/);
  assert.doesNotMatch(urlStart, /prospecting profile/);
});
test("Health presents agent observability from the event-sourced summary", () => {
  const health = source("app/dashboard/health/page.tsx");

  assert.match(health, /getWorkspaceAgentObservabilitySummary/);
  assert.match(health, /Agent observability/);
  assert.match(health, /redacted traces/);
  assert.match(health, /eval cases/);
  assert.match(health, /Everyday outreach stays with the agent/);
  assert.doesNotMatch(health, /Everyday outcomes stay with the Reps/);
});

test("Profile presents merged Outlook and LinkedIn connection gates", () => {
  const settings = source("app/dashboard/profile/ProfilePage.tsx");
  const topLevelProfile = settings.slice(
    settings.indexOf("export default async function ProfilePage"),
    settings.indexOf("<ProfileAdvancedDrawer"),
  );
  const advancedDrawer = settings.slice(
    settings.indexOf("function ProfileAdvancedDrawer"),
    settings.indexOf("function OutlookPanel"),
  );

  assert.match(settings, /<SurfaceSection title="Channels">/);
  assert.match(settings, /<div id="channels">/);
  assert.match(settings, /<div id="email">/);
  assert.match(settings, /<div id="linkedin">/);
  assert.ok(
    settings.indexOf('<div id="email">') > settings.indexOf('title="Channels"') &&
      settings.indexOf('<div id="linkedin">') > settings.indexOf('<div id="email">'),
    "Outlook and LinkedIn controls should live inside the merged Channels section",
  );
  assert.match(settings, /href="\/api\/auth\/outlook\?return_to=%2Fdashboard%2Fprofile%23email"/);
  assert.match(settings, /kind in \('linkedin_session','linkedin_oauth'\)/);
  assert.match(settings, /Outlook inbox/);
  assert.match(settings, /Connect Microsoft 365 for native send, threading, and reply sync/);
  assert.match(settings, /Connect Outlook/);
  assert.match(settings, /LinkedIn accounts/);
  assert.match(settings, /Coming soon/);
  assert.match(settings, /LinkedIn connection requests and DMs are coming soon/);
  assert.match(settings, /Outlook is\s+live now/);
  assert.match(settings, /First account/);
  assert.match(settings, /Second account/);
  assert.match(settings, /Account and limits/);
  assert.match(settings, /LinkedIn connection is coming soon/);
  assert.match(settings, /Advanced setup/);
  assert.match(settings, /Watchlists, quality gates, protection, long-tail profile\s+fields, source IDs, webhooks, MCP, CRM, and workspace account\s+details/);
  assert.match(topLevelProfile, /<SurfaceSection title="Company & ICP">/);
  assert.match(topLevelProfile, /<SurfaceSection title="Voice & autonomy">/);
  assert.match(topLevelProfile, /<SurfaceSection title="Channels">/);
  assert.doesNotMatch(topLevelProfile, /Signal watchlist and contact-quality gates/);
  assert.match(advancedDrawer, /Signal watchlist and contact-quality gates/);
  assert.match(advancedDrawer, /ProfileSignalBuilderPanel/);
  assert.match(advancedDrawer, /Buyer fit, intent signals, and contact quality in one loop/);
  assert.match(advancedDrawer, /Buyer filters/);
  assert.match(advancedDrawer, /Intent signals/);
  assert.match(advancedDrawer, /Quality gates/);
  assert.match(advancedDrawer, /5 gates ready/);
  assert.match(settings, /sourceKinds/);
  assert.match(settings, /qualifiedSignals7d/);
  assert.match(settings, /state\.signalSetup\.activeSources/);
  assert.match(settings, /state\.signalSetup\.qualifiedSignals7d/);
  assert.match(settings, /Keep at least five strong signal inputs/);
  assert.match(settings, /return_to" value="\/dashboard\/profile#signal-setup"/);
  assert.match(settings, /Open Agent/);
  assert.match(settings, /checkAgentSourcesAction/);
  assert.match(settings, /Check sources/);
  assert.match(settings, /ContactQualityPanel/);
  assert.match(settings, /Signal watchlist and contact-quality gates/);
  assert.match(settings, /Play review mode/);
  assert.match(settings, /href="\/dashboard\/agent#qualified-signals"/);
  assert.match(settings, /turns them into qualified contacts,\s+judged drafts, sent emails or LinkedIn DMs/);
  assert.match(settings, /verified contact or LinkedIn profile/);
  assert.doesNotMatch(settings, /Activation map/);
  assert.doesNotMatch(settings, /Website, profile, channels, and contacts in one loop/);
  assert.doesNotMatch(settings, /Learning: \{/);
  assert.doesNotMatch(settings, /href: "\/dashboard\/plays"/);
  assert.doesNotMatch(settings, /prospecting profile/);
  assert.doesNotMatch(settings, /<SurfaceSection title="Email channel">/);
  assert.doesNotMatch(settings, /<SurfaceSection title="LinkedIn channel">/);
});
test("Outlook connection surfaces collapse duplicate rows by mailbox identity", () => {
  const settings = source("app/dashboard/profile/ProfilePage.tsx");
  const brief = source("app/dashboard/brief/page.tsx");

  assert.match(settings, /row_number\(\) over/);
  assert.match(settings, /properties ->> 'mailbox_email'/);
  assert.match(settings, /where account_rank = 1/);
  assert.match(brief, /outlook_mailboxes/);
  assert.match(brief, /has_blocked_status and not has_connected/);
});

test("Agent learning surface owns message optimization from reply evidence", () => {
  const campaigns = source("app/dashboard/campaigns/page.tsx");
  const plays = source("app/dashboard/plays/page.tsx");
  const campaignsLoading = source("app/dashboard/campaigns/loading.tsx");
  const playsLoading = source("app/dashboard/plays/loading.tsx");
  const nextConfig = source("next.config.ts");
  const reps = source("app/dashboard/agent/AgentPage.tsx");
  const actions = source("app/dashboard/actions.ts");
  const readiness = source("core/product/launch-readiness.ts");
  const renderedSurface = reps.slice(
    reps.indexOf("export default async function RepsPage"),
    reps.indexOf("function AgentTopStrip"),
  );
  const advancedDetails = reps.slice(
    reps.indexOf("function AgentAdvancedDetails"),
    reps.indexOf("function SourceHealthRow"),
  );
  const _modeControl = reps.slice(
    reps.indexOf("function AgentModeControl"),
    reps.indexOf("function agentOperatingMode"),
  );

  assert.match(nextConfig, /source: "\/dashboard\/campaigns"/);
  assert.match(nextConfig, /source: "\/dashboard\/plays"/);
  assert.match(nextConfig, /destination: "\/dashboard\/agent#learning"/);
  assert.match(campaigns, /redirect\("\/dashboard\/agent#learning"\)/);
  assert.match(plays, /redirect\("\/dashboard\/agent#learning"\)/);
  assert.match(campaignsLoading, /surface="agent"/);
  assert.match(playsLoading, /surface="agent"/);
  assert.match(actions, /optimizeProductPlaySkills/);
  assert.match(actions, /dashboardReturnPath\(formData, "\/dashboard\/agent#learning"\)/);
  assert.match(reps, /optimizePlaySkillsAction/);
  assert.match(reps, /optimizeCampaignStrategyAction/);
  assert.match(renderedSurface, /<AgentAdvancedDetails/);
  assert.doesNotMatch(renderedSurface, /<AgentLearningPanel learning=\{state\.learning\} \/>/);
  assert.match(advancedDetails, /Learning and optimization/);
  assert.match(advancedDetails, /return_to" value="\/dashboard\/agent#advanced"/);
  assert.match(advancedDetails, /Message note/);
  assert.match(reps, /play\.skill\.optimization\.recommended/);
  assert.match(reps, /Optimize messages/);
  assert.match(readiness, /label: "Agent"/);
  assert.match(readiness, /label: "Outreach rules"/);
  assert.match(readiness, /"\/dashboard\/profile#signal-setup"/);
  assert.match(readiness, /"\/dashboard\/agent#outreach"/);
  assert.doesNotMatch(readiness, /label: "Rep"/);
  assert.doesNotMatch(readiness, /label: "Plays"/);
  assert.doesNotMatch(readiness, /"\/dashboard\/campaigns"/);
  assert.doesNotMatch(campaigns, /kicker="Plays"/);
  assert.doesNotMatch(campaigns, /Learn from outreach/);
  assert.doesNotMatch(campaigns, /Message optimizer/);
  assert.doesNotMatch(campaigns, /Play Skill optimizer/);
  assert.doesNotMatch(campaigns, /No Play/);
  assert.doesNotMatch(campaigns, /worth a Play/);
  assert.doesNotMatch(campaigns, /Play ideas/);
  assert.doesNotMatch(campaigns, /Play Rep/);
  assert.doesNotMatch(campaigns, /Apply at Play gate/);
});

test("Verified contacts open graph-backed profile pages with channel readiness", () => {
  const prospects = source("app/dashboard/prospects/page.tsx");
  const prospectDetail = source("app/dashboard/prospects/[id]/page.tsx");
  const profile = source("app/dashboard/agent/contacts/[id]/ContactPage.tsx");
  const reps = source("app/dashboard/agent/AgentPage.tsx");
  const brief = source("app/dashboard/brief/page.tsx");
  const actions = source("app/dashboard/actions.ts");

  assert.match(prospects, /redirect\("\/dashboard\/agent#verified-contacts"\)/);
  assert.match(
    prospectDetail,
    /redirect\(`\/dashboard\/agent\/contacts\/\$\{id\}`\)/,
  );
  assert.match(reps, /href=\{`\/dashboard\/agent\/contacts\/\$\{contact\.id\}`\}/);
  assert.match(brief, /href=\{`\/dashboard\/agent\/contacts\/\$\{contact\.id\}`\}/);
  assert.match(actions, /`\/dashboard\/agent\/contacts\/\$\{personId\}`/);
  assert.match(actions, /revalidatePath\(`\/dashboard\/agent\/contacts\/\$\{personId\}`\)/);
  assert.match(reps, /Verified contacts/);
  assert.match(reps, /Contact workbench/);
  assert.match(reps, /Signal-ready contacts show why now, score, email verification/);
  assert.match(reps, /coalesce\(p\.emails, '\{\}'::text\[\]\) as emails/);
  assert.match(reps, /latest_signal\.match_score::text as latest_signal_score/);
  assert.match(reps, /end as email_status/);
  assert.match(reps, /latest_linkedin_acceptance\.last_touch_at is not null/);
  assert.match(reps, /then 'connection_accepted'/);
  assert.match(reps, /latest_linkedin_acceptance\.channel/);
  assert.match(profile, /Verified contact/);
  assert.match(profile, /Timing evidence, channel handles, outreach, replies, and meetings/);
  assert.match(profile, /Back to contacts/);
  assert.match(profile, /No outreach yet/);
  assert.match(profile, /href: "\/dashboard\/agent#outreach"/);
  assert.match(profile, /Replies and meetings/);
  assert.match(profile, /Fit feedback/);
  assert.match(profile, /recordPersonFitFeedbackAction/);
  assert.match(profile, /name="decision" value=\{option\.decision\}/);
  assert.match(profile, /Good fit/);
  assert.match(profile, /Not a fit/);
  assert.match(profile, /contactFitState/);
  assert.match(profile, /coalesce\(p\.emails, '\{\}'::text\[\]\) as emails/);
  assert.match(profile, /coalesce\(p\.phones, '\{\}'::text\[\]\) as phones/);
  assert.match(profile, /from graph_persons p/);
  assert.match(profile, /left join graph_companies/);
  assert.match(profile, /from signals s/);
  assert.match(profile, /from conversations c/);
  assert.match(profile, /from outcomes o/);
  assert.match(profile, /from channel_accounts ca/);
  assert.match(profile, /First seen/);
  assert.match(profile, /Last updated/);
  assert.match(profile, /Contact provenance comes from the graph, signals, and outreach threads/);
  assert.match(profile, /Coming soon/);
  assert.match(profile, /Connect Outlook/);
  assert.doesNotMatch(profile, /Prospect profile/);
  assert.doesNotMatch(profile, /Open Plays/);
  assert.doesNotMatch(profile, /Reps act on/);
});

test("Reply insights keep outcome data under the simplified dashboard", () => {
  const outcomes = source("app/dashboard/outcomes/page.tsx");
  const loading = source("app/dashboard/outcomes/loading.tsx");
  const loader = source("components/dashboard/LoadingState.tsx");
  const dashboard = source("app/dashboard/brief/page.tsx");
  const reps = source("app/dashboard/agent/AgentPage.tsx");

  assert.match(outcomes, /redirect\("\/dashboard\/brief"\)/);
  assert.match(dashboard, /BriefLandedCard/);
  assert.match(dashboard, /What landed/);
  assert.match(dashboard, /Replies and meetings with the conversation proof attached/);
  assert.match(dashboard, /Nothing landed yet/);
  assert.match(dashboard, /loadBriefOutcomeInsights/);
  assert.match(dashboard, /from outcomes o/);
  assert.match(dashboard, /o\.kind in \('positive_reply','meeting_booked'\)/);
  assert.match(dashboard, /reply_intent/);
  assert.match(dashboard, /OutcomeInsightRow/);
  assert.match(dashboard, /insight\.kind === "meeting_booked" \? "event_available" : "mark_email_read"/);
  assert.match(dashboard, /\/dashboard\/conversations\/\$\{insight\.conversation_id\}/);
  assert.match(dashboard, /meeting\.prep\.generated/);
  assert.match(dashboard, /generateMeetingPrepAction/);
  assert.match(dashboard, /Prepare meeting/);
  assert.match(dashboard, /Meeting prep ready/);
  assert.match(dashboard, /Positive reply/);
  assert.match(dashboard, /Meeting booked/);
  assert.match(reps, /AgentConversationsPanel/);
  assert.match(reps, /AgentReplyLink/);
  assert.match(reps, /Inbound replies are classified, drafted, and tied back to the\s+original conversation/);
  assert.match(reps, /direction = 'inbound'/);
  assert.match(reps, /reply_to_message_id/);
  assert.match(reps, /meeting\.prep\.generated/);
  assert.match(reps, /generateMeetingPrepAction/);
  assert.match(reps, /Prepare meeting/);
  assert.match(reps, /positive_replies_7d/);
  assert.match(reps, /Outcome notes/);
  assert.match(loading, /surface="brief"/);
  assert.match(loader, /brief: \{ kicker: "Dashboard"/);
  assert.doesNotMatch(outcomes, /kicker="Outcomes"/);
  assert.doesNotMatch(outcomes, /Proof your Reps/);
  assert.doesNotMatch(outcomes, /Outcome ledger/);
  assert.doesNotMatch(dashboard, /Outcome memory/);
  assert.doesNotMatch(dashboard, /Reply memory/);
  assert.doesNotMatch(outcomes, /No outcomes recorded/);
  assert.doesNotMatch(outcomes, /Open Conversations/);
});
test("Agent surface shows live work and account readiness", () => {
  const reps = source("app/dashboard/agent/AgentPage.tsx");
  const renderedSurface = reps.slice(
    reps.indexOf("export default async function RepsPage"),
    reps.indexOf("function AgentTopStrip"),
  );
  const advancedDetails = reps.slice(
    reps.indexOf("function AgentAdvancedDetails"),
    reps.indexOf("function SourceHealthRow"),
  );
  const modeControl = reps.slice(
    reps.indexOf("function AgentModeControl"),
    reps.indexOf("function agentOperatingMode"),
  );

  assert.match(reps, /AgentTopStrip/);
  assert.match(reps, /AgentReviewQueuePanel/);
  assert.match(reps, /AgentConversationsPanel/);
  assert.match(reps, /AgentLeadsPanel/);
  assert.match(reps, /AgentAdvancedDetails/);
  assert.match(reps, /loadQualifiedSignalWorkbench/);
  assert.match(reps, /loadAgentContactSummary/);
  assert.match(reps, /loadAgentLearningSummary/);
  assert.match(reps, /loadAgentOutreachSummary/);
  assert.match(reps, /loadAgentReplySummary/);
  assert.match(reps, /loadAgentReviewSummary/);
  assert.match(reps, /visibleReps = state\.reps\.filter\(isVisibleProductAgent\)/);
  assert.match(reps, /return rep\.role === "sdr"/);
  assert.match(reps, /Finds leads, sends email and LinkedIn, drafts replies for approval/);
  assert.match(reps, /Open threads/);
  assert.match(reps, /Sent 7d/);
  assert.match(advancedDetails, /Channels and autonomy/);
  assert.match(reps, /Connect Outlook/);
  assert.match(reps, /Connect LinkedIn/);
  assert.match(reps, /Email ready/);
  assert.match(reps, /LinkedIn ready/);
  assert.match(reps, /commandBlockerCopy/);
  assert.match(reps, /Connect Outlook or LinkedIn before outreach can run/);
  assert.match(advancedDetails, /<AgentModeControl mode=\{operatingMode\} \/>/);
  assert.match(modeControl, /Approval mode/);
  assert.match(modeControl, />\s*Auto\s*</);
  assert.match(modeControl, />\s*Review\s*</);
  assert.match(modeControl, /updateWorkspaceAutonomyAction/);
  assert.match(modeControl, /name="autonomy_mode" value="autonomous"/);
  assert.match(modeControl, /name="autonomy_mode" value="review_only"/);
  assert.match(reps, /<div id="thumb" className="scroll-mt-28">/);
  assert.match(reps, /<span id="review-queue" className="sr-only"/);
  assert.match(reps, /title="Needs your thumb"/);
  assert.match(reps, /<AgentReviewRowCard key=\{approval\.id\} approval=\{approval\}/);
  assert.match(reps, /AgentOutreachLink message=\{item\.message\}/);
  assert.match(reps, /title="Conversations"/);
  assert.match(reps, /Email and LinkedIn threads/);
  assert.match(reps, /Approval-only drafts move through Needs/);
  assert.doesNotMatch(reps, /\.\.\.reviews\.recent/);
  assert.match(reps, /<span id="qualified-signals" className="sr-only"/);
  assert.match(reps, /title="Leads the agent is contacting"/);
  assert.match(reps, /No leads ready yet/);
  assert.match(reps, /When a qualified signal has a reachable person, it appears here as a lead/);
  assert.match(reps, /whether the next touch is drafted or waiting/);
  assert.match(reps, /prepareQualifiedSignalsAction/);
  assert.match(reps, /resolveQualifiedSignalContactsAction/);
  assert.match(reps, /recordPersonFitFeedbackAction/);
  assert.match(reps, /dismissQualifiedSignalAction/);
  assert.match(reps, /decideApprovalWithDraftAction/);
  assert.match(reps, /const leadSignals = opportunities\.signals\.filter\(isLeadStageSignal\)/);
  assert.match(reps, /return !isSignalPendingApproval\(signal\) && !isSignalInConversationStage\(signal\);/);
  assert.match(renderedSurface, /<AgentAdvancedDetails/);
  assert.match(advancedDetails, /id="advanced"/);
  assert.match(advancedDetails, /Advanced \/ Details/);
  assert.match(advancedDetails, /Learning and optimization/);
  assert.match(advancedDetails, /Use recent replies and meetings to improve source choice and\s+message patterns/);
  assert.match(advancedDetails, /optimizeCampaignStrategyAction/);
  assert.match(advancedDetails, /optimizePlaySkillsAction/);
  assert.doesNotMatch(renderedSurface, /<AgentActivityPanel/);
  assert.doesNotMatch(renderedSurface, /<AgentContactsPanel/);
  assert.doesNotMatch(renderedSurface, /<AgentOutreachPanel/);
  assert.doesNotMatch(renderedSurface, /<AgentRepliesPanel/);
  assert.doesNotMatch(renderedSurface, /<AgentModeRail/);
  assert.doesNotMatch(renderedSurface, /aria-label="Agent work modes"\s*>/);
  assert.doesNotMatch(renderedSurface, /<AgentReadinessPanel/);
  assert.doesNotMatch(renderedSurface, /<AgentStrategyPanel/);
  assert.doesNotMatch(renderedSurface, /<AgentSequencePanel/);
  assert.doesNotMatch(renderedSurface, /<SurfaceSection\s+title="System status"/);
  assert.doesNotMatch(renderedSurface, /<AgentOperatingLoopPanel/);
  assert.doesNotMatch(renderedSurface, /<AgentSetupSnapshot/);
  assert.doesNotMatch(renderedSurface, /<AgentSystemPanel/);
  assert.doesNotMatch(renderedSurface, /id="sources" className="scroll-mt-28"/);
  assert.doesNotMatch(renderedSurface, /Run source now/);
  assert.doesNotMatch(renderedSurface, /Run now/);
  assert.doesNotMatch(renderedSurface, /name="source_id" value=\{source\.id\}/);

  assert.ok(
    reps.indexOf("<AgentTopStrip") <
      reps.indexOf("<AgentConversationsPanel"),
    "status and readiness must lead the Agent surface",
  );
  assert.ok(
    reps.indexOf("<AgentConversationsPanel") <
      reps.indexOf("<AgentLeadsPanel"),
    "conversation evidence must lead the primary Agent work queue",
  );
  assert.ok(
    reps.indexOf("<AgentLeadsPanel") <
      reps.indexOf("<AgentReviewQueuePanel reviews={state.reviews} />"),
    "lead work must precede the thumb queue in the simplified Agent surface",
  );
  assert.ok(
    reps.indexOf("<AgentReviewQueuePanel reviews={state.reviews} />") <
      reps.indexOf("<AgentAdvancedDetails"),
    "advanced learning and details must stay behind the primary work sections",
  );
});
test("dashboard app surfaces do not leak legacy named agents", () => {
  const readme = source("README.md");
  const demoSeed = source("scripts/demo-seed.ts");
  const surfaces = [
    source("app/dashboard/agent/AgentPage.tsx"),
    source("app/dashboard/setup/page.tsx"),
    source("app/dashboard/profile/ProfilePage.tsx"),
    source("app/dashboard/campaigns/page.tsx"),
  ].join("\n");

  assert.match(surfaces, /Outbound agent/);
  assert.doesNotMatch(surfaces, /Sampark/);
  assert.doesNotMatch(surfaces, /Prayog/);
  assert.doesNotMatch(readme, /Sampark|Prayog/);
  assert.match(readme, /Dashboard UI \(Brief, Agent, Profile\)/);
  assert.match(readme, /\/dashboard\/brief/);
  assert.match(readme, /\/dashboard\/agent/);
  assert.match(readme, /\/dashboard\/profile/);
  assert.match(readme, /\/dashboard\/conversations\/<conversation-id>/);
  assert.match(demoSeed, /\/dashboard\/conversations\/<conversation_id>/);
  assert.match(demoSeed, /without sending external email/);
  assert.doesNotMatch(
    readme,
    /Dashboard UI \(Brief, Outreach, Content, Campaigns, AEO, Profile, Review, Health\)/,
  );
  assert.doesNotMatch(readme, /\/dashboard\/campaigns`/);
  assert.doesNotMatch(readme, /mocked LLM \+ SES/);
  assert.doesNotMatch(demoSeed, /\/dashboard\/reps/);
});

test("MCP context uses the simplified product model", () => {
  const context = source("core/product/context.ts");
  const tools = source("core/product/tools.ts");
  const env = source("core/product/env.ts");
  const productApp = source("core/product/app.ts");

  assert.match(context, /Brief: the current operating summary/);
  assert.match(context, /Profile: company positioning/);
  assert.match(context, /Agent: the execution surface/);
  assert.match(context, /qualified signals, verified contacts, outreach, replies, and meetings/);
  assert.match(tools, /name: "product\.brief\.get"/);
  assert.match(tools, /Read the current operating Brief for agent clients/);
  assert.match(tools, /last-day and last-week qualified signals/);
  assert.match(tools, /sent LinkedIn DMs\/InMail/);
  assert.match(productApp, /export interface ProductOperatingBrief/);
  assert.match(productApp, /getProductOperatingBrief/);
  assert.match(productApp, /last_24h/);
  assert.match(productApp, /last_7d/);
  assert.match(productApp, /linkedin_dms_sent/);
  assert.match(productApp, /m\.channel in \('linkedin_dm','linkedin_inmail'\)/);
  assert.doesNotMatch(productApp, /as linkedin_touches_sent/);
  assert.match(productApp, /signal_types/);
  assert.match(productApp, /with_contacts_7d/);
  assert.match(productApp, /with_drafts_7d/);
  assert.match(productApp, /operatingBriefNextAction/);
  assert.match(productApp, /review_drafts/);
  assert.match(productApp, /repair_channels/);
  assert.match(productApp, /connect_accounts/);
  assert.match(productApp, /prepare_outreach/);
  assert.match(productApp, /open_agent/);
  assert.match(context, /Agent configurations/);
  assert.match(context, /Recent reply\/meeting results/);
  assert.match(context, /Outreach Rules/);
  assert.doesNotMatch(context, /Outreach Sequences/);
  assert.doesNotMatch(context, /Preserve the internal five primitives/);
  assert.doesNotMatch(context, /Content opportunities/);
  assert.doesNotMatch(context, /Active agents/);
  assert.doesNotMatch(context, /Recent outcomes/);
  assert.doesNotMatch(context, /AEO gaps/);
  assert.match(tools, /qualified signals, verified contacts, outreach, replies, meetings/);
  assert.match(tools, /workspace Agent persona/);
  assert.match(tools, /signal-to-email outreach rules/);
  assert.match(tools, /signal-to-LinkedIn outreach rules/);
  assert.doesNotMatch(tools, /outreach sequence/);
  assert.match(tools, /Dispatch durable Agent outreach workflows/);
  assert.match(env, /Agent research, draft grounding, open-web signals, and outreach evidence/);
  assert.doesNotMatch(context, /Content: plays/);
  assert.doesNotMatch(context, /Campaigns: sources/);
  assert.doesNotMatch(context, /AEO: visibility/);
  assert.doesNotMatch(context, /## Reps/);
  assert.doesNotMatch(context, /## Plays/);
  assert.doesNotMatch(tools, /morning-brief state: Reps/);
  assert.doesNotMatch(tools, /external agents: vocabulary/);
  assert.doesNotMatch(tools, /Rep research, Brief refresh/);
  assert.doesNotMatch(tools, /Create or update a user-facing Rep persona/);
  assert.doesNotMatch(tools, /Create or update a Signal-to-email Play/);
  assert.doesNotMatch(tools, /Create or update a Signal-to-LinkedIn Play/);
  assert.doesNotMatch(tools, /Dispatch durable Play workflows/);
  assert.doesNotMatch(tools, /active Plays/);
  assert.doesNotMatch(tools, /before any Play sends/);
  assert.doesNotMatch(tools, /configures Rep and email\/LinkedIn Plays/);
  assert.doesNotMatch(tools, /selected Play Skill/);
  assert.doesNotMatch(tools, /Conversation matcher/);
  assert.doesNotMatch(tools, /campaign Play variants/);
  assert.doesNotMatch(tools, /real Outcome for a campaign Play run/);
  assert.doesNotMatch(tools, /Play dispatch/);
  assert.doesNotMatch(env, /content, and AEO/);
});

test("message personalization uses Profile ingredients before outreach drafts", () => {
  const productApp = source("core/product/app.ts");

  assert.match(productApp, /getProductCompanyProfile\(engine\.pool, session\)/);
  assert.match(productApp, /Profile Message Ingredients/);
  assert.match(productApp, /messageProfileIngredientLines/);
  assert.match(productApp, /messageProfileProof/);
  assert.match(productApp, /profileProof \?\?/);
  assert.match(productApp, /\["Value proposition", profile\.value_proposition\]/);
  assert.match(productApp, /\["Customer pain points", profile\.customer_pain_points\]/);
  assert.match(productApp, /\["Key features", profile\.key_features\]/);
  assert.match(productApp, /\["Social proof", profile\.social_proof\]/);
  assert.match(productApp, /\["Buyer roles", profile\.target_titles\]/);
  assert.match(productApp, /\["Target markets", profile\.target_markets\]/);
  assert.match(productApp, /\["Signal keywords", profile\.signal_keywords\]/);
  assert.match(productApp, /\["Competitors to watch", profile\.competitor_watchlist\]/);
  assert.match(productApp, /\["LinkedIn behavior to watch", profile\.linkedin_signal_behaviors\]/);
  assert.match(productApp, /\["Outreach goal", profile\.outreach_goal\]/);
  assert.match(productApp, /\["Message tone", profile\.message_tone\]/);
  assert.match(productApp, /\["LinkedIn company page", profile\.linkedin_company_url\]/);
  assert.match(productApp, /next_action: "run_eval_gate"/);
});

test("sent outreach links open the exact draft in the conversation trace", () => {
  const outreach = source("app/dashboard/conversations/page.tsx");
  const legacyDetail = source("app/dashboard/conversations/[id]/page.tsx");
  const detail = source("app/dashboard/agent/outreach/[id]/page.tsx");
  const trust = source("core/product/conversation-trust.ts");
  const reps = source("app/dashboard/agent/AgentPage.tsx");
  const dashboard = source("app/dashboard/brief/page.tsx");
  const profile = source("app/dashboard/profile/ProfilePage.tsx");
  const contact = source("app/dashboard/agent/contacts/[id]/ContactPage.tsx");
  const actions = source("app/dashboard/actions.ts");
  const aliases = source("core/product/bombsell-tools.ts");

  // /dashboard/conversations owns thread discovery and the canonical detail URL.
  assert.match(outreach, /Conversations \| Bombsell/);
  assert.match(legacyDetail, /AgentOutreachDetailPage/);
  assert.match(reps, /<AgentConversationsPanel/);
  assert.match(reps, /kind: "sent"/);
  assert.match(reps, /AgentOutreachLink message=\{item\.message\}/);
  assert.match(trust, /the Agent is set to research-only for replies/);
  assert.match(reps, /href=\{sentDraftHref\(message\.conversation_id, message\.id\)\}/);
  assert.match(reps, /\/dashboard\/conversations\/\$\{conversationId\}#message-\$\{messageId\}/);
  assert.match(reps, /\/dashboard\/conversations\/\$\{reply\.conversation_id\}#message-\$\{reply\.inbound_message_id\}/);
  assert.match(reps, /\/dashboard\/conversations\/\$\{row\.conversation_id\}/);
  assert.match(dashboard, /\/dashboard\/conversations\/\$\{insight\.conversation_id\}/);
  assert.match(profile, /\/dashboard\/conversations\/\$\{row\.conversation_id\}/);
  assert.match(contact, /\/dashboard\/conversations\/\$\{conversation\.id\}/);
  assert.match(actions, /revalidatePath\(`\/dashboard\/conversations\/\$\{conversationId\}`\)/);
  assert.match(aliases, /\/dashboard\/conversations\/\$\{message\.conversation_id\}#message-\$\{message\.id\}/);
  assert.doesNotMatch(aliases, /\/dashboard\/agent\/outreach\/\$\{message\.conversation_id\}/);
  assert.match(detail, /brief-kicker">Conversation/);
  assert.match(detail, /OutreachProofTimeline/);
  assert.match(detail, /Signal-to-outreach trace/);
  assert.match(detail, /Delivery and workflow proof/);
  assert.match(detail, /<details className="group/);
  assert.match(detail, /timing signal,\s+verified contact, judged draft, channel handoff, and reply learning/);
  assert.match(detail, /gate_explanations: gateExplanations/);
  assert.match(detail, /workflow=\{workflow\}/);
  assert.match(detail, /strongestGateExplanation/);
  assert.match(detail, /channelLabel\(outbound\.channel\)/);
  assert.match(detail, /contactEmailStatusLabel\(conversation\.counterparty_email_status\)/);
  assert.match(detail, /\/dashboard\/agent\/contacts\/\$\{conversation\.counterparty_person_id\}/);
  assert.match(detail, /completedStepCount/);
  assert.match(detail, /id=\{`message-\$\{m\.id\}`\}/);
  assert.match(detail, /target:ring-\[var\(--color-accent\)\]/);
  assert.match(detail, />\s*Conversations\s*</);
  assert.match(detail, />Contact</);
  assert.match(detail, /contactEmailStatusLabel\(conv\.counterparty_email_status\)/);
  assert.match(detail, /conv\.counterparty_linkedin_ready \? "LinkedIn profile" : "No LinkedIn profile"/);
  assert.match(detail, /contactFitLabel\(conv\.counterparty_fit_decision\)/);
  assert.match(detail, /label="Email"/);
  assert.match(detail, /label="LinkedIn"/);
  assert.doesNotMatch(detail, /Voice <span/);
  assert.doesNotMatch(detail, /conv\.status\.replace/);
  assert.match(trust, /p\.properties #>> '\{contact_fit,decision\}' as counterparty_fit_decision/);
  assert.match(trust, /p\.linkedin_url as counterparty_linkedin_url/);
  assert.match(trust, /counterparty_email_status/);
  assert.match(trust, /jsonb_each\(coalesce\(p\.properties->'email_verification'/);
  assert.doesNotMatch(detail, /brief-kicker">Inbox/);
  assert.doesNotMatch(detail, /Back to Inbox/);
  assert.doesNotMatch(trust, /the Play is set to research-only/);
});

test("Health trace labels use product-facing names", () => {
  const health = source("app/dashboard/health/page.tsx");

  assert.match(health, /`Agent \$\{shortId\(refs\.rep_id\)\}`/);
  assert.match(health, /`Path \$\{shortId\(refs\.play_id\)\}`/);
  assert.match(health, /`Result \$\{shortId\(refs\.outcome_id\)\}`/);
  assert.doesNotMatch(health, /`Rep \$\{shortId\(refs\.rep_id\)\}`/);
  assert.doesNotMatch(health, /`Play \$\{shortId\(refs\.play_id\)\}`/);
  assert.doesNotMatch(health, /`Sequence \$\{shortId\(refs\.play_id\)\}`/);
  assert.doesNotMatch(health, /`Outcome \$\{shortId\(refs\.outcome_id\)\}`/);
});

test("loading states use simplified product surface labels", () => {
  const loader = source("components/dashboard/LoadingState.tsx");

  assert.match(loader, /type LoadingSurface =\s+\| "agent"\s+\| "brief"\s+\| "dashboard"\s+\| "profile";/);
  assert.match(loader, /agent: \{ kicker: "Agent"/);
  assert.match(loader, /brief: \{ kicker: "Dashboard"/);
  assert.match(loader, /profile: \{ kicker: "Profile"/);
  assert.match(loader, /title: "Loading profile and integrations"/);
  assert.doesNotMatch(loader, /reps: \{ kicker:/);
  assert.doesNotMatch(loader, /plays: \{ kicker:/);
  assert.doesNotMatch(loader, /outcomes: \{ kicker:/);
  assert.doesNotMatch(loader, /prospecting: \{ kicker:/);
  assert.doesNotMatch(loader, /kicker: "Reps"/);
  assert.doesNotMatch(loader, /kicker: "Plays"/);
  assert.doesNotMatch(loader, /kicker: "Outcomes"/);
  assert.doesNotMatch(loader, /Loading prospecting profile/);
});

test("dashboard Signal surfaces do not expose manual ingestion controls", () => {
  const campaigns = source("app/dashboard/campaigns/page.tsx");
  const signals = source("app/dashboard/ingestion/page.tsx");
  const actions = source("app/dashboard/actions.ts");
  const reps = source("app/dashboard/agent/AgentPage.tsx");
  const productApp = source("core/product/app.ts");
  const onboardingActions = source("app/onboarding/actions.ts");
  const activationGraph = source("core/agents/langgraph/graphs/activation.ts");
  const capabilityMap = source("docs/agent-native-capability-map.md");

  assert.doesNotMatch(actions, /runWorkspaceSignalAggregatorOnce/);
  assert.doesNotMatch(actions, /runSignalIngestionAction/);
  assert.doesNotMatch(campaigns, /runSignalIngestionAction/);
  assert.doesNotMatch(campaigns, /Run signal ingestion/);
  assert.doesNotMatch(signals, /runSignalIngestionAction/);
  assert.doesNotMatch(signals, /Ingest signals/);
  assert.doesNotMatch(signals, /Run ingestion/);
  assert.match(actions, /checkAgentSourcesAction/);
  assert.match(actions, /runWorkspaceSignalIngestion/);
  assert.match(actions, /runAgentSourceNowAction/);
  assert.match(actions, /runWorkspaceSourcePollNow/);
  assert.match(actions, /wait: false/);
  assert.match(actions, /Preparing verified contacts and outreach/);
  assert.match(actions, /resolveQualifiedSignalContactsAction/);
  assert.match(actions, /dispatchSignalPlaysOnce\(\{ signal_id: signalId, limit: 1 \}, session\)/);
  assert.match(actions, /Resolving verified contacts and outreach/);
  assert.match(reps, /checkAgentSourcesAction/);
  assert.match(reps, /Check sources/);
  assert.doesNotMatch(reps, /Run source now/);
  assert.doesNotMatch(reps, /Run now/);
  assert.doesNotMatch(reps, /name="source_id" value=\{source\.id\}/);
  assert.match(reps, /name="limit" value="25"/);
  assert.match(productApp, /runWorkspaceSourcePollNow/);
  assert.match(productApp, /workflow_name: WORKSPACE_POLL_WORKFLOW/);
  assert.match(productApp, /workspace-source-manual/);
  assert.match(signals, /redirect\("\/dashboard\/agent#qualified-signals"\)/);
  assert.match(reps, /Leads the agent is contacting/);
  assert.match(reps, /whether the next touch is drafted or waiting/);
  assert.match(reps, /signalScoreLabel/);
  assert.match(reps, /emailStatusLabel/);
  assert.match(reps, /campaignStatusLabel/);
  assert.match(reps, /LinkedIn profile/);
  assert.match(reps, /No leads ready yet/);
  assert.match(reps, /When a qualified signal has a reachable person, it appears here as a lead/);
  assert.match(reps, /email or\s+LinkedIn drafts/);
  assert.match(reps, /Tune profile/);
  assert.match(productApp, /SIGNAL_TO_EMAIL_PLAY_WORKFLOW,\s*SIGNAL_TO_LINKEDIN_PLAY_WORKFLOW/);
  assert.match(productApp, /row\.workflow_name === SIGNAL_TO_LINKEDIN_PLAY_WORKFLOW/);
  assert.match(productApp, /contactChannelForTarget\(row\.target_channel\)/);
  assert.doesNotMatch(actions, /Preparing verified contacts and email drafts/);
  assert.doesNotMatch(signals, /prospecting profile/);
  assert.doesNotMatch(signals, /kicker="Qualified signals"/);
  assert.doesNotMatch(signals, /Signals worth <em>emailing now<\/em>/);
  assert.doesNotMatch(signals, /HeroStat label="Inbox"/);
  assert.doesNotMatch(signals, /Prepare contacts \+ drafts/);
  assert.doesNotMatch(signals, /signal-to-email outreach run/);
  assert.doesNotMatch(signals, /\/api\/auth\/outlook\?return_to=\/dashboard\/signals/);
  assert.doesNotMatch(signals, /"\/api\/auth\/outlook"/);
  assert.doesNotMatch(onboardingActions, /runWorkspaceSignalIngestion/);
  assert.match(activationGraph, /product\.signal\.ingestion\.run/);
  assert.match(onboardingActions, /wait: false/);
  assert.match(capabilityMap, /Autonomous signal ingestion/);
  assert.doesNotMatch(
    capabilityMap,
    /`\/dashboard\/campaigns`, `\/dashboard\/signals`/,
  );
  assert.match(capabilityMap, /autonomous workspace workers/);
  assert.match(capabilityMap, /`product\.signal\.ingestion\.run`/);
});

test("visitor de-anonymization enters the Signal path", () => {
  const route = source("app/api/webhooks/visitors/route.ts");
  const collector = source("app/api/collect/visitors/route.ts");
  const visitorIntent = source("core/product/visitor-intent.ts");
  const browserScript = source("public/visitor.js");
  const outputDestinations = source("core/product/output-destinations.ts");
  assert.match(visitorIntent, /VisitorEventSchema/);
  assert.match(route, /SIGNAL_WEBHOOK_SECRET/);
  assert.match(route, /discoverSignalFromWebhook/);
  assert.match(route, /producerRef: "webhook:visitors"/);
  assert.match(collector, /collector_not_configured/);
  assert.match(collector, /origin_not_allowed/);
  assert.match(collector, /skipped:identity_missing/);
  assert.match(collector, /producerRef: "collector:visitors"/);
  assert.match(visitorIntent, /visitor_deanonymization: true/);
  assert.match(visitorIntent, /intent_score/);
  assert.match(visitorIntent, /company_domain/);
  assert.match(visitorIntent, /industry/);
  assert.match(visitorIntent, /headcount/);
  assert.match(visitorIntent, /funding_stage/);
  assert.match(visitorIntent, /linkedin_url/);
  assert.match(visitorIntent, /weighted_pages/);
  assert.match(visitorIntent, /dwell_time_seconds/);
  assert.match(visitorIntent, /scroll_depth/);
  assert.match(visitorIntent, /repeat_visits/);
  assert.match(visitorIntent, /consent/);
  assert.match(visitorIntent, /marketing_allowed/);
  assert.match(visitorIntent, /do_not_track/);
  assert.match(route, /skipped:consent_suppressed/);
  assert.match(visitorIntent, /signal_kind: "other" as const/);
  assert.match(browserScript, /window\.bombsell/);
  assert.match(browserScript, /data-source-id/);
  assert.match(browserScript, /navigator\.sendBeacon/);
  assert.match(outputDestinations, /Visitor de-anonymization/);
  assert.match(outputDestinations, /\/dashboard\/profile#visitor-intent/);
  assert.match(outputDestinations, /product\.source\.configure/);
  assert.match(outputDestinations, /\/visitor\.js/);
  assert.match(outputDestinations, /\/api\/collect\/visitors/);
  assert.match(outputDestinations, /\/api\/webhooks\/visitors/);
});

test("dashboard surface verifier covers the simplified product flow", () => {
  const pkg = JSON.parse(source("package.json")) as {
    scripts?: Record<string, string>;
  };
  const verifier = source("scripts/verify-dashboard-surfaces.ts");
  const capabilityMap = source("docs/agent-native-capability-map.md");

  assert.match(
    pkg.scripts?.["verify:dashboard-surfaces"] ?? "",
    /scripts\/verify-dashboard-surfaces\.ts/,
  );
  assert.match(verifier, /"\/dashboard\/brief"/);
  assert.match(verifier, /"\/dashboard\/agent"/);
  assert.match(verifier, /"\/dashboard\/profile"/);
  assert.match(verifier, /canonicalNav = \["Brief", "Agent", "Profile"\]/);
  assert.match(verifier, /forbiddenNav = \["Outreach", "Signals", "Prospects", "Inbox", "Plays", "Outcomes", "Reps"\]/);
  assert.match(verifier, /"\/login\?next=%2Fdashboard"/);
  assert.match(verifier, /"\/auth\/google\?next=%2Fdashboard"/);
  assert.match(verifier, /"\/dashboard\/reps", destination: "\/dashboard\/agent"/);
  assert.match(verifier, /"\/dashboard\/campaigns", destination: "\/dashboard\/agent#learning"/);
  assert.match(verifier, /"\/dashboard\/content", destination: "\/dashboard\/agent"/);
  assert.match(verifier, /"\/dashboard\/aeo", destination: "\/dashboard\/agent"/);
  assert.match(verifier, /"\/dashboard\/plays", destination: "\/dashboard\/agent#learning"/);
  assert.match(verifier, /"\/dashboard\/signals", destination: "\/dashboard\/agent#qualified-signals"/);
  assert.match(verifier, /"\/dashboard\/ingestion", destination: "\/dashboard\/agent#qualified-signals"/);
  assert.match(verifier, /"\/dashboard\/prospects", destination: "\/dashboard\/agent#verified-contacts"/);
  assert.doesNotMatch(verifier, /"\/dashboard\/conversations", destination:/);
  assert.match(verifier, /"\/dashboard\/review", destination: "\/dashboard\/agent#review-queue"/);
  assert.match(verifier, /"\/dashboard\/approvals", destination: "\/dashboard\/agent#review-queue"/);
  assert.doesNotMatch(verifier, /"\/dashboard\/settings", destination:/);
  assert.doesNotMatch(verifier, /"\/dashboard\/integrations", destination:/);
  assert.match(verifier, /"\/dashboard\/deliverability", destination: "\/dashboard\/profile#channels"/);
  assert.match(verifier, /"\/dashboard\/prospecting", destination: "\/dashboard\/profile#profile"/);
  assert.match(verifier, /"\/dashboard\/setup", destination: "\/dashboard\/profile#profile"/);
  assert.match(verifier, /"\/dashboard\/outcomes", destination: "\/dashboard\/brief"/);
  assert.match(verifier, /"Live work"/);
  assert.match(verifier, /"SETUP HUB"/);
  assert.match(verifier, /"LAUNCH MODEL"/);
  assert.match(verifier, /"Use Bombsell in Claude Code"/);
  assert.match(verifier, /"http:\/\/127\.0\.0\.1:3023"/);
  assert.doesNotMatch(capabilityMap, /\/dashboard\/agent#sources/);
  assert.match(capabilityMap, /\/dashboard\/conversations\/\[id\]/);
  assert.match(capabilityMap, /\/dashboard\/profile#signal-setup/);
});

test("Profile exposes profile, channels, advanced setup, and workspace autonomy controls", () => {
  const settings = source("app/dashboard/profile/ProfilePage.tsx");
  const actions = source("app/dashboard/actions.ts");
  const outputDestinations = source("core/product/output-destinations.ts");
  const productApp = source("core/product/app.ts");
  const contactResolution = source("core/contacts/resolution.ts");
  const registry = source("core/substrate/events/registry.ts");
  const topLevelProfile = settings.slice(
    settings.indexOf("export default async function ProfilePage"),
    settings.indexOf("<ProfileAdvancedDrawer"),
  );
  const advancedDrawer = settings.slice(
    settings.indexOf("function ProfileAdvancedDrawer"),
    settings.indexOf("function OutlookPanel"),
  );

  assert.match(settings, /editCompanyProfileAction/);
  assert.match(settings, /configureActivationAction/);
  assert.match(settings, /updateWorkspaceAutonomyAction/);
  assert.match(actions, /async function startAgentSourceCheck/);
  assert.match(actions, /Agent is checking sources/);
  assert.match(actions, /Company profile saved\. Agent is checking sources/);
  assert.match(settings, /href="\/api\/auth\/outlook\?/);
  assert.match(settings, /getProductLaunchReadiness/);
  assert.match(settings, /ProfileAdvancedDrawer/);
  assert.match(settings, /Advanced setup/);
  assert.match(settings, /Watchlists, quality gates, protection, long-tail profile\s+fields, source IDs, webhooks, MCP, CRM, and workspace account\s+details/);
  assert.match(topLevelProfile, /<SurfaceSection title="Company & ICP">/);
  assert.match(topLevelProfile, /<SurfaceSection title="Voice & autonomy">/);
  assert.match(topLevelProfile, /<SurfaceSection title="Channels">/);
  assert.doesNotMatch(topLevelProfile, /Signal watchlist and contact-quality gates/);
  assert.doesNotMatch(topLevelProfile, /Blocklist \/ contact protection/);
  assert.doesNotMatch(topLevelProfile, /Developer destinations and contracts/);
  assert.match(advancedDrawer, /Signal watchlist and contact-quality gates/);
  assert.match(advancedDrawer, /Blocklist \/ contact protection/);
  assert.match(advancedDrawer, /Developer destinations and contracts/);
  assert.match(settings, /Open Agent/);
  assert.match(settings, /profileReadinessNextAction/);
  assert.doesNotMatch(settings, /ProfileActivationFlow/);
  assert.doesNotMatch(settings, /Activation flow/);
  assert.doesNotMatch(settings, /LaunchPathPanel/);
  assert.doesNotMatch(settings, /Launch path/);
  assert.doesNotMatch(settings, /Website to outreach/);
  assert.doesNotMatch(settings, /Website intelligence/);
  assert.match(settings, /id="profile"/);
  assert.match(settings, /id="agent"/);
  assert.match(settings, /id="autonomy"/);
  assert.match(settings, /id="channels"/);
  assert.match(settings, /id="email"/);
  assert.match(settings, /id="linkedin"/);
  assert.match(settings, /id="signal-setup"/);
  assert.match(settings, /id="contact-quality"/);
  assert.match(settings, /id="blocklist"/);
  assert.match(settings, /id="tools"/);
  assert.doesNotMatch(settings, /href: "#email"/);
  assert.doesNotMatch(settings, /href: "#linkedin"/);
  assert.doesNotMatch(settings, /href: "#templates"/);
  assert.match(settings, /Channels ready/);
  assert.match(settings, /channelReadinessCount\(state\)/);
  assert.match(settings, /return `\$\{ready\}\/2 ready`/);
  assert.match(settings, /Outlook inbox/);
  assert.match(settings, /LinkedIn accounts/);
  assert.match(settings, /<LinkedInPanel accounts=\{state\.linkedInAccounts\}/);
  assert.match(settings, /<CrmHandoffSetupPanel account=\{state\.crmAccount\}/);
  assert.match(settings, /Coming soon/);
  assert.match(settings, /Outlook is\s+live now/);
  assert.match(settings, /First account/);
  assert.match(settings, /Second account/);
  assert.match(settings, /Account and limits/);
  assert.match(settings, /Developer destinations and contracts/);
  assert.match(settings, /Where qualified work can go/);
  assert.match(settings, /buildOutputDestinations/);
  assert.match(settings, /destinationIcon/);
  assert.match(settings, /BrandIcon name="microsoft"/);
  assert.match(settings, /BrandIcon name="linkedin"/);
  assert.match(outputDestinations, /Email outreach/);
  assert.match(outputDestinations, /Social outreach/);
  assert.match(outputDestinations, /Agent API/);
  assert.match(outputDestinations, /Claude Code \+ MCP/);
  assert.match(outputDestinations, /href: "\/dashboard\/profile#claude-code"/);
  assert.match(settings, /Use Bombsell in Claude Code/);
  assert.match(settings, /McpAccessPanel/);
  assert.match(settings, /id="claude-code"/);
  assert.match(settings, /Claude Code access/);
  assert.match(settings, /Browser-authorized MCP sessions/);
  assert.match(settings, /Direct MCP setup/);
  assert.match(
    settings,
    /claude mcp add --transport http bombsell https:\/\/www\.bombsell\.com\/api\/mcp/,
  );
  assert.match(settings, /McpSetupStep/);
  assert.match(settings, /marketplace\s+dogfood/);
  assert.match(settings, /Recent MCP activity/);
  assert.match(settings, /Evented audit/);
  assert.match(settings, /event_type = 'mcp\.tool\.called'/);
  assert.match(settings, /payload->>'tool_name' as tool_name/);
  assert.match(settings, /payload->>'user_id' = \$2/);
  assert.match(settings, /revokeMcpTokenAction/);
  assert.match(settings, /token\.token_hash\.slice\(0, 10\)/);
  assert.match(settings, /mcp_oauth_tokens t/);
  assert.match(settings, /t\.revoked_at is null/);
  assert.match(outputDestinations, /BOMBSELL_MCP_TOOL_NAMES\.briefGet/);
  assert.match(outputDestinations, /BOMBSELL_MCP_TOOL_NAMES\.outreachListSent/);
  assert.match(outputDestinations, /Automation intake/);
  assert.match(outputDestinations, /\/api\/webhooks\/signals/);
  assert.match(outputDestinations, /Visitor de-anonymization/);
  assert.match(outputDestinations, /Intent signal intake/);
  assert.match(outputDestinations, /RB2B, Clearbit, Factors, Warmly/);
  assert.match(outputDestinations, /href: "\/dashboard\/profile#visitor-intent"/);
  assert.match(settings, /id="visitor-intent"/);
  assert.match(settings, /Visitor intent setup/);
  assert.match(settings, /configureVisitorIntentSourceAction/);
  assert.match(actions, /export async function configureVisitorIntentSourceAction/);
  assert.match(actions, /provider: "bombsell_script"/);
  assert.match(actions, /website_url: websiteUrl \?\? undefined/);
  assert.match(actions, /company_domain: companyDomain \?\? undefined/);
  assert.match(settings, /visitorIntentSource: ProfileVisitorIntentSource \| null/);
  assert.match(settings, /source=\{state\.visitorIntentSource\}/);
  assert.match(settings, /in \('bombsell_script','rb2b','clearbit','factors','warmly','generic'\)/);
  assert.match(settings, /Source ready/);
  assert.match(settings, /Create visitor source/);
  assert.match(settings, /Source ID/);
  assert.match(settings, /const scriptHost = "https:\/\/www\.bombsell\.com"/);
  assert.match(settings, /src="\$\{scriptHost\}\/visitor\.js"/);
  assert.match(settings, /data-source-id="\$\{sourceId\}"/);
  assert.match(settings, /window\.bombsell\('identify'\)/);
  assert.match(settings, /\/api\/collect\/visitors/);
  assert.match(settings, /product\.source\.configure adapter=webhook provider=bombsell_script source_id=\$\{sourceId\}/);
  assert.match(settings, /POST \/api\/webhooks\/visitors/);
  assert.match(settings, /SIGNAL_WEBHOOK_SECRET/);
  assert.match(settings, /Minimal visitor payload/);
  assert.match(settings, /page paths, dwell time, repeat visits, and\s+identity proof/);
  assert.match(settings, /"source_id": "00000000-0000-4000-8000-000000000123"/);
  assert.match(settings, /"dwell_time_seconds": 93/);
  assert.match(settings, /"scroll_depth": 0\.78/);
  assert.match(settings, /"repeat_visits": 3/);
  assert.match(settings, /"marketing_allowed": true/);
  assert.match(settings, /"do_not_track": false/);
  assert.match(outputDestinations, /\/visitor\.js/);
  assert.match(outputDestinations, /\/api\/collect\/visitors/);
  assert.match(outputDestinations, /\/api\/webhooks\/visitors/);
  assert.match(settings, /visitor-intent and signal webhooks/);
  assert.match(settings, /Next destination classes/);
  assert.match(outputDestinations, /CRM sync/);
  assert.match(outputDestinations, /href: "\/dashboard\/profile#crm-sync"/);
  assert.match(outputDestinations, /BOMBSELL_MCP_TOOL_NAMES\.contactLanesGet/);
  assert.match(outputDestinations, /BOMBSELL_MCP_TOOL_NAMES\.crmHandoffQueue/);
  assert.match(outputDestinations, /crm\.destination\.configured/);
  assert.match(outputDestinations, /crm\.handoff\.webhook\.delivered/);
  assert.match(outputDestinations, /crm\.handoff\.webhook\.failed/);
  assert.match(settings, /configureCrmDestinationAction/);
  assert.match(actions, /configureWorkspaceCrmDestination/);
  assert.match(productApp, /configureWorkspaceCrmDestination/);
  assert.match(productApp, /event_type: "crm\.destination\.configured"/);
  assert.match(productApp, /event_type: "crm\.handoff\.queued"/);
  assert.match(productApp, /event_type: "crm\.handoff\.webhook\.delivered"/);
  assert.match(productApp, /event_type: "crm\.handoff\.webhook\.failed"/);
  assert.match(productApp, /deliverCrmHandoffWebhook/);
  assert.match(productApp, /crmWebhookEndpoint/);
  assert.match(productApp, /retryable: false/);
  assert.match(productApp, /projectCrmHandoffWebhookStatus/);
  assert.match(productApp, /credentials->>'webhook_url' as webhook_url/);
  assert.match(productApp, /projectCrmDestinationConfigured/);
  assert.match(productApp, /projectCrmHandoffQueued/);
  assert.match(productApp, /crm\.handoff_webhook_status\.projector\.v1/);
  assert.match(registry, /const CrmDestinationConfigured = z\.object/);
  assert.match(registry, /const CrmHandoffWebhookDelivered = z\.object/);
  assert.match(registry, /const CrmHandoffWebhookFailed = z\.object/);
  assert.match(registry, /"crm\.destination\.configured": CrmDestinationConfigured/);
  assert.match(registry, /"crm\.handoff\.queued": CrmHandoffQueued/);
  assert.match(registry, /"crm\.handoff\.webhook\.delivered": CrmHandoffWebhookDelivered/);
  assert.match(registry, /"crm\.handoff\.webhook\.failed": CrmHandoffWebhookFailed/);
  assert.match(settings, /id="crm-sync"/);
  assert.match(settings, /CRM handoff setup/);
  assert.match(settings, /name="crm_provider"/);
  assert.match(settings, /name="crm_webhook_url"/);
  assert.match(settings, /defaultValue=\{account\?\.webhook_url \?\? ""\}/);
  assert.match(settings, /Delivery/);
  assert.match(settings, /Last payload/);
  assert.match(settings, /crmWebhookDeliveryStatus/);
  assert.match(settings, /name="crm_sync_mode"/);
  assert.match(settings, /Save CRM handoff/);
  assert.match(settings, /Handoff contract/);
  assert.match(settings, /bombsell_signals_list_qualified/);
  assert.match(settings, /bombsell_crm_handoff_queue/);
  assert.match(settings, /crm\.destination\.configured/);
  assert.match(outputDestinations, /Outreach tool sync/);
  assert.match(outputDestinations, /Team alerts/);
  assert.match(settings, /evented integrations rather than decorative install buttons/);
  assert.match(settings, /ContactQualityPanel/);
  assert.match(settings, /Signal watchlist and contact-quality gates/);
  assert.match(settings, /Pitch \/ value prop/);
  assert.match(settings, /Customer pain points/);
  assert.match(settings, /Who you target \/ buyer roles/);
  assert.match(settings, /Target markets/);
  assert.match(settings, /Key features/);
  assert.match(settings, /Social proof/);
  assert.match(settings, /Key signal keywords/);
  assert.match(settings, /Competitors to watch/);
  assert.match(settings, /LinkedIn behavior to watch/);
  assert.match(settings, /name="linkedin_signal_behaviors"/);
  assert.match(settings, /Company and team engagement/);
  assert.match(settings, /Keyworded post likes and comments/);
  assert.match(settings, /Do not contact/);
  assert.match(settings, /Preferred language/);
  assert.match(settings, /Outreach goal/);
  assert.match(settings, /Message tone/);
  assert.match(settings, /LinkedIn company page/);
  assert.match(settings, /Auto-enrich email addresses/);
  assert.match(settings, /Prevent duplicate contacts/);
  assert.match(settings, /Email enrichment/);
  assert.match(settings, /Duplicate protection/);
  assert.match(
    settings,
    /jsonb_each\(coalesce\(p\.properties->'email_verification'/,
  );
  assert.match(settings, /href="\/dashboard\/agent#verified-contacts"/);
  assert.match(settings, /Open Agent contacts/);
  assert.match(settings, /Blocklist/);
  assert.match(
    settings,
    /Bounces, unsubscribes, and do-not-contact events protect future\s+outreach automatically/,
  );
  assert.match(
    settings,
    /kind in \('bounce','unsubscribe','do_not_contact'\)/,
  );
  assert.match(settings, /href="\/dashboard\/agent#outreach"/);
  assert.match(settings, /Open Agent outreach/);
  assert.doesNotMatch(settings, /Open contact graph/);
  assert.doesNotMatch(settings, /Open prospect graph/);
  assert.doesNotMatch(settings, /Open outcome ledger/);
  assert.doesNotMatch(settings, /do-not-contact outcomes/);
  assert.match(
    settings,
    /href="\/api\/auth\/outlook\?return_to=%2Fdashboard%2Fprofile%23email"/,
  );
  // LinkedIn connection is coming soon — the connect action is intentionally
  // disabled, so the OAuth start link must not be rendered.
  assert.doesNotMatch(
    settings,
    /href="\/api\/auth\/linkedin\?return_to=%2Fdashboard%2Fprofile%23linkedin"/,
  );
  assert.match(settings, /id="agent"/);
  assert.match(settings, /id="motion"/);
  assert.match(settings, /id="tools"/);
  assert.match(outputDestinations, /href: "\/dashboard\/profile#claude-code"/);
  assert.match(settings, /Voice & autonomy/);
  assert.match(settings, /AI outreach template/);
  assert.match(settings, /name="rep_story"/);
  assert.match(settings, /verified contact or LinkedIn profile/);
  assert.match(settings, /return_to" value="\/dashboard\/profile"/);
  assert.match(settings, /Saving voice/);
  assert.match(settings, /Saving mode/);
  assert.match(settings, /value="autonomous"/);
  assert.match(settings, /value="review_only"/);
  assert.match(settings, /Auto-send after checks/);
  assert.match(settings, /Approve first/);
  assert.match(settings, /Prepare every move, then wait for a human approval before outreach/);
  assert.match(settings, /Send after evals, caps, contact checks, and channel health pass/);
  assert.match(settings, /row_number\(\) over/);
  assert.match(settings, /properties ->> 'mailbox_email'/);
  assert.match(actions, /dashboardReturnPath\(formData, "\/dashboard\/profile#agent"\)/);
  assert.match(actions, /value_proposition/);
  assert.match(actions, /customer_pain_points/);
  assert.match(actions, /target_titles/);
  assert.match(actions, /target_markets/);
  assert.match(actions, /signal_keywords/);
  assert.match(actions, /competitor_watchlist/);
  assert.match(actions, /linkedin_signal_behaviors/);
  assert.match(actions, /exclusion_rules/);
  assert.match(actions, /auto_enrich_email_addresses/);
  assert.match(actions, /prevent_team_contact_duplication/);
  assert.match(actions, /configureWorkspaceAutonomyMode/);
  assert.match(actions, /dismissProductSignal/);
  assert.match(actions, /recordProductPersonFitFeedback/);
  assert.match(actions, /export async function revokeMcpTokenAction/);
  assert.match(actions, /revoked_by_user_id = \$2/);
  assert.match(actions, /and user_id = \$2/);
  assert.match(actions, /Claude Code access revoked/);
  assert.match(contactResolution, /contact\.profile_policy\.load/);
  assert.match(contactResolution, /auto_enrich_email_addresses/);
  assert.match(contactResolution, /email_auto_enrich_disabled/);
  assert.match(contactResolution, /prevent_team_contact_duplication/);
  assert.match(contactResolution, /counterparty_person_id = graph_persons\.id/);
  assert.match(productApp, /event_type: "workspace\.configured"/);
  assert.match(productApp, /event_type: "rep\.configured"/);
  assert.match(productApp, /event_type: "play\.configured"/);
  assert.match(productApp, /event_type: "signal\.dismissal\.requested"/);
  assert.match(productApp, /event_type: "person\.fit_feedback\.recorded"/);
  assert.match(productApp, /event_type: "signal\.outreach\.gated"/);
  assert.match(productApp, /publishSignalOutreachGated/);
  assert.match(productApp, /loadPersonContactFitDecision/);
  assert.match(productApp, /projectPersonFitFeedback/);
  assert.match(productApp, /projectSignalDismissal/);
  assert.match(registry, /"signal\.dismissal\.requested": SignalDismissalRequested/);
  assert.match(registry, /"person\.fit_feedback\.recorded": PersonFitFeedbackRecorded/);
  assert.match(registry, /"signal\.outreach\.gated": SignalOutreachGated/);
  assert.match(registry, /"workspace\.configured": WorkspaceConfigured/);
});

test("Integrations surface hosts connections and MCP instructions", () => {
  const integrations = source("app/dashboard/integrations/page.tsx");
  const outlook = source("app/api/auth/outlook/route.ts");
  const linkedIn = source("app/api/auth/linkedin/route.ts");

  assert.match(integrations, /Integrations \| Bombsell/);
  assert.match(integrations, /Outlook \/ Microsoft 365/);
  assert.match(integrations, /\/api\/auth\/outlook\?return_to=/);
  // LinkedIn is Coming soon in the UI — matches the LinkedIn native-engagement
  // gap called out in ARCHITECTURE.md.
  assert.doesNotMatch(integrations, /\/api\/auth\/linkedin\?return_to=/);
  assert.match(integrations, /Coming soon/);
  assert.match(integrations, /MCP for Claude \/ Codex/);
  assert.match(outlook, /authCallbackOrigin/);
  assert.match(linkedIn, /authCallbackOrigin/);
  assert.match(linkedIn, /safeReturnTo/);
  assert.match(linkedIn, /return_to: returnTo/);
});

test("LinkedIn OAuth returns to current product hubs instead of legacy prospecting", () => {
  const linkedInRoute = source("app/api/auth/linkedin/route.ts");
  const linkedInCallback = source("app/api/auth/linkedin/callback/route.ts");
  const linkedInWebhook = source("app/api/webhooks/linkedin/route.ts");
  const eventRegistry = source("core/substrate/events/registry.ts");
  const productApp = source("core/product/app.ts");
  const linkedInState = source("app/api/auth/linkedin/state.ts");
  const settings = source("app/dashboard/profile/ProfilePage.tsx");

  assert.match(linkedInState, /return_to\?: string/);
  assert.match(linkedInRoute, /safeReturnTo\(req\.nextUrl\.searchParams\.get\("return_to"\)\)/);
  assert.match(linkedInCallback, /state\.return_to \?\? "\/dashboard\/profile#linkedin"/);
  assert.match(linkedInCallback, /dest\.searchParams\.set\("status", "linkedin_connecting"\)/);
  // LinkedIn connection is coming soon — UI no longer renders the OAuth start link.
  assert.doesNotMatch(settings, /href="\/api\/auth\/linkedin\?return_to=%2Fdashboard%2Fprofile%23linkedin"/);
  assert.match(settings, /id="channels"/);
  assert.match(settings, /scroll-mt-28/);
  assert.match(linkedInWebhook, /payload\.event === "connection_accepted"/);
  assert.match(linkedInWebhook, /event_type: "linkedin\.connection\.accepted"/);
  assert.match(linkedInWebhook, /person_id: payload\.person_id/);
  assert.match(linkedInWebhook, /conversation_id: payload\.conversation_id/);
  assert.match(linkedInWebhook, /message_id: payload\.message_id/);
  assert.match(linkedInWebhook, /accepted_at: payload\.occurred_at/);
  assert.match(eventRegistry, /const LinkedInConnectionAccepted = z\.object/);
  assert.match(eventRegistry, /person_id: z\.string\(\)\.uuid\(\)\.nullable\(\)\.optional\(\)/);
  assert.match(
    eventRegistry,
    /conversation_id: z\.string\(\)\.uuid\(\)\.nullable\(\)\.optional\(\)/,
  );
  assert.match(eventRegistry, /message_id: z\.string\(\)\.uuid\(\)\.nullable\(\)\.optional\(\)/);
  assert.match(
    eventRegistry,
    /"linkedin\.connection\.accepted": LinkedInConnectionAccepted/,
  );
  assert.match(productApp, /"linkedin\.connection\.accepted"/);
  assert.match(productApp, /dispatchLinkedInAcceptedFollowupsOnce/);
  assert.match(productApp, /dispatchLinkedInAcceptedFollowups\(\{ limit \}\)/);
  assert.match(
    productApp,
    /product-linkedin-accepted-followup-dispatcher-v1/,
  );
  assert.match(productApp, /event_type = 'linkedin\.connection\.accepted'/);
  assert.match(productApp, /coalesce\(nullif\(e\.payload->>'accepted_at', ''\)::timestamptz, e\.occurred_at\)/);
  assert.match(productApp, /p\.id::text = accepted\.payload_person_id/);
  assert.match(productApp, /p\.linkedin_url = accepted\.profile_url/);
  assert.match(productApp, /coalesce\(p\.id, c\.counterparty_person_id\) as person_id/);
  assert.match(productApp, /c\.counterparty_company_id/);
  assert.match(productApp, /c\.origin_signal_id/);
  assert.match(productApp, /m\.channel in \('linkedin_dm','linkedin_inmail','linkedin_comment'\)/);
  assert.match(productApp, /followup\.id is null/);
  assert.match(productApp, /repair_key: `accepted:\$\{row\.accepted_event_id\}`/);
  assert.doesNotMatch(linkedInCallback, /\/dashboard\/prospecting/);
});

test("account connection entry points carry explicit product return targets", () => {
  const surfaces = [
    source("app/dashboard/profile/ProfilePage.tsx"),
    source("app/dashboard/integrations/page.tsx"),
    source("app/dashboard/setup/page.tsx"),
    source("app/dashboard/deliverability/page.tsx"),
    source("app/dashboard/agent/AgentPage.tsx"),
    source("app/dashboard/conversations/page.tsx"),
    source("app/dashboard/agent/contacts/[id]/ContactPage.tsx"),
  ].join("\n");

  assert.doesNotMatch(surfaces, /href="\/api\/auth\/outlook"/);
  assert.doesNotMatch(surfaces, /href="\/api\/auth\/linkedin"/);
  assert.match(surfaces, /\/api\/auth\/outlook\?return_to=/);
  // LinkedIn connection is coming soon — no LinkedIn OAuth entry point in the UI.
  assert.doesNotMatch(surfaces, /\/api\/auth\/linkedin\?return_to=/);
  assert.doesNotMatch(surfaces, /\/api\/auth\/outlook\?return_to=\/dashboard\/deliverability/);
});

test("new product defaults are autonomous after checks", () => {
  const actions = source("app/dashboard/actions.ts");
  const settings = source("app/dashboard/profile/ProfilePage.tsx");
  const productApp = source("core/product/app.ts");
  const playAutonomy = source("core/plays/autonomy.ts");
  const repPrimitive = source("core/primitives/rep.ts");
  const activationGraph = source("core/agents/langgraph/graphs/activation.ts");
  const productTools = source("core/product/tools.ts");
  const migration = source("db/migrations/038_autonomous_default_backfill.sql");

  assert.match(actions, /fallback: DashboardApprovalPolicy = "none"/);
  assert.match(
    settings,
    /const approval = profileApproval\(rep\)/,
  );
  assert.match(
    productApp,
    /const DEFAULT_CHANNEL_APPROVAL: ApprovalPolicy = "none"/,
  );
  assert.match(
    productApp,
    /default_channel_approval: DEFAULT_CHANNEL_APPROVAL/,
  );
  assert.match(playAutonomy, /approval: "none"/);
  assert.match(repPrimitive, /\.default\("none"\)/);
  assert.match(activationGraph, /approval: "none"/);
  assert.match(productTools, /approval: ApprovalSchema\.default\("none"\)/);
  assert.match(migration, /default_channel_approval/);
  assert.match(migration, /value->>'approval' = 'approve_first'/);
  assert.match(
    migration,
    /jsonb_set\(value, '\{approval\}', '"none"'::jsonb, true\)/,
  );
});

test("Signal ingress matching dispatch is centralized in the product dispatcher", () => {
  const productApp = source("core/product/app.ts");
  const productionWorker = source("scripts/production-worker.ts");
  const projectorsWorker = source("scripts/projectors-worker.ts");
  const signalProjectorsWorker = source("scripts/signal-projectors-worker.ts");
  const capabilityMap = source("docs/agent-native-capability-map.md");

  assert.match(productApp, /registerSignalMatchingEventDispatcher/);
  assert.match(productApp, /dispatchSignalMatchingWorkflowFromIngestedEvent/);
  assert.match(productApp, /product-signal-matching-workflow-dispatcher-v1/);
  assert.match(
    productionWorker,
    /dispatchSignalMatchingWorkflowFromIngestedEvent/,
  );
  assert.match(projectorsWorker, /registerSignalMatchingEventDispatcher/);
  assert.match(signalProjectorsWorker, /registerSignalMatchingEventDispatcher/);
  assert.doesNotMatch(
    productionWorker,
    /subscribeScoped\(\s*"\*",\s*"signal\.ingested"/,
  );
  assert.doesNotMatch(
    projectorsWorker,
    /subscribeScoped\(\s*"\*",\s*"signal\.ingested"/,
  );
  assert.doesNotMatch(
    signalProjectorsWorker,
    /subscribeScoped\(\s*"\*",\s*"signal\.ingested"/,
  );
  assert.match(capabilityMap, /product-signal-matching-workflow-dispatcher-v1/);
});

test("matchWorkspaceSignal short-circuits terminal read-model states before classifying", () => {
  const productApp = source("core/product/app.ts");
  const matchWorkspaceSignal = productApp.slice(
    productApp.indexOf("export async function matchWorkspaceSignal"),
    productApp.indexOf("function parseSignalKind"),
  );

  assert.match(matchWorkspaceSignal, /status::text as status/);
  assert.match(matchWorkspaceSignal, /audience_hint/);
  assert.match(
    matchWorkspaceSignal,
    /signal\.status === "matched" \|\| signal\.status === "spent" \|\| signal\.status === "dismissed"/,
  );
  assert.match(matchWorkspaceSignal, /matchWorkspaceSignalTerminalResult/);
  assert.ok(
    matchWorkspaceSignal.indexOf("matchWorkspaceSignalTerminalResult") <
      matchWorkspaceSignal.indexOf("classifySignal("),
    "terminal read-model check must run before classifySignal",
  );
});

test("channel connection wakes launch readiness through the product backend", () => {
  const productApp = source("core/product/app.ts");
  const channelWorkflow = source(
    "core/agents/langgraph/workflows/channel-readiness.ts",
  );
  const release = source("scripts/verify-worker-release.ts");

  assert.match(productApp, /runWorkspaceChannelReadiness/);
  assert.match(productApp, /WorkspaceChannelReadinessRunResult/);
  assert.match(productApp, /channelReadinessIdempotencyKey/);
  assert.match(productApp, /createChannelConnectionReadinessProjection/);
  assert.match(
    productApp,
    /name: "workspace\.channel_readiness_on_connection\.v1"/,
  );
  assert.match(productApp, /eventTypes: \["channel\.account\.connected"\]/);
  assert.match(productApp, /WORKSPACE_CHANNEL_READINESS_WORKFLOW/);
  assert.match(productApp, /workflow_name: WORKSPACE_CHANNEL_READINESS_WORKFLOW/);
  assert.match(productApp, /idempotency_key: `channel\.readiness\.connected:\$\{event\.id\}`/);
  assert.match(productApp, /causation_event_id: event\.id/);
  assert.match(productApp, /required_channel: "any"/);
  assert.match(productApp, /userIdFromProducerRef/);
  assert.match(
    productApp,
    /Channel readiness refresh waiting for connected account/,
  );
  assert.match(channelWorkflow, /WORKSPACE_CHANNEL_READINESS_WORKFLOW = "workspace\.channel\.readiness"/);
  assert.match(release, /workspace\.channel\.readiness/);
});

test("meeting-intent replies wake prep and reply workflows", () => {
  const intent = source("core/channels/email/intent.ts");
  const productApp = source("core/product/app.ts");
  const capabilityMap = source("docs/agent-native-capability-map.md");

  assert.match(intent, /meeting_intent/);
  assert.match(
    productApp,
    /e\.payload->>'intent' in \('meeting_intent', 'positive'\)/,
  );
  assert.match(
    productApp,
    /e\.payload->>'intent' in \('meeting_intent', 'positive', 'neutral'\)/,
  );
  assert.match(capabilityMap, /meeting-intent or positive/);
});

test("onboarding website setup starts activation then durable Signal ingestion", () => {
  const onboardingActions = source("app/onboarding/actions.ts");
  const onboardingForm = source("app/onboarding/OnboardingForm.tsx");
  const onboardingPage = source("app/onboarding/page.tsx");
  const activationGraph = source("core/agents/langgraph/graphs/activation.ts");
  const productApp = source("core/product/app.ts");
  const productTools = source("core/product/tools.ts");
  const capabilityMap = source("docs/agent-native-capability-map.md");

  assert.match(onboardingPage, /Enter your website\. Bombsell builds the Profile/);
  assert.match(onboardingPage, /Launch agent/);
  assert.match(onboardingPage, /positioning, proof, and goals/);
  assert.match(onboardingPage, /signal sources, verified contacts/);
  assert.match(onboardingPage, /Outlook and LinkedIn/);
  assert.match(onboardingPage, /\[1, 2, 3\]\.map/);
  assert.doesNotMatch(onboardingPage, /\[1, 2, 3, 4\]\.map/);
  assert.match(onboardingPage, /Profile \+ channels/);
  assert.match(onboardingPage, /Connect Outlook and LinkedIn in Profile/);
  assert.match(onboardingPage, /Signals, verified contacts, drafts, sends, and replies/);
  assert.match(onboardingPage, /outreach rules, and the first Agent queue/);
  assert.doesNotMatch(onboardingPage, /sources,\s+plays, and the first Agent queue/);
  assert.doesNotMatch(onboardingPage, /label="Integrations"/);
  assert.match(onboardingForm, /Start with the website/);
  assert.match(onboardingForm, /learn the company, audience, signal sources/);
  assert.match(onboardingForm, /<details className=/);
  assert.match(onboardingForm, /Optional launch context/);
  assert.match(onboardingForm, /Use these fields when the website is sparse/);
  assert.match(onboardingForm, /Description and value proposition/);
  assert.match(onboardingForm, /Customer pain points/);
  assert.match(onboardingForm, /Buyer roles/);
  assert.match(onboardingForm, /Customer logos, wins, testimonials, or proof points/);
  assert.doesNotMatch(onboardingForm, /Customer logos, outcomes, testimonials/);
  assert.match(onboardingForm, /Target markets/);
  assert.match(onboardingForm, /Key features/);
  assert.match(onboardingForm, /Social proof/);
  assert.match(onboardingForm, /Signal keywords/);
  assert.match(onboardingForm, /Competitors to watch/);
  assert.match(onboardingForm, /Do not contact/);
  assert.match(onboardingForm, /name="outreach_goal"/);
  assert.match(onboardingForm, /name="message_tone"/);
  assert.match(onboardingForm, /preferred_language/);
  assert.match(onboardingForm, /Launch agent/);
  assert.match(onboardingForm, /Building Profile/);
  assert.doesNotMatch(onboardingPage, /Create Outreach Agent/);
  assert.doesNotMatch(onboardingForm, /Create Outreach Agent/);
  assert.match(onboardingActions, /runWorkspaceActivationSetup/);
  assert.match(onboardingActions, /industry_hint/);
  assert.match(onboardingActions, /description_hint/);
  assert.match(onboardingActions, /customer_pain_points/);
  assert.match(onboardingActions, /target_titles/);
  assert.match(onboardingActions, /target_markets/);
  assert.match(onboardingActions, /signal_keywords/);
  assert.match(onboardingActions, /competitor_watchlist/);
  assert.match(onboardingActions, /linkedin_signal_behaviors/);
  assert.match(onboardingActions, /exclusion_rules/);
  assert.match(onboardingActions, /preferred_language/);
  assert.doesNotMatch(onboardingActions, /runWorkspaceSignalIngestion/);
  assert.match(activationGraph, /signalIngestionRun/);
  assert.match(activationGraph, /product\.signal\.ingestion\.run/);
  assert.match(onboardingActions, /wait: false/);
  assert.match(onboardingActions, /POST_ONBOARDING_PATH = "\/dashboard\/profile#channels"/);
  assert.match(onboardingActions, /redirect\(POST_ONBOARDING_PATH\)/);
  assert.doesNotMatch(onboardingActions, /runWorkspaceSignalAggregatorOnce/);
  assert.match(activationGraph, /description_hint/);
  assert.match(activationGraph, /customer_pain_points/);
  assert.match(activationGraph, /Buyer role:/);
  assert.match(activationGraph, /Target market:/);
  assert.match(activationGraph, /Signal keyword:/);
  assert.match(activationGraph, /Competitor watch:/);
  assert.match(activationGraph, /LinkedIn behavior:/);
  assert.match(activationGraph, /Exclude:/);
  assert.match(activationGraph, /outreach_goal/);
  assert.match(activationGraph, /message_tone/);
  assert.match(activationGraph, /name: "Outbound agent"/);
  assert.match(activationGraph, /defaultOutreachSignalKinds/);
  assert.match(activationGraph, /\["press_mention", "product_launch", "hiring"\]/);
  assert.match(activationGraph, /signalEmailPlayConfigure/);
  assert.match(activationGraph, /additional_linkedin_play_configure/);
  assert.doesNotMatch(activationGraph, /name: "Sampark"/);
  assert.match(productApp, /input\.name\.trim\(\) \|\| "Outbound agent"/);
  assert.match(productApp, /name: "Outbound agent"/);
  assert.doesNotMatch(productApp, /name: "Content agent"/);
  assert.doesNotMatch(productApp, /name: "Campaign agent"/);
  assert.doesNotMatch(productApp, /name: "Research agent"/);
  assert.doesNotMatch(
    productApp,
    /await ensureDefaultRepTeam\(engine, session\.workspace_id, session\.user_id\)/,
  );
  assert.match(onboardingForm, /createActivationSetupFormAction/);
  assert.match(onboardingForm, /name="linkedin_signal_behaviors"/);
  assert.doesNotMatch(onboardingForm, /createProfileAndAggregatorFormAction/);
  assert.match(productTools, /name: "product\.activation\.setup\.run"/);
  assert.match(productTools, /industry_hint/);
  assert.match(productTools, /description_hint/);
  assert.match(productTools, /target_titles/);
  assert.match(productTools, /target_markets/);
  assert.match(productTools, /signal_keywords/);
  assert.match(productTools, /competitor_watchlist/);
  assert.match(productTools, /linkedin_signal_behaviors/);
  assert.match(productTools, /exclusion_rules/);
  assert.match(productTools, /preferred_language/);
  assert.match(productTools, /runWorkspaceActivationSetup/);
  assert.match(productTools, /runWorkspaceSignalIngestion/);
  assert.match(productTools, /initial_signal_ingestion/);
  assert.match(productApp, /activationSetupIdempotencyKey/);
  assert.match(productApp, /message_tone/);
  assert.match(productApp, /compactSearchTerms\(\s*marketPhrase,\s*keywordPhrase/);
  assert.match(capabilityMap, /`\/onboarding` completion/);
  assert.match(capabilityMap, /`product\.activation\.setup\.run`/);
  assert.match(capabilityMap, /starts `workspace\.signal\.ingestion`/);
  assert.match(capabilityMap, /`product\.signal\.ingestion\.run`/);
});

test("failed workflow recovery starts a fresh correlated durable run", () => {
  const productApp = source("core/product/app.ts");
  const start = productApp.indexOf("export async function retryFailedWorkflowRun");
  const end = productApp.indexOf(
    "export async function redriveDeadLetteredEventDispatch",
    start,
  );
  const retryOperation = productApp.slice(start, end);

  assert.match(retryOperation, /engine\.runtime\.start/);
  assert.match(retryOperation, /idempotency_key: `recovery:/);
  assert.doesNotMatch(retryOperation, /Date\.now\(\)/);
  assert.match(retryOperation, /correlation_id: run\.id/);
  assert.match(retryOperation, /idempotency_key: `workflow\.run\.retried:/);
  assert.match(retryOperation, /event_type: "workflow\.run\.retried"/);
  assert.doesNotMatch(retryOperation, /engine\.runtime\.resume/);
});

test("visual system uses the clean light operating surface", () => {
  const globals = source("app/globals.css");
  const layout = source("app/layout.tsx");
  const home = source("app/page.tsx");
  const design = source("DESIGN.md");

  assert.match(globals, /Bombsell Design System v2 — inspired by Ploy\.ai/);
  assert.match(globals, /--color-ink-1: #f4f4f4/);
  assert.match(globals, /--color-line-1: #e3e3e3/);
  assert.match(globals, /--color-text-1: #212121/);
  assert.match(globals, /--color-accent: #26575e/);
  assert.match(globals, /--color-cta-bg: #212121/);
  assert.match(globals, /--color-brand-pink: #ffb8fc/);
  assert.match(globals, /:root \{ color-scheme: light; \}/);
  assert.match(layout, /colorScheme: "light"/);
  assert.match(home, /Autonomous outbound/);
  assert.match(home, /Grow your sales with high-intent outreach/);
  assert.match(home, /across email and LinkedIn/);
  assert.match(home, /Your buyer profile builds itself/);
  assert.doesNotMatch(home, /Signal-led prospecting/);
  assert.doesNotMatch(home, /Multi-channel plays/);
  assert.doesNotMatch(home, /run the plays/);
  assert.doesNotMatch(home, /function SolarSystem/);
  assert.match(design, /The Signal Operating Surface/);
});

test("dashboard icon names resolve to first-party SVG symbols", () => {
  const iconSource = source("components/Icon.tsx");
  const brandIconSource = source("components/BrandIcon.tsx");
  const surfaces = [
    source("app/page.tsx"),
    source("components/dashboard/Shell.tsx"),
    source("app/onboarding/OnboardingForm.tsx"),
    source("app/dashboard/brief/page.tsx"),
    source("app/dashboard/agent/AgentPage.tsx"),
    source("app/dashboard/profile/ProfilePage.tsx"),
    source("app/dashboard/ingestion/page.tsx"),
    source("app/dashboard/deliverability/page.tsx"),
    source("app/dashboard/campaigns/page.tsx"),
    source("app/dashboard/prospects/page.tsx"),
    source("app/dashboard/agent/contacts/[id]/ContactPage.tsx"),
  ].join("\n");
  const defined = new Set(
    Array.from(iconSource.matchAll(/^  ([a-z0-9_]+):/gm), (match) => match[1]),
  );
  const brandDefined = new Set(
    Array.from(
      brandIconSource.matchAll(/type BrandIconName = ([^;]+);/g),
      (match) => match[1],
    )
      .flatMap((value) => value.match(/"([a-z0-9_]+)"/g) ?? [])
      .map((value) => value.replace(/"/g, "")),
  );
  const used = new Set(
    Array.from(
      surfaces.matchAll(/(?:Icon name|icon)="([a-z0-9_]+)"/g),
      (match) => match[1],
    ),
  );
  const missing = Array.from(used)
    .filter((name) => !defined.has(name) && !brandDefined.has(name))
    .sort();

  assert.deepEqual(missing, []);
  assert.match(brandIconSource, /"google" \| "linkedin" \| "microsoft"/);
  assert.match(iconSource, /person_search:/);
  assert.match(iconSource, /radar:/);
  assert.match(iconSource, /verified:/);
  assert.match(iconSource, /play_arrow:/);
});

test("Bombsell logo asset stays canonical and untinted", () => {
  // The brand logo now renders via the shared marketing chrome on public
  // pages and via Shell in the app. Partner "Works with" logos on the
  // landing page legitimately use grayscale, so the untinted invariant is
  // asserted against the brand-logo surfaces, not the whole landing file.
  const chrome = source("components/marketing/MarketingChrome.tsx");
  const shell = source("components/dashboard/Shell.tsx");
  const logo = source("public/logo.svg");

  assert.match(chrome, /src="\/logo\.svg"/);
  assert.match(shell, /src="\/logo\.svg"/);
  assert.doesNotMatch(
    chrome,
    /filter-|invert|grayscale|sepia|hue-rotate|brightness|contrast/,
  );
  assert.doesNotMatch(
    shell,
    /filter-|invert|grayscale|sepia|hue-rotate|brightness|contrast/,
  );
  assert.match(logo, /fill="#23555C"/);
  assert.match(logo, /fill="#FCFCFD"/);
  assert.match(logo, /fill="#26575E"/);
});

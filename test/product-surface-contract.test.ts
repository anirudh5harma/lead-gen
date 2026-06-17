import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("dashboard navigation uses active product surface routes", () => {
  const shell = source("components/dashboard/Shell.tsx");
  const primaryNav = shell.slice(
    shell.indexOf("const NAV"),
    shell.indexOf("const FLOW"),
  );

  assert.match(primaryNav, /href: "\/dashboard",\s+label: "Dashboard"/);
  assert.match(primaryNav, /href: "\/dashboard\/agent",\s+label: "Agent"/);
  assert.match(primaryNav, /"\/dashboard\/reps"/);
  assert.match(primaryNav, /href: "\/dashboard\/settings",\s+label: "Profile"/);
  assert.match(primaryNav, /"\/dashboard\/conversations"/);
  assert.match(primaryNav, /"\/dashboard\/signals"/);
  assert.match(primaryNav, /"\/dashboard\/plays"/);
  assert.match(primaryNav, /"\/dashboard\/outcomes"/);
  assert.doesNotMatch(primaryNav, /label: "Outreach"/);
  assert.doesNotMatch(primaryNav, /label: "Prospects"/);
  assert.doesNotMatch(primaryNav, /label: "Inbox"/);
  assert.doesNotMatch(primaryNav, /label: "Signals"/);
  assert.doesNotMatch(primaryNav, /label: "Plays"/);
  assert.doesNotMatch(primaryNav, /label: "Outcomes"/);
  assert.doesNotMatch(
    primaryNav,
    /href: "\/dashboard\/prospecting", label: "Prospecting"/,
  );
  assert.doesNotMatch(
    primaryNav,
    /href: "\/dashboard\/prospects", label: "Prospects"/,
  );
  assert.match(shell, /ProductFlowRail/);
  assert.match(shell, /aria-label="Product flow"/);
  assert.match(shell, /href: "\/dashboard\/settings#profile"/);
  assert.match(shell, /href: "\/dashboard\/agent#sources"/);
  assert.match(shell, /href: "\/dashboard\/signals"/);
  assert.match(shell, /href: "\/dashboard\/agent#outreach"/);
  assert.match(shell, /detail: "ICP \+ integrations"/);
  assert.match(shell, /detail: "Signal strategy"/);
  assert.match(shell, /detail: "Qualified contacts"/);
  assert.match(shell, /detail: "Emails \+ DMs"/);
  assert.match(shell, /metric: "profile"/);
  assert.match(shell, /metric: "sources"/);
  assert.match(shell, /metric: "signals"/);
  assert.match(shell, /metric: "outreach"/);
  assert.match(shell, /isActiveFlowItem/);
  assert.match(shell, /window\.location\.hash/);
  assert.match(shell, /hashchange/);
  assert.match(shell, /hrefPath\(href\) === pathname/);
});

test("dashboard product flow rail renders live status metrics safely", () => {
  const shell = source("components/dashboard/Shell.tsx");
  const layout = source("app/dashboard/layout.tsx");

  assert.match(shell, /export interface ProductFlowMetrics/);
  assert.match(shell, /DEFAULT_FLOW_METRICS/);
  assert.match(shell, /flowMetrics = DEFAULT_FLOW_METRICS/);
  assert.match(shell, /flowMetrics\[item\.metric\]/);
  assert.match(shell, /metric\.tone === "ready"/);
  assert.match(shell, /metric\.tone === "waiting"/);
  assert.match(shell, /grid-cols-\[32px_minmax\(0,1fr\)_auto\]/);

  assert.match(layout, /loadProductFlowMetrics/);
  assert.match(layout, /try \{/);
  assert.match(layout, /catch \(err\)/);
  assert.match(layout, /return EMPTY_FLOW_METRICS/);
  assert.match(layout, /from graph_companies gc/);
  assert.match(layout, /properties->>'profile_role' = 'workspace_company'/);
  assert.match(layout, /from channel_accounts ca/);
  assert.match(layout, /'oauth_outlook'/);
  assert.match(layout, /'linkedin_session'/);
  assert.match(layout, /from workspace_source_configs wsc/);
  assert.match(layout, /join graph_sources gs/);
  assert.match(layout, /from signals s/);
  assert.match(layout, /s\.status in \('matched','in_play'\)/);
  assert.match(layout, /from messages m/);
  assert.match(layout, /'linkedin_dm'/);
  assert.match(layout, /outreach_sent_7d/);
});

test("Agent is the canonical dashboard surface route", () => {
  const agentPage = source("app/dashboard/agent/page.tsx");
  const agentDetailPage = source("app/dashboard/agent/[id]/page.tsx");

  assert.match(agentPage, /export const dynamic = "force-dynamic"/);
  assert.match(agentPage, /from "\.\.\/reps\/page"/);
  assert.match(agentDetailPage, /export const dynamic = "force-dynamic"/);
  assert.match(agentDetailPage, /from "\.\.\/\.\.\/reps\/\[id\]\/page"/);
  assert.match(
    source("app/dashboard/agent/loading.tsx"),
    /from "\.\.\/reps\/loading"/,
  );
  assert.match(
    source("app/dashboard/agent/[id]/loading.tsx"),
    /from "\.\.\/\.\.\/reps\/\[id\]\/loading"/,
  );

  const productLinks = [
    source("components/dashboard/Shell.tsx"),
    source("app/dashboard/page.tsx"),
    source("app/dashboard/reps/page.tsx"),
    source("app/dashboard/reps/[id]/page.tsx"),
    source("app/dashboard/setup/page.tsx"),
    source("app/dashboard/prospects/[id]/page.tsx"),
    source("app/dashboard/actions.ts"),
    source("core/product/launch-readiness.ts"),
  ].join("\n");

  assert.match(productLinks, /\/dashboard\/agent/);
  assert.doesNotMatch(productLinks, /href="\/dashboard\/reps/);
  assert.doesNotMatch(productLinks, /href=\{`\/dashboard\/reps/);
  assert.doesNotMatch(productLinks, /value="\/dashboard\/reps/);
  assert.doesNotMatch(productLinks, /Configure Rep", \["product\.rep\.configure"\], "\/dashboard\/reps"/);
});

test("canonical Prospecting and Signals routes preserve old implementations", () => {
  assert.match(
    source("app/dashboard/prospecting/page.tsx"),
    /from "\.\.\/setup\/page"/,
  );
  assert.match(
    source("app/dashboard/signals/page.tsx"),
    /from "\.\.\/ingestion\/page"/,
  );
  assert.match(
    source("app/dashboard/prospecting/loading.tsx"),
    /surface="prospecting"/,
  );
  assert.match(
    source("app/dashboard/signals/loading.tsx"),
    /surface="signals"/,
  );

  const actions = source("app/dashboard/actions.ts");
  assert.match(actions, /revalidatePath\("\/dashboard\/prospecting"\)/);
  assert.match(actions, /revalidatePath\("\/dashboard\/signals"\)/);
});

test("retired product surfaces redirect to Agent", () => {
  assert.match(
    source("app/dashboard/content/page.tsx"),
    /redirect\("\/dashboard\/agent"\)/,
  );
  assert.match(
    source("app/dashboard/aeo/page.tsx"),
    /redirect\("\/dashboard\/agent"\)/,
  );
});

test("Dashboard routes setup work through Settings and current surfaces", () => {
  const dashboard = source("app/dashboard/page.tsx");
  const appLayout = source("app/layout.tsx");
  const urlStart = source("components/UrlStart.tsx");

  assert.match(dashboard, /Welcome back/);
  assert.match(dashboard, /Qualified signals/);
  assert.match(dashboard, /Emails sent/);
  assert.match(dashboard, /LinkedIn DMs/);
  assert.match(dashboard, /Replies \/ meetings/);
  assert.match(dashboard, /Signal mix/);
  assert.match(dashboard, /Agent insight/);
  assert.match(dashboard, /href: "\/dashboard\/settings#profile"/);
  assert.match(dashboard, /href="\/dashboard\/agent#outreach"/);
  assert.match(dashboard, /href="\/dashboard\/agent#verified-contacts"/);
  assert.match(source("app/dashboard/brief/page.tsx"), /redirect\("\/dashboard"\)/);
  assert.doesNotMatch(dashboard, /href: "\/dashboard\/prospecting"/);
  assert.match(appLayout, /Profile, quality signals, verified contacts/);
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

test("Setup presents separate Outlook and LinkedIn connection gates", () => {
  const setup = source("app/dashboard/setup/page.tsx");

  assert.match(setup, /href="\/api\/auth\/outlook\?return_to=%2Fdashboard%2Fsettings%23email"/);
  assert.match(setup, /href="\/api\/auth\/linkedin\?return_to=%2Fdashboard%2Fsettings%23linkedin"/);
  assert.match(
    setup,
    /kind in \('email_domain','oauth_outlook','linkedin_session','linkedin_oauth'\)/,
  );
  assert.match(setup, /Ready" value=\{`\$\{readyCount\}\/5`\}/);
  assert.match(setup, /Finds verified contacts and moves outreach/);
  assert.match(setup, /const AGENT_ORDER = \["Outbound agent"\]/);
  assert.doesNotMatch(setup, /Learning: \{/);
  assert.doesNotMatch(setup, /href: "\/dashboard\/plays"/);
  assert.doesNotMatch(setup, /prospecting profile/);
});

test("Outlook connection surfaces collapse duplicate rows by mailbox identity", () => {
  const setup = source("app/dashboard/setup/page.tsx");
  const deliverability = source("app/dashboard/deliverability/page.tsx");
  const brief = source("app/dashboard/page.tsx");

  assert.match(setup, /row_number\(\) over/);
  assert.match(setup, /properties ->> 'mailbox_email'/);
  assert.match(setup, /where account_rank = 1/);
  assert.match(deliverability, /row_number\(\) over/);
  assert.match(deliverability, /properties ->> 'mailbox_email'/);
  assert.match(deliverability, /where account_rank = 1/);
  assert.match(brief, /outlook_mailboxes/);
  assert.match(brief, /has_blocked_status and not has_connected/);
});

test("Agent learning surface presents message optimization from reply evidence", () => {
  const campaigns = source("app/dashboard/campaigns/page.tsx");
  const plays = source("app/dashboard/plays/page.tsx");
  const actions = source("app/dashboard/actions.ts");
  const readiness = source("core/product/launch-readiness.ts");

  assert.match(plays, /from "\.\.\/campaigns\/page"/);
  assert.match(actions, /optimizeProductPlaySkills/);
  assert.match(campaigns, /optimizePlaySkillsAction/);
  assert.match(campaigns, /kicker="Agent"/);
  assert.match(campaigns, /Learn from outreach/);
  assert.match(campaigns, /Message optimizer/);
  assert.match(campaigns, /Qualified signals ready for outreach/);
  assert.match(campaigns, /Outreach ideas in flight/);
  assert.match(campaigns, /play\.skill\.optimization\.recommended/);
  assert.match(campaigns, /Optimize skills/);
  assert.match(readiness, /label: "Agent"/);
  assert.match(readiness, /label: "Outreach sequence"/);
  assert.match(readiness, /"\/dashboard\/agent#sources"/);
  assert.match(readiness, /"\/dashboard\/agent#outreach"/);
  assert.doesNotMatch(readiness, /label: "Rep"/);
  assert.doesNotMatch(readiness, /label: "Plays"/);
  assert.doesNotMatch(readiness, /"\/dashboard\/campaigns"/);
  assert.doesNotMatch(campaigns, /kicker="Plays"/);
  assert.doesNotMatch(campaigns, /Play Skill optimizer/);
  assert.doesNotMatch(campaigns, /No Play/);
  assert.doesNotMatch(campaigns, /worth a Play/);
  assert.doesNotMatch(campaigns, /Play ideas/);
  assert.doesNotMatch(campaigns, /Play Rep/);
  assert.doesNotMatch(campaigns, /Apply at Play gate/);
});

test("Verified contacts open graph-backed profile pages with channel readiness", () => {
  const prospects = source("app/dashboard/prospects/page.tsx");
  const profile = source("app/dashboard/prospects/[id]/page.tsx");

  assert.match(prospects, /href=\{`\/dashboard\/prospects\/\$\{prospect\.id\}`\}/);
  assert.match(prospects, /Verified contacts/);
  assert.match(prospects, /Contacts ready for/);
  assert.match(prospects, /coalesce\(p\.emails, '\{\}'::text\[\]\) as emails/);
  assert.match(prospects, /cardinality\(coalesce\(p\.emails, '\{\}'::text\[\]\)\)/);
  assert.match(profile, /Verified contact/);
  assert.match(profile, /Timing evidence, channel handles, outreach, replies, and meetings/);
  assert.match(profile, /Back to contacts/);
  assert.match(profile, /No outreach yet/);
  assert.match(profile, /href: "\/dashboard\/agent#outreach"/);
  assert.match(profile, /Replies and meetings/);
  assert.match(profile, /coalesce\(p\.emails, '\{\}'::text\[\]\) as emails/);
  assert.match(profile, /coalesce\(p\.phones, '\{\}'::text\[\]\) as phones/);
  assert.match(profile, /from graph_persons p/);
  assert.match(profile, /left join graph_companies/);
  assert.match(profile, /from signals s/);
  assert.match(profile, /from conversations c/);
  assert.match(profile, /from outcomes o/);
  assert.match(profile, /from channel_accounts ca/);
  assert.match(profile, /Connect LinkedIn/);
  assert.match(profile, /Connect Outlook/);
  assert.doesNotMatch(profile, /Prospect profile/);
  assert.doesNotMatch(profile, /Open Plays/);
  assert.doesNotMatch(profile, /Reps act on/);
});

test("Reply insights keep outcome data under the simplified dashboard", () => {
  const outcomes = source("app/dashboard/outcomes/page.tsx");
  const loading = source("app/dashboard/outcomes/loading.tsx");
  const loader = source("components/dashboard/LoadingState.tsx");

  assert.match(outcomes, /kicker="Dashboard"/);
  assert.match(outcomes, /Reply and meeting/);
  assert.match(outcomes, /Reply insight ledger/);
  assert.match(outcomes, /Open outreach/);
  assert.match(outcomes, /from outcomes o/);
  assert.match(outcomes, /left join conversations c/);
  assert.match(outcomes, /left join reps r/);
  assert.match(outcomes, /left join signals s/);
  assert.match(outcomes, /href=\{`\/dashboard\/conversations\/\$\{outcome\.conversation_id\}`\}/);
  assert.match(loading, /surface="outcomes"/);
  assert.match(loader, /outcomes: \{ kicker: "Dashboard"/);
  assert.doesNotMatch(outcomes, /kicker="Outcomes"/);
  assert.doesNotMatch(outcomes, /Proof your Reps/);
  assert.doesNotMatch(outcomes, /Outcome ledger/);
  assert.doesNotMatch(outcomes, /No outcomes recorded/);
  assert.doesNotMatch(outcomes, /Open Conversations/);
});

test("Agent surface shows live work and account readiness", () => {
  const reps = source("app/dashboard/reps/page.tsx");

  assert.match(reps, /AgentActivityPanel/);
  assert.match(reps, /AgentContactsPanel/);
  assert.match(reps, /AgentOutreachPanel/);
  assert.match(reps, /AgentOpportunityPanel/);
  assert.match(reps, /AgentStrategyPanel/);
  assert.match(reps, /AgentSequencePanel/);
  assert.match(reps, /loadAgentSourceStrategy/);
  assert.match(reps, /loadQualifiedSignalWorkbench/);
  assert.match(reps, /loadAgentContactSummary/);
  assert.match(reps, /loadAgentOutreachSummary/);
  assert.match(reps, /visibleReps = state\.reps\.filter\(isVisibleProductAgent\)/);
  assert.match(reps, /return rep\.role === "sdr"/);
  assert.match(reps, /Verified contacts/);
  assert.match(reps, /Opportunities/);
  assert.match(reps, /Source strategy/);
  assert.match(reps, /Sequence/);
  assert.match(reps, /Keywords watched/);
  assert.match(reps, /Competitor audience/);
  assert.match(reps, /workspace_source_configs/);
  assert.match(reps, /graph_sources/);
  assert.match(reps, /coalesce\(compiled->>'channel', ''\)/);
  assert.match(reps, /id="sources" className="scroll-mt-28"/);
  assert.match(reps, /runAgentSourceNowAction/);
  assert.match(reps, /Run now/);
  assert.match(reps, /name="source_id" value=\{source\.id\}/);
  assert.match(reps, /Signal-to-outreach queue/);
  assert.match(reps, /The agent ranks qualified signals/);
  assert.match(reps, /Verified email/);
  assert.match(reps, /Draft ready/);
  assert.match(reps, /opportunityHref\(signal, contact\)/);
  assert.match(reps, /sentDraftHref\(\s*signal\.email_draft\.conversation_id/);
  assert.match(reps, /dismissQualifiedSignalAction/);
  assert.match(reps, /Skip opportunity/);
  assert.match(reps, /name="signal_id" value=\{signal\.id\}/);
  assert.match(reps, /Signal-ready contacts/);
  assert.match(reps, /verified emails and LinkedIn profiles/);
  assert.match(reps, /coalesce\(p\.emails, '\{\}'::text\[\]\) as emails/);
  assert.match(reps, /id="verified-contacts" className="scroll-mt-28"/);
  assert.match(reps, /id="outreach" className="scroll-mt-28"/);
  assert.match(reps, /href=\{`\/dashboard\/prospects\/\$\{contact\.id\}`\}/);
  assert.match(reps, /title="Sent outreach"/);
  assert.match(reps, /Agent outreach, last 7 days/);
  assert.match(reps, /DMs sent/);
  assert.match(reps, /Qualified signals become verified contacts/);
  assert.match(reps, /href="\/dashboard\/conversations"/);
  assert.match(reps, /href=\{sentDraftHref\(message\.conversation_id, message\.id\)\}/);
  assert.match(reps, /#message-\$\{messageId\}/);
  assert.match(reps, /events_last_hour/);
  assert.match(reps, /active_workflows/);
  assert.match(reps, /animate-pulse/);
  assert.match(reps, /workspaceChannelCoverage/);
  assert.match(reps, /firstChannelPolicy\(rep, \["linkedin_dm", "linkedin"\]\)/);
  assert.match(reps, /href="\/dashboard\/settings#motion"/);
  assert.match(reps, /Connect Outlook/);
  assert.match(reps, /Connect LinkedIn/);
  assert.match(reps, /Open agent/);
  assert.match(reps, /Profile, accounts, and limits stay in\s+Profile/);
  assert.match(reps, /Replies 7d/);
  assert.doesNotMatch(reps, /Outreach accounts/);
  assert.doesNotMatch(reps, /Launch path/);
  assert.doesNotMatch(reps, /ChannelCard/);
  assert.doesNotMatch(reps, /<RepCard key=\{rep\.id\} rep=\{rep\} \/>/);
  assert.doesNotMatch(reps, /Outcomes 7d/);
});

test("dashboard app surfaces do not leak legacy named agents", () => {
  const surfaces = [
    source("app/dashboard/reps/page.tsx"),
    source("app/dashboard/reps/[id]/page.tsx"),
    source("app/dashboard/setup/page.tsx"),
    source("app/dashboard/settings/page.tsx"),
    source("app/dashboard/campaigns/page.tsx"),
  ].join("\n");

  assert.match(surfaces, /Outbound agent/);
  assert.doesNotMatch(surfaces, /Sampark/);
  assert.doesNotMatch(surfaces, /Prayog/);
});

test("sent outreach links open the exact draft in the conversation trace", () => {
  const outreach = source("app/dashboard/conversations/page.tsx");
  const detail = source("app/dashboard/conversations/[id]/page.tsx");

  assert.match(outreach, /kicker="Agent"/);
  assert.match(outreach, /Sent email and LinkedIn <em>outreach<\/em>/);
  assert.match(outreach, /<SurfaceSection title="Sent outreach">/);
  assert.match(outreach, /href=\{sentDraftHref\(message\.conversation_id, message\.id\)\}/);
  assert.match(outreach, /#message-\$\{messageId\}/);
  assert.doesNotMatch(outreach, /kicker="Outreach"/);
  assert.doesNotMatch(outreach, /kicker="Inbox"/);
  assert.doesNotMatch(outreach, /Sent list/);
  assert.match(detail, /brief-kicker">Agent/);
  assert.match(detail, /id=\{`message-\$\{m\.id\}`\}/);
  assert.match(detail, /target:ring-\[var\(--color-accent\)\]/);
  assert.match(detail, /Back to sent outreach/);
  assert.doesNotMatch(detail, /brief-kicker">Inbox/);
  assert.doesNotMatch(detail, /Back to Inbox/);
});

test("loading states use simplified product surface labels", () => {
  const loader = source("components/dashboard/LoadingState.tsx");

  assert.match(loader, /reps: \{ kicker: "Agent"/);
  assert.match(loader, /plays: \{ kicker: "Agent"/);
  assert.match(loader, /outcomes: \{ kicker: "Dashboard"/);
  assert.match(loader, /prospecting: \{ kicker: "Profile"/);
  assert.match(loader, /title: "Loading profile"/);
  assert.doesNotMatch(loader, /kicker: "Reps"/);
  assert.doesNotMatch(loader, /kicker: "Plays"/);
  assert.doesNotMatch(loader, /kicker: "Outcomes"/);
  assert.doesNotMatch(loader, /Loading prospecting profile/);
});

test("dashboard Signal surfaces do not expose manual ingestion controls", () => {
  const campaigns = source("app/dashboard/campaigns/page.tsx");
  const signals = source("app/dashboard/ingestion/page.tsx");
  const actions = source("app/dashboard/actions.ts");
  const reps = source("app/dashboard/reps/page.tsx");
  const productApp = source("core/product/app.ts");
  const onboardingActions = source("app/onboarding/actions.ts");
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
  assert.match(reps, /checkAgentSourcesAction/);
  assert.match(reps, /Check sources/);
  assert.match(reps, /Run source now/);
  assert.match(reps, /name="limit" value="25"/);
  assert.match(productApp, /runWorkspaceSourcePollNow/);
  assert.match(productApp, /workflow_name: WORKSPACE_POLL_WORKFLOW/);
  assert.match(productApp, /workspace-source-manual/);
  assert.match(signals, /kicker="Agent"/);
  assert.match(signals, /Quality signals ready for <em>outreach<\/em>/);
  assert.match(signals, /verified emails or LinkedIn profiles/);
  assert.match(signals, /LinkedIn profiles/);
  assert.match(signals, /HeroStat label="Outlook"/);
  assert.match(signals, /Prepare outreach/);
  assert.match(signals, /<SurfaceSection title="Quality signals">/);
  assert.match(signals, /LinkedIn profile/);
  assert.match(signals, /Judged outreach draft/);
  assert.match(signals, /email or LinkedIn draft/);
  assert.match(signals, /Open sent outreach/);
  assert.match(signals, /Create a profile first/);
  assert.match(signals, /Tune the profile/);
  assert.doesNotMatch(signals, /prospecting profile/);
  assert.doesNotMatch(signals, /kicker="Qualified signals"/);
  assert.doesNotMatch(signals, /Signals worth <em>emailing now<\/em>/);
  assert.doesNotMatch(signals, /HeroStat label="Inbox"/);
  assert.doesNotMatch(signals, /Prepare contacts \+ drafts/);
  assert.doesNotMatch(signals, /signal-to-email outreach run/);
  assert.match(signals, /\/api\/auth\/outlook\?return_to=\/dashboard\/signals/);
  assert.doesNotMatch(signals, /"\/api\/auth\/outlook"/);
  assert.match(onboardingActions, /runWorkspaceSignalIngestion/);
  assert.match(onboardingActions, /wait: false/);
  assert.match(capabilityMap, /Autonomous signal ingestion/);
  assert.doesNotMatch(
    capabilityMap,
    /`\/dashboard\/campaigns`, `\/dashboard\/signals`/,
  );
  assert.match(capabilityMap, /autonomous workspace workers/);
  assert.match(capabilityMap, /`product\.signal\.ingestion\.run`/);
});

test("Settings exposes profile, activation, Outlook, and workspace autonomy controls", () => {
  const settings = source("app/dashboard/settings/page.tsx");
  const actions = source("app/dashboard/actions.ts");
  const productApp = source("core/product/app.ts");
  const registry = source("core/substrate/events/registry.ts");

  assert.match(settings, /editCompanyProfileAction/);
  assert.match(settings, /configureActivationAction/);
  assert.match(settings, /updateWorkspaceAutonomyAction/);
  assert.match(settings, /href="\/api\/auth\/outlook\?/);
  assert.match(settings, /SettingsSectionNav/);
  assert.match(settings, /aria-label="Settings sections"/);
  assert.match(settings, /id="email"/);
  assert.match(settings, /id="linkedin"/);
  assert.match(settings, /href: "#email"/);
  assert.match(settings, /href: "#linkedin"/);
  assert.match(settings, /href: "#templates"/);
  assert.match(settings, /href: "#contact-quality"/);
  assert.match(settings, /href: "#blocklist"/);
  assert.match(settings, /Profile and <em>integrations<\/em>/);
  assert.match(settings, /integrationCount\(state\)/);
  assert.match(settings, /Email integration/);
  assert.match(settings, /LinkedIn integration/);
  assert.match(settings, /linkedInAccounts: linkedIn\.rows/);
  assert.match(settings, /Connect up to two LinkedIn accounts/);
  assert.match(settings, /First account/);
  assert.match(settings, /Second account/);
  assert.match(settings, /Settings and limits/);
  assert.match(settings, /Tool integrations/);
  assert.match(settings, /Contact quality/);
  assert.match(settings, /Email and LinkedIn readiness/);
  assert.match(settings, /Value proposition/);
  assert.match(settings, /Customer pain points/);
  assert.match(settings, /Buyer roles/);
  assert.match(settings, /Target markets/);
  assert.match(settings, /Key features/);
  assert.match(settings, /Social proof/);
  assert.match(settings, /Signal keywords/);
  assert.match(settings, /Competitors to watch/);
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
  assert.match(settings, /Open contact graph/);
  assert.match(settings, /Blocklist/);
  assert.match(
    settings,
    /Bounces, unsubscribes, and do-not-contact events protect future\s+outreach automatically/,
  );
  assert.match(
    settings,
    /kind in \('bounce','unsubscribe','do_not_contact'\)/,
  );
  assert.match(settings, /Open sent outreach/);
  assert.doesNotMatch(settings, /Open prospect graph/);
  assert.doesNotMatch(settings, /Open outcome ledger/);
  assert.doesNotMatch(settings, /do-not-contact outcomes/);
  assert.match(
    settings,
    /href="\/api\/auth\/outlook\?return_to=%2Fdashboard%2Fsettings%23email"/,
  );
  assert.match(
    settings,
    /href="\/api\/auth\/linkedin\?return_to=%2Fdashboard%2Fsettings%23linkedin"/,
  );
  assert.match(settings, /href: "#tools"/);
  assert.match(settings, /id="tools"/);
  assert.match(settings, /href="\/api\/mcp"/);
  assert.match(settings, /Agent inputs and outreach templates/);
  assert.match(settings, /AI outreach template/);
  assert.match(settings, /name="rep_story"/);
  assert.match(settings, /verified contact or LinkedIn profile/);
  assert.match(settings, /return_to" value="\/dashboard\/settings#motion"/);
  assert.match(settings, /value="autonomous"/);
  assert.match(settings, /value="review_only"/);
  assert.match(settings, /row_number\(\) over/);
  assert.match(settings, /properties ->> 'mailbox_email'/);
  assert.match(actions, /dashboardReturnPath\(formData, "\/dashboard\/settings#motion"\)/);
  assert.match(actions, /value_proposition/);
  assert.match(actions, /customer_pain_points/);
  assert.match(actions, /target_titles/);
  assert.match(actions, /target_markets/);
  assert.match(actions, /signal_keywords/);
  assert.match(actions, /competitor_watchlist/);
  assert.match(actions, /exclusion_rules/);
  assert.match(actions, /prevent_team_contact_duplication/);
  assert.match(actions, /configureWorkspaceAutonomyMode/);
  assert.match(actions, /dismissProductSignal/);
  assert.match(productApp, /event_type: "workspace\.configured"/);
  assert.match(productApp, /event_type: "rep\.configured"/);
  assert.match(productApp, /event_type: "play\.configured"/);
  assert.match(productApp, /event_type: "signal\.dismissal\.requested"/);
  assert.match(productApp, /projectSignalDismissal/);
  assert.match(registry, /"signal\.dismissal\.requested": SignalDismissalRequested/);
  assert.match(registry, /"workspace\.configured": WorkspaceConfigured/);
});

test("Integrations route folds into Profile", () => {
  const integrations = source("app/dashboard/integrations/page.tsx");
  const outlook = source("app/api/auth/outlook/route.ts");
  const linkedIn = source("app/api/auth/linkedin/route.ts");

  assert.match(integrations, /redirect\("\/dashboard\/settings#email"\)/);
  assert.doesNotMatch(integrations, /Connect Outlook/);
  assert.doesNotMatch(integrations, /Connect LinkedIn/);
  assert.doesNotMatch(integrations, /href="\/api\/mcp"/);
  assert.match(outlook, /authCallbackOrigin/);
  assert.match(linkedIn, /authCallbackOrigin/);
  assert.match(linkedIn, /safeReturnTo/);
  assert.match(linkedIn, /return_to: returnTo/);
});

test("LinkedIn OAuth returns to current product hubs instead of legacy prospecting", () => {
  const linkedInRoute = source("app/api/auth/linkedin/route.ts");
  const linkedInCallback = source("app/api/auth/linkedin/callback/route.ts");
  const linkedInState = source("app/api/auth/linkedin/state.ts");
  const setup = source("app/dashboard/setup/page.tsx");

  assert.match(linkedInState, /return_to\?: string/);
  assert.match(linkedInRoute, /safeReturnTo\(req\.nextUrl\.searchParams\.get\("return_to"\)\)/);
  assert.match(linkedInCallback, /state\.return_to \?\? "\/dashboard\/settings#linkedin"/);
  assert.match(linkedInCallback, /dest\.searchParams\.set\("status", "linkedin_connecting"\)/);
  assert.match(setup, /href="\/api\/auth\/linkedin\?return_to=%2Fdashboard%2Fsettings%23linkedin"/);
  assert.doesNotMatch(linkedInCallback, /\/dashboard\/prospecting/);
});

test("account connection entry points carry explicit product return targets", () => {
  const surfaces = [
    source("app/dashboard/settings/page.tsx"),
    source("app/dashboard/integrations/page.tsx"),
    source("app/dashboard/setup/page.tsx"),
    source("app/dashboard/deliverability/page.tsx"),
    source("app/dashboard/reps/page.tsx"),
    source("app/dashboard/conversations/page.tsx"),
    source("app/dashboard/prospects/[id]/page.tsx"),
  ].join("\n");

  assert.doesNotMatch(surfaces, /href="\/api\/auth\/outlook"/);
  assert.doesNotMatch(surfaces, /href="\/api\/auth\/linkedin"/);
  assert.match(surfaces, /\/api\/auth\/outlook\?return_to=/);
  assert.match(surfaces, /\/api\/auth\/linkedin\?return_to=/);
  assert.doesNotMatch(surfaces, /\/dashboard\/integrations/);
  assert.doesNotMatch(surfaces, /\/api\/auth\/outlook\?return_to=\/dashboard\/deliverability/);
});

test("new product defaults are autonomous after checks", () => {
  const actions = source("app/dashboard/actions.ts");
  const setup = source("app/dashboard/setup/page.tsx");
  const repDetail = source("app/dashboard/reps/[id]/page.tsx");
  const productApp = source("core/product/app.ts");
  const playAutonomy = source("core/plays/autonomy.ts");
  const repPrimitive = source("core/primitives/rep.ts");
  const activationGraph = source("core/agents/langgraph/graphs/activation.ts");
  const productTools = source("core/product/tools.ts");
  const migration = source("db/migrations/038_autonomous_default_backfill.sql");

  assert.match(actions, /fallback: DashboardApprovalPolicy = "none"/);
  assert.match(
    setup,
    /defaultValue=\{rep\?\.autonomy\.channels\?\.email\?\.approval \?\? "none"\}/,
  );
  assert.match(
    repDetail,
    /defaultValue=\{rep\.autonomy\.channels\?\.email\?\.approval \?\? "none"\}/,
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

  assert.match(onboardingPage, /Create your first outreach agent/);
  assert.match(onboardingPage, /Step 1 of 4/);
  assert.match(onboardingPage, /positioning, proof, and goals/);
  assert.match(onboardingPage, /qualified signals, verified contacts/);
  assert.match(onboardingPage, /Email and LinkedIn/);
  assert.match(onboardingPage, /The agent finds timing signals/);
  assert.match(onboardingForm, /Description and value proposition/);
  assert.match(onboardingForm, /Customer pain points/);
  assert.match(onboardingForm, /Buyer roles/);
  assert.match(onboardingForm, /Target markets/);
  assert.match(onboardingForm, /Key features/);
  assert.match(onboardingForm, /Social proof/);
  assert.match(onboardingForm, /Signal keywords/);
  assert.match(onboardingForm, /Competitors to watch/);
  assert.match(onboardingForm, /Do not contact/);
  assert.match(onboardingForm, /name="outreach_goal"/);
  assert.match(onboardingForm, /name="message_tone"/);
  assert.match(onboardingForm, /preferred_language/);
  assert.match(onboardingForm, /Create outreach agent/);
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
  assert.match(onboardingActions, /exclusion_rules/);
  assert.match(onboardingActions, /preferred_language/);
  assert.match(onboardingActions, /runWorkspaceSignalIngestion/);
  assert.match(onboardingActions, /wait: false/);
  assert.doesNotMatch(onboardingActions, /runWorkspaceSignalAggregatorOnce/);
  assert.match(activationGraph, /description_hint/);
  assert.match(activationGraph, /customer_pain_points/);
  assert.match(activationGraph, /Buyer role:/);
  assert.match(activationGraph, /Target market:/);
  assert.match(activationGraph, /Signal keyword:/);
  assert.match(activationGraph, /Competitor watch:/);
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
  assert.doesNotMatch(onboardingForm, /createProfileAndAggregatorFormAction/);
  assert.match(productTools, /name: "product\.activation\.setup\.run"/);
  assert.match(productTools, /industry_hint/);
  assert.match(productTools, /description_hint/);
  assert.match(productTools, /target_titles/);
  assert.match(productTools, /target_markets/);
  assert.match(productTools, /signal_keywords/);
  assert.match(productTools, /competitor_watchlist/);
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

test("visual system uses the clean light operating surface", () => {
  const globals = source("app/globals.css");
  const layout = source("app/layout.tsx");
  const home = source("app/page.tsx");
  const design = source("DESIGN.md");

  assert.match(globals, /--color-ink-1: #fafbfc/);
  assert.match(globals, /--color-accent: #26575E/);
  assert.match(globals, /:root \{ color-scheme: light; \}/);
  assert.match(layout, /colorScheme: "light"/);
  assert.match(home, /Autonomous Outbound/);
  assert.match(home, /Quality signals, verified contacts/);
  assert.match(home, /email or LinkedIn outreach/);
  assert.match(home, /Your buyer profile builds itself/);
  assert.doesNotMatch(home, /Signal-led prospecting/);
  assert.doesNotMatch(home, /Multi-channel plays/);
  assert.doesNotMatch(home, /run the plays/);
  assert.doesNotMatch(home, /function SolarSystem/);
  assert.match(design, /The Signal Operating Surface/);
});

test("dashboard icon names resolve to first-party SVG symbols", () => {
  const iconSource = source("components/Icon.tsx");
  const surfaces = [
    source("components/dashboard/Shell.tsx"),
    source("app/onboarding/OnboardingForm.tsx"),
    source("app/dashboard/page.tsx"),
    source("app/dashboard/reps/page.tsx"),
    source("app/dashboard/settings/page.tsx"),
    source("app/dashboard/ingestion/page.tsx"),
    source("app/dashboard/deliverability/page.tsx"),
    source("app/dashboard/campaigns/page.tsx"),
    source("app/dashboard/prospects/page.tsx"),
    source("app/dashboard/prospects/[id]/page.tsx"),
  ].join("\n");
  const defined = new Set(
    Array.from(iconSource.matchAll(/^  ([a-z0-9_]+):/gm), (match) => match[1]),
  );
  const used = new Set(
    Array.from(
      surfaces.matchAll(/(?:Icon name|icon)="([a-z0-9_]+)"/g),
      (match) => match[1],
    ),
  );
  const missing = Array.from(used)
    .filter((name) => !defined.has(name))
    .sort();

  assert.deepEqual(missing, []);
  assert.match(iconSource, /person_search:/);
  assert.match(iconSource, /radar:/);
  assert.match(iconSource, /verified:/);
  assert.match(iconSource, /play_arrow:/);
});

test("Bombsell logo asset stays canonical and untinted", () => {
  const home = source("app/page.tsx");
  const shell = source("components/dashboard/Shell.tsx");
  const logo = source("public/logo.svg");

  assert.match(home, /src="\/logo\.svg"/);
  assert.match(shell, /src="\/logo\.svg"/);
  assert.doesNotMatch(
    home,
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

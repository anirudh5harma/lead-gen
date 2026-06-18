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

  assert.match(primaryNav, /href: "\/dashboard\/brief",\s+label: "Brief"/);
  assert.match(primaryNav, /matches: \["\/dashboard\/brief", "\/dashboard"\]/);
  assert.match(primaryNav, /href: "\/dashboard\/agent",\s+label: "Agent"/);
  assert.match(primaryNav, /"\/dashboard\/reps"/);
  assert.match(primaryNav, /href: "\/dashboard\/profile",\s+label: "Profile"/);
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
  assert.match(shell, /hrefPath\(href\) === pathname/);
  assert.match(shell, /candidate !== "\/dashboard"/);
  assert.doesNotMatch(shell, /ProductFlowRail/);
  assert.doesNotMatch(shell, /aria-label="Product flow"/);
  assert.doesNotMatch(shell, /const FLOW/);
  assert.doesNotMatch(shell, /isActiveFlowItem/);
  assert.doesNotMatch(shell, /window\.location\.hash/);
  assert.doesNotMatch(shell, /hashchange/);
});

test("dashboard shell keeps route chrome simple and avoids extra flow queries", () => {
  const shell = source("components/dashboard/Shell.tsx");
  const layout = source("app/dashboard/layout.tsx");

  assert.match(shell, /DashboardShell/);
  assert.match(shell, /const NAV/);
  assert.match(shell, /label: "Brief"/);
  assert.match(shell, /label: "Agent"/);
  assert.match(shell, /label: "Profile"/);
  assert.match(layout, /<DashboardShell/);
  assert.match(layout, /getActiveWorkspaceSession/);
  assert.match(layout, /listWorkspaces/);

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

test("Agent is the canonical dashboard surface route", () => {
  const agentPage = source("app/dashboard/agent/page.tsx");
  const agentDetailPage = source("app/dashboard/agent/[id]/page.tsx");

  assert.match(agentPage, /export const dynamic = "force-dynamic"/);
  assert.match(agentPage, /from "\.\.\/reps\/page"/);
  assert.match(agentDetailPage, /export const dynamic = "force-dynamic"/);
  assert.match(agentDetailPage, /from "\.\.\/\.\.\/reps\/\[id\]\/page"/);
  assert.equal(exists("app/dashboard/loading.tsx"), false);
  assert.equal(exists("app/dashboard/agent/loading.tsx"), false);
  assert.equal(exists("app/dashboard/profile/page.tsx"), true);
  assert.equal(exists("app/dashboard/settings/loading.tsx"), false);
  assert.match(
    source("app/dashboard/profile/page.tsx"),
    /from "\.\.\/settings\/page"/,
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

test("legacy list and Profile routes redirect to current product hubs", () => {
  const nextConfig = source("next.config.ts");

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
    /redirect\("\/dashboard\/agent#opportunities"\)/,
  );
  assert.match(
    source("app/dashboard/ingestion/page.tsx"),
    /redirect\("\/dashboard\/agent#opportunities"\)/,
  );
  assert.match(
    source("app/dashboard/prospects/page.tsx"),
    /redirect\("\/dashboard\/agent#verified-contacts"\)/,
  );
  assert.match(
    source("app/dashboard/conversations/page.tsx"),
    /redirect\("\/dashboard\/agent#outreach"\)/,
  );
  assert.match(
    source("app/dashboard/outcomes/page.tsx"),
    /redirect\("\/dashboard\/brief"\)/,
  );
  assert.match(
    source("app/dashboard/prospecting/loading.tsx"),
    /surface="settings"/,
  );
  assert.match(source("app/dashboard/setup/loading.tsx"), /surface="settings"/);
  assert.match(
    source("app/dashboard/deliverability/loading.tsx"),
    /surface="settings"/,
  );
  assert.match(
    source("app/dashboard/signals/loading.tsx"),
    /surface="reps"/,
  );
  assert.match(source("app/dashboard/ingestion/loading.tsx"), /surface="reps"/);
  assert.match(source("app/dashboard/prospects/loading.tsx"), /surface="reps"/);
  assert.match(source("app/dashboard/conversations/loading.tsx"), /surface="reps"/);
  assert.match(source("app/dashboard/outcomes/loading.tsx"), /surface="dashboard"/);
  assert.match(nextConfig, /source: "\/dashboard\/prospecting"/);
  assert.match(nextConfig, /source: "\/dashboard\/setup"/);
  assert.match(nextConfig, /source: "\/dashboard\/deliverability"/);
  assert.match(nextConfig, /source: "\/dashboard\/signals"/);
  assert.match(nextConfig, /source: "\/dashboard\/ingestion"/);
  assert.match(nextConfig, /source: "\/dashboard\/prospects"/);
  assert.match(nextConfig, /source: "\/dashboard\/conversations"/);
  assert.match(nextConfig, /source: "\/dashboard\/outcomes"/);
  assert.match(nextConfig, /destination: "\/dashboard\/brief"/);
  assert.match(nextConfig, /destination: "\/dashboard\/profile#profile"/);
  assert.match(nextConfig, /destination: "\/dashboard\/profile#channels"/);
  assert.match(nextConfig, /destination: "\/dashboard\/agent#opportunities"/);
  assert.match(nextConfig, /destination: "\/dashboard\/agent#verified-contacts"/);
  assert.match(nextConfig, /destination: "\/dashboard\/agent#outreach"/);

  const actions = source("app/dashboard/actions.ts");
  assert.match(actions, /revalidatePath\("\/dashboard\/profile"\)/);
  assert.match(actions, /revalidatePath\("\/dashboard\/settings"\)/);
  assert.match(actions, /revalidatePath\("\/dashboard\/agent"\)/);
  assert.doesNotMatch(actions, /revalidatePath\("\/dashboard\/prospecting"\)/);
  assert.doesNotMatch(actions, /revalidatePath\("\/dashboard\/setup"\)/);
  assert.doesNotMatch(actions, /revalidatePath\("\/dashboard\/signals"\)/);
  assert.doesNotMatch(actions, /revalidatePath\("\/dashboard\/ingestion"\)/);
  assert.doesNotMatch(actions, /revalidatePath\("\/dashboard\/conversations"\)/);
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
  assert.match(dashboard, /href="\/dashboard\/agent#opportunities"/);
  assert.match(dashboard, /href="\/dashboard\/agent#outreach"/);
  assert.match(dashboard, /href="\/dashboard\/brief#reply-insights"/);
  assert.match(dashboard, /id="reply-insights" className="scroll-mt-28"/);
  assert.match(dashboard, /group-hover:text-\[var\(--color-accent\)\]/);
  assert.match(dashboard, /Today priority/);
  assert.match(dashboard, /Signal-to-outreach funnel/);
  assert.match(dashboard, /Fresh qualified contacts/);
  assert.match(dashboard, /Signal mix/);
  assert.match(dashboard, /Agent insight/);
  assert.match(dashboard, /Reply and meeting insights/);
  assert.match(dashboard, /loadBriefHotContacts/);
  assert.match(dashboard, /loadBriefOutcomeInsights/);
  assert.match(dashboard, /from graph_persons p/);
  assert.match(dashboard, /join lateral \(/);
  assert.match(dashboard, /latest_signal\.title as latest_signal_title/);
  assert.match(dashboard, /contact_fit_decision/);
  assert.match(dashboard, /from outcomes o/);
  assert.match(dashboard, /left join conversations c/);
  assert.match(dashboard, /left join signals s/);
  assert.match(dashboard, /BriefHotContactRow/);
  assert.match(dashboard, /OutcomeInsightRow/);
  assert.match(dashboard, /href=\{`\/dashboard\/prospects\/\$\{contact\.id\}`\}/);
  assert.match(dashboard, /Verified email/);
  assert.match(dashboard, /LinkedIn profile/);
  assert.match(dashboard, /contactFitLabel\(contact\.contact_fit_decision\)/);
  assert.match(dashboard, /No signal-backed contacts yet/);
  assert.match(dashboard, /href: "\/dashboard\/profile#profile"/);
  assert.match(dashboard, /href="\/dashboard\/agent#outreach"/);
  assert.match(dashboard, /href="\/dashboard\/agent#opportunities"/);
  assert.match(dashboard, /\/dashboard\/conversations\/\$\{insight\.conversation_id\}/);
  assert.match(source("app/dashboard/brief/page.tsx"), /dynamic = "force-dynamic"/);
  assert.match(source("app/dashboard/brief/page.tsx"), /from "\.\.\/page"/);
  assert.match(source("app/brief/page.tsx"), /redirect\("\/dashboard\/brief"\)/);
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

test("Settings presents separate Outlook and LinkedIn connection gates", () => {
  const settings = source("app/dashboard/settings/page.tsx");

  assert.match(settings, /href="\/api\/auth\/outlook\?return_to=%2Fdashboard%2Fprofile%23email"/);
  assert.match(settings, /href="\/api\/auth\/linkedin\?return_to=%2Fdashboard%2Fprofile%23linkedin"/);
  assert.match(
    settings,
    /kind in \('linkedin_session','linkedin_oauth'\)/,
  );
  assert.match(settings, /Profile, channels, and guardrails/);
  assert.match(settings, /Email integration/);
  assert.match(settings, /LinkedIn integration/);
  assert.match(settings, /verified contact or LinkedIn profile/);
  assert.doesNotMatch(settings, /Learning: \{/);
  assert.doesNotMatch(settings, /href: "\/dashboard\/plays"/);
  assert.doesNotMatch(settings, /prospecting profile/);
});

test("Outlook connection surfaces collapse duplicate rows by mailbox identity", () => {
  const settings = source("app/dashboard/settings/page.tsx");
  const brief = source("app/dashboard/page.tsx");

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
  const reps = source("app/dashboard/reps/page.tsx");
  const actions = source("app/dashboard/actions.ts");
  const readiness = source("core/product/launch-readiness.ts");

  assert.match(nextConfig, /source: "\/dashboard\/campaigns"/);
  assert.match(nextConfig, /source: "\/dashboard\/plays"/);
  assert.match(nextConfig, /destination: "\/dashboard\/agent#learning"/);
  assert.match(campaigns, /redirect\("\/dashboard\/agent#learning"\)/);
  assert.match(plays, /redirect\("\/dashboard\/agent#learning"\)/);
  assert.match(campaignsLoading, /surface="reps"/);
  assert.match(playsLoading, /surface="reps"/);
  assert.match(actions, /optimizeProductPlaySkills/);
  assert.match(actions, /dashboardReturnPath\(formData, "\/dashboard\/agent#learning"\)/);
  assert.match(reps, /optimizePlaySkillsAction/);
  assert.match(reps, /optimizeCampaignStrategyAction/);
  assert.match(reps, /title="Learning"/);
  assert.match(reps, /Message recommendation/);
  assert.match(reps, /play\.skill\.optimization\.recommended/);
  assert.match(reps, /Optimize messages/);
  assert.match(readiness, /label: "Agent"/);
  assert.match(readiness, /label: "Outreach sequence"/);
  assert.match(readiness, /"\/dashboard\/agent#sources"/);
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
  const profile = source("app/dashboard/prospects/[id]/page.tsx");
  const reps = source("app/dashboard/reps/page.tsx");

  assert.match(prospects, /redirect\("\/dashboard\/agent#verified-contacts"\)/);
  assert.match(reps, /href=\{`\/dashboard\/prospects\/\$\{contact\.id\}`\}/);
  assert.match(reps, /Verified contacts/);
  assert.match(reps, /Contact workbench/);
  assert.match(reps, /Signal-ready contacts show why now/);
  assert.match(reps, /coalesce\(p\.emails, '\{\}'::text\[\]\) as emails/);
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
  const dashboard = source("app/dashboard/page.tsx");
  const reps = source("app/dashboard/reps/page.tsx");

  assert.match(outcomes, /redirect\("\/dashboard\/brief"\)/);
  assert.match(dashboard, /Replies \/ meetings/);
  assert.match(dashboard, /from outcomes o/);
  assert.match(dashboard, /Reply and meeting insights/);
  assert.match(dashboard, /reply_intent/);
  assert.match(reps, /Reply evidence/);
  assert.match(reps, /positive_replies_7d/);
  assert.match(loading, /surface="dashboard"/);
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
  assert.match(reps, /AgentLearningPanel/);
  assert.match(reps, /AgentOutreachPanel/);
  assert.match(reps, /AgentOpportunityPanel/);
  assert.match(reps, /AgentReadinessPanel/);
  assert.match(reps, /AgentStrategyPanel/);
  assert.match(reps, /AgentSequencePanel/);
  assert.match(reps, /loadAgentSourceStrategy/);
  assert.match(reps, /loadQualifiedSignalWorkbench/);
  assert.match(reps, /loadAgentContactSummary/);
  assert.match(reps, /loadAgentLearningSummary/);
  assert.match(reps, /loadAgentOutreachSummary/);
  assert.match(reps, /visibleReps = state\.reps\.filter\(isVisibleProductAgent\)/);
  assert.match(reps, /return rep\.role === "sdr"/);
  assert.match(reps, /Verified contacts/);
  assert.match(reps, /Qualified signals/);
  assert.match(reps, /Source strategy/);
  assert.match(reps, /Readiness gate/);
  assert.match(reps, /Outreach is gated/);
  assert.match(reps, /Qualified Signals can become email or LinkedIn outreach/);
  assert.match(reps, /readiness\.checks\.map/);
  assert.match(reps, /readinessNextAction/);
  assert.match(reps, /readinessFallbackHref/);
  assert.match(reps, /Sequence/);
  assert.match(reps, /Keywords watched/);
  assert.match(reps, /Competitor audience/);
  assert.match(reps, /workspace_source_configs/);
  assert.match(reps, /graph_sources/);
  assert.match(reps, /coalesce\(compiled->>'channel', ''\)/);
  assert.match(reps, /id="sources" className="scroll-mt-28"/);
  assert.match(reps, /id="opportunities" className="scroll-mt-28"/);
  assert.match(reps, /runAgentSourceNowAction/);
  assert.match(reps, /Run now/);
  assert.match(reps, /name="source_id" value=\{source\.id\}/);
  assert.match(reps, /Signal-to-outreach queue/);
  assert.match(reps, /The agent ranks qualified signals/);
  assert.match(reps, /prepareQualifiedSignalsAction/);
  assert.match(reps, /Prepare outreach/);
  assert.match(reps, /Verified email/);
  assert.match(reps, /with_outreach_draft/);
  assert.match(reps, /blocked_by_fit/);
  assert.match(reps, /Fit blocked/);
  assert.match(reps, /const draft = signal\.outreach_draft/);
  assert.match(reps, /contactFitGate\(contact\)/);
  assert.match(reps, /Outreach gated/);
  assert.match(reps, /Blocked by fit/);
  assert.match(reps, /draftOpportunityLabel\(draft\.status, draft\.channel\)/);
  assert.match(reps, /opportunityHref\(signal, contact\)/);
  assert.match(reps, /return "\/dashboard\/agent#opportunities"/);
  assert.match(reps, /sentDraftHref\(\s*signal\.outreach_draft\.conversation_id/);
  assert.match(reps, /dismissQualifiedSignalAction/);
  assert.match(reps, /Skip opportunity/);
  assert.match(reps, /name="signal_id" value=\{signal\.id\}/);
  assert.match(reps, /Contact workbench/);
  assert.match(reps, /Signal-ready contacts show why now/);
  assert.match(reps, /latest_signal_title/);
  assert.match(reps, /contact_fit_decision/);
  assert.match(reps, /left join lateral/);
  assert.match(reps, /Why now:/);
  assert.match(reps, /contactFitLabel\(contact\.contact_fit_decision\)/);
  assert.match(reps, /verified emails, LinkedIn\s+profiles/);
  assert.match(reps, /coalesce\(p\.emails, '\{\}'::text\[\]\) as emails/);
  assert.match(reps, /id="verified-contacts" className="scroll-mt-28"/);
  assert.match(reps, /id="outreach" className="scroll-mt-28"/);
  assert.match(reps, /href=\{`\/dashboard\/prospects\/\$\{contact\.id\}`\}/);
  assert.match(reps, /title="Sent outreach"/);
  assert.match(reps, /Agent outreach, last 7 days/);
  assert.match(reps, /DMs sent/);
  assert.match(reps, /Qualified signals become verified contacts/);
  assert.match(reps, /title="No sent outreach yet"/);
  assert.match(reps, /href: "\/dashboard\/profile#channels",\s+label: "Connect accounts"/);
  assert.doesNotMatch(reps, /href="\/dashboard\/conversations"/);
  assert.match(reps, /href=\{sentDraftHref\(message\.conversation_id, message\.id\)\}/);
  assert.match(reps, /#message-\$\{messageId\}/);
  assert.match(reps, /decideApprovalWithDraftAction/);
  assert.match(reps, /value="\/dashboard\/agent#opportunities"/);
  assert.match(reps, /value=\{draft\.pending_approval_id\}/);
  assert.doesNotMatch(reps, /signal\.email_draft/);
  assert.match(reps, /id="learning" className="scroll-mt-28"/);
  assert.match(reps, /Reply evidence/);
  assert.match(reps, /Strategy recommendation/);
  assert.match(reps, /Message recommendation/);
  assert.match(reps, /optimizeCampaignStrategyAction/);
  assert.match(reps, /optimizePlaySkillsAction/);
  assert.match(reps, /value="\/dashboard\/agent#learning"/);
  assert.match(reps, /campaign\.strategy\.recommended/);
  assert.match(reps, /play\.skill\.optimization\.recommended/);
  assert.match(reps, /events_last_hour/);
  assert.match(reps, /active_workflows/);
  assert.match(reps, /signals_last_hour/);
  assert.match(reps, /contacts_last_hour/);
  assert.match(reps, /drafts_last_hour/);
  assert.match(reps, /replies_last_hour/);
  assert.match(reps, /agentEventLabel/);
  assert.match(reps, /Signal checked/);
  assert.match(reps, /Contact resolved/);
  assert.match(reps, /Draft prepared/);
  assert.match(reps, /Outreach updated/);
  assert.match(reps, /Reply insight captured/);
  assert.match(reps, /title=\{event\.event_type\}/);
  assert.match(reps, /AgentWorkStage/);
  assert.match(reps, /agentLastHourStages/);
  assert.match(reps, /Signals checked/);
  assert.match(reps, /Contacts resolved/);
  assert.match(reps, /Drafts prepared/);
  assert.match(reps, /Outreach sent/);
  assert.match(reps, /Replies \/ meetings/);
  assert.match(reps, /animate-pulse/);
  assert.match(reps, /AgentOperatingLoopPanel/);
  assert.match(reps, /Signal-to-outreach operating loop/);
  assert.match(reps, /Channel readiness/);
  assert.match(reps, /The agent can only turn quality signals into email or LinkedIn/);
  assert.match(reps, /after profile, source, and channel checks pass/);
  assert.match(reps, /Judged drafts/);
  assert.match(reps, /OperatingLoopChannel/);
  assert.match(reps, /sent 7d/);
  assert.match(reps, /workspaceChannelCoverage/);
  assert.match(reps, /firstChannelPolicy\(rep, \["linkedin_dm", "linkedin"\]\)/);
  assert.match(reps, /Outreach paths/);
  assert.match(reps, /Agent setup/);
  assert.match(reps, /AgentSetupSummary/);
  assert.match(reps, /Tune in Profile/);
  assert.match(reps, /Voice, accounts, and limits stay in Profile/);
  assert.match(reps, /Channels and limits/);
  assert.ok(
    reps.indexOf("<AgentOutreachPanel outreach={state.outreach} />") <
      reps.indexOf("<AgentReadinessPanel readiness={state.readiness} />"),
    "sent outreach must appear before readiness so Agent opens on execution evidence",
  );
  assert.ok(
    reps.indexOf("<AgentOpportunityPanel opportunities={state.opportunities} />") <
      reps.indexOf("<AgentStrategyPanel strategy={state.strategy} />"),
    "qualified signals must appear before source strategy on the Agent surface",
  );
  assert.ok(
    reps.indexOf("<AgentContactsPanel contacts={state.contacts} />") <
      reps.indexOf("<AgentSequencePanel sequence={sequence} />"),
    "verified contacts must appear before sequence internals on the Agent surface",
  );
  assert.match(reps, /href="\/dashboard\/profile#agent"/);
  assert.match(reps, /\/dashboard\/profile#channels/);
  assert.match(reps, /\/dashboard\/profile#email/);
  assert.match(reps, /\/dashboard\/profile#linkedin/);
  assert.match(reps, /Connect Outlook/);
  assert.match(reps, /Connect LinkedIn/);
  assert.match(reps, /Edit voice/);
  assert.match(reps, /Replies 7d/);
  assert.doesNotMatch(reps, /Active agents/);
  assert.doesNotMatch(reps, /Open agent/);
  assert.doesNotMatch(reps, /function RepCard/);
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
  const reps = source("app/dashboard/reps/page.tsx");

  assert.match(outreach, /redirect\("\/dashboard\/agent#outreach"\)/);
  assert.match(reps, /<SurfaceSection\s+title="Sent outreach"/);
  assert.match(reps, /href=\{sentDraftHref\(message\.conversation_id, message\.id\)\}/);
  assert.match(reps, /#message-\$\{messageId\}/);
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
  assert.match(actions, /Preparing verified contacts and outreach/);
  assert.match(reps, /checkAgentSourcesAction/);
  assert.match(reps, /Check sources/);
  assert.match(reps, /Run source now/);
  assert.match(reps, /name="limit" value="25"/);
  assert.match(productApp, /runWorkspaceSourcePollNow/);
  assert.match(productApp, /workflow_name: WORKSPACE_POLL_WORKFLOW/);
  assert.match(productApp, /workspace-source-manual/);
  assert.match(signals, /redirect\("\/dashboard\/agent#opportunities"\)/);
  assert.match(reps, /Qualified signals/);
  assert.match(reps, /verified emails, LinkedIn\s+profiles/);
  assert.match(reps, /LinkedIn profile/);
  assert.match(reps, /Signal-to-outreach queue/);
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
  assert.match(settings, /aria-label="Profile sections"/);
  assert.match(settings, /id="email"/);
  assert.match(settings, /id="linkedin"/);
  assert.match(settings, /href: "#email"/);
  assert.match(settings, /href: "#linkedin"/);
  assert.match(settings, /href: "#templates"/);
  assert.match(settings, /href: "#contact-quality"/);
  assert.match(settings, /href: "#blocklist"/);
  assert.match(settings, /Profile and <em>integrations<\/em>/);
  assert.match(settings, /Channels ready/);
  assert.match(settings, /channelReadinessCount\(state\)/);
  assert.match(settings, /return `\$\{ready\}\/2 ready`/);
  assert.match(settings, /Email integration/);
  assert.match(settings, /LinkedIn integration/);
  assert.match(settings, /linkedInAccounts: linkedIn\.rows/);
  assert.match(settings, /Connect up to two LinkedIn accounts/);
  assert.match(settings, /First account/);
  assert.match(settings, /Second account/);
  assert.match(settings, /Account and limits/);
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
  assert.match(
    settings,
    /href="\/api\/auth\/linkedin\?return_to=%2Fdashboard%2Fprofile%23linkedin"/,
  );
  assert.match(settings, /href: "#tools"/);
  assert.match(settings, /href: "#agent"/);
  assert.match(settings, /id="agent"/);
  assert.match(settings, /id="motion"/);
  assert.match(settings, /id="tools"/);
  assert.match(settings, /href="\/api\/mcp"/);
  assert.match(settings, /Agent inputs and outreach templates/);
  assert.match(settings, /AI outreach template/);
  assert.match(settings, /name="rep_story"/);
  assert.match(settings, /verified contact or LinkedIn profile/);
  assert.match(settings, /return_to" value="\/dashboard\/profile#agent"/);
  assert.match(settings, /Saving agent/);
  assert.match(settings, /value="autonomous"/);
  assert.match(settings, /value="review_only"/);
  assert.match(settings, /row_number\(\) over/);
  assert.match(settings, /properties ->> 'mailbox_email'/);
  assert.match(actions, /dashboardReturnPath\(formData, "\/dashboard\/profile#agent"\)/);
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
  assert.match(actions, /recordProductPersonFitFeedback/);
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

test("Integrations route folds into Profile", () => {
  const integrations = source("app/dashboard/integrations/page.tsx");
  const outlook = source("app/api/auth/outlook/route.ts");
  const linkedIn = source("app/api/auth/linkedin/route.ts");

  assert.match(integrations, /redirect\("\/dashboard\/profile#channels"\)/);
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
  const settings = source("app/dashboard/settings/page.tsx");

  assert.match(linkedInState, /return_to\?: string/);
  assert.match(linkedInRoute, /safeReturnTo\(req\.nextUrl\.searchParams\.get\("return_to"\)\)/);
  assert.match(linkedInCallback, /state\.return_to \?\? "\/dashboard\/profile#linkedin"/);
  assert.match(linkedInCallback, /dest\.searchParams\.set\("status", "linkedin_connecting"\)/);
  assert.match(settings, /href="\/api\/auth\/linkedin\?return_to=%2Fdashboard%2Fprofile%23linkedin"/);
  assert.match(settings, /id="channels"/);
  assert.match(settings, /scroll-mt-28/);
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
  const settings = source("app/dashboard/settings/page.tsx");
  const repDetail = source("app/dashboard/reps/[id]/page.tsx");
  const productApp = source("core/product/app.ts");
  const playAutonomy = source("core/plays/autonomy.ts");
  const repPrimitive = source("core/primitives/rep.ts");
  const activationGraph = source("core/agents/langgraph/graphs/activation.ts");
  const productTools = source("core/product/tools.ts");
  const migration = source("db/migrations/038_autonomous_default_backfill.sql");

  assert.match(actions, /fallback: DashboardApprovalPolicy = "none"/);
  assert.match(
    settings,
    /const approval =\s+rep\?\.autonomy\?\.channels\?\.email\?\.approval \?\? "none"/,
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
  assert.doesNotMatch(onboardingPage, /label="Integrations"/);
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
  assert.match(onboardingActions, /exclusion_rules/);
  assert.match(onboardingActions, /preferred_language/);
  assert.match(onboardingActions, /runWorkspaceSignalIngestion/);
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
  const brandIconSource = source("components/BrandIcon.tsx");
  const surfaces = [
    source("app/page.tsx"),
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

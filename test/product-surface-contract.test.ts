import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("dashboard navigation uses active product surface routes", () => {
  const shell = source("components/dashboard/Shell.tsx");

  assert.match(shell, /href: "\/dashboard",\s+label: "Dashboard"/);
  assert.match(shell, /href: "\/dashboard\/reps",\s+label: "Agent"/);
  assert.match(shell, /href: "\/dashboard\/settings",\s+label: "Profile"/);
  assert.match(shell, /"\/dashboard\/conversations"/);
  assert.match(shell, /"\/dashboard\/signals"/);
  assert.match(shell, /"\/dashboard\/plays"/);
  assert.match(shell, /"\/dashboard\/outcomes"/);
  assert.doesNotMatch(shell, /label: "Outreach"/);
  assert.doesNotMatch(shell, /label: "Prospects"/);
  assert.doesNotMatch(shell, /label: "Inbox"/);
  assert.doesNotMatch(shell, /label: "Signals"/);
  assert.doesNotMatch(shell, /label: "Plays"/);
  assert.doesNotMatch(shell, /label: "Outcomes"/);
  assert.doesNotMatch(
    shell,
    /href: "\/dashboard\/prospecting", label: "Prospecting"/,
  );
  assert.doesNotMatch(
    shell,
    /href: "\/dashboard\/prospects", label: "Prospects"/,
  );
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

test("retired product surfaces redirect to Plays", () => {
  assert.match(
    source("app/dashboard/content/page.tsx"),
    /redirect\("\/dashboard\/plays"\)/,
  );
  assert.match(
    source("app/dashboard/aeo/page.tsx"),
    /redirect\("\/dashboard\/plays"\)/,
  );
});

test("Dashboard routes setup work through Settings and current surfaces", () => {
  const dashboard = source("app/dashboard/page.tsx");

  assert.match(dashboard, /Welcome back/);
  assert.match(dashboard, /Qualified signals/);
  assert.match(dashboard, /Emails sent/);
  assert.match(dashboard, /LinkedIn DMs/);
  assert.match(dashboard, /Replies \/ meetings/);
  assert.match(dashboard, /Signal mix/);
  assert.match(dashboard, /Outreach insight/);
  assert.match(dashboard, /href: "\/dashboard\/settings#profile"/);
  assert.match(dashboard, /href="\/dashboard\/conversations"/);
  assert.match(dashboard, /href="\/dashboard\/signals"/);
  assert.doesNotMatch(dashboard, /href: "\/dashboard\/prospecting"/);
});

test("Health presents agent observability from the event-sourced summary", () => {
  const health = source("app/dashboard/health/page.tsx");

  assert.match(health, /getWorkspaceAgentObservabilitySummary/);
  assert.match(health, /Agent observability/);
  assert.match(health, /redacted traces/);
  assert.match(health, /eval cases/);
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

test("Plays surface presents Skill optimizer from outcome learning", () => {
  const campaigns = source("app/dashboard/campaigns/page.tsx");
  const plays = source("app/dashboard/plays/page.tsx");
  const actions = source("app/dashboard/actions.ts");

  assert.match(plays, /from "\.\.\/campaigns\/page"/);
  assert.match(actions, /optimizeProductPlaySkills/);
  assert.match(campaigns, /optimizePlaySkillsAction/);
  assert.match(campaigns, /Play Skill optimizer/);
  assert.match(campaigns, /play\.skill\.optimization\.recommended/);
  assert.match(campaigns, /Optimize skills/);
});

test("Prospects open graph-backed profile pages with channel readiness", () => {
  const prospects = source("app/dashboard/prospects/page.tsx");
  const profile = source("app/dashboard/prospects/[id]/page.tsx");

  assert.match(prospects, /href=\{`\/dashboard\/prospects\/\$\{prospect\.id\}`\}/);
  assert.match(prospects, /Profile/);
  assert.match(profile, /Prospect profile/);
  assert.match(profile, /from graph_persons p/);
  assert.match(profile, /left join graph_companies/);
  assert.match(profile, /from signals s/);
  assert.match(profile, /from conversations c/);
  assert.match(profile, /from outcomes o/);
  assert.match(profile, /from channel_accounts ca/);
  assert.match(profile, /Connect LinkedIn/);
  assert.match(profile, /Connect Outlook/);
});

test("Outcomes have a first-class primitive surface", () => {
  const outcomes = source("app/dashboard/outcomes/page.tsx");
  const loading = source("app/dashboard/outcomes/loading.tsx");
  const loader = source("components/dashboard/LoadingState.tsx");

  assert.match(outcomes, /kicker="Outcomes"/);
  assert.match(outcomes, /from outcomes o/);
  assert.match(outcomes, /left join conversations c/);
  assert.match(outcomes, /left join reps r/);
  assert.match(outcomes, /left join signals s/);
  assert.match(outcomes, /href=\{`\/dashboard\/conversations\/\$\{outcome\.conversation_id\}`\}/);
  assert.match(loading, /surface="outcomes"/);
  assert.match(loader, /outcomes: \{ kicker: "Outcomes"/);
});

test("Agent surface shows live work and account readiness", () => {
  const reps = source("app/dashboard/reps/page.tsx");

  assert.match(reps, /AgentActivityPanel/);
  assert.match(reps, /AgentContactsPanel/);
  assert.match(reps, /AgentOutreachPanel/);
  assert.match(reps, /loadAgentContactSummary/);
  assert.match(reps, /loadAgentOutreachSummary/);
  assert.match(reps, /Verified contacts/);
  assert.match(reps, /Signal-ready contacts/);
  assert.match(reps, /verified emails and LinkedIn profiles/);
  assert.match(reps, /href=\{`\/dashboard\/prospects\/\$\{contact\.id\}`\}/);
  assert.match(reps, /Agent outreach, last 7 days/);
  assert.match(reps, /Qualified signals become verified contacts/);
  assert.match(reps, /href="\/dashboard\/conversations"/);
  assert.match(reps, /href=\{`\/dashboard\/conversations\/\$\{message\.conversation_id\}`\}/);
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
  assert.doesNotMatch(reps, /<RepCard key=\{rep\.id\} rep=\{rep\} \/>/);
});

test("dashboard Signal surfaces do not expose manual ingestion controls", () => {
  const campaigns = source("app/dashboard/campaigns/page.tsx");
  const signals = source("app/dashboard/ingestion/page.tsx");
  const actions = source("app/dashboard/actions.ts");
  const onboardingActions = source("app/onboarding/actions.ts");
  const capabilityMap = source("docs/agent-native-capability-map.md");

  assert.doesNotMatch(actions, /runWorkspaceSignalAggregatorOnce/);
  assert.doesNotMatch(actions, /runSignalIngestionAction/);
  assert.doesNotMatch(actions, /runWorkspaceSignalIngestion/);
  assert.doesNotMatch(campaigns, /runSignalIngestionAction/);
  assert.doesNotMatch(campaigns, /Run signal ingestion/);
  assert.doesNotMatch(signals, /runSignalIngestionAction/);
  assert.doesNotMatch(signals, /Ingest signals/);
  assert.doesNotMatch(signals, /Run ingestion/);
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
  assert.match(settings, /Email accounts/);
  assert.match(settings, /LinkedIn accounts/);
  assert.match(settings, /Contact quality/);
  assert.match(settings, /Email and LinkedIn readiness/);
  assert.match(settings, /Email enrichment/);
  assert.match(settings, /Duplicate protection/);
  assert.match(
    settings,
    /jsonb_each\(coalesce\(p\.properties->'email_verification'/,
  );
  assert.match(settings, /Open prospect graph/);
  assert.match(settings, /Blocklist/);
  assert.match(
    settings,
    /Bounces, unsubscribes, and do-not-contact outcomes protect future\s+outreach automatically/,
  );
  assert.match(
    settings,
    /kind in \('bounce','unsubscribe','do_not_contact'\)/,
  );
  assert.match(settings, /Open outcome ledger/);
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
  assert.match(settings, /Audience, agent, and templates/);
  assert.match(settings, /AI outreach template/);
  assert.match(settings, /name="rep_story"/);
  assert.match(settings, /verified contact or LinkedIn profile/);
  assert.match(settings, /return_to" value="\/dashboard\/settings#motion"/);
  assert.match(settings, /value="autonomous"/);
  assert.match(settings, /value="review_only"/);
  assert.match(settings, /row_number\(\) over/);
  assert.match(settings, /properties ->> 'mailbox_email'/);
  assert.match(actions, /dashboardReturnPath\(formData, "\/dashboard\/settings#motion"\)/);
  assert.match(actions, /configureWorkspaceAutonomyMode/);
  assert.match(productApp, /event_type: "workspace\.configured"/);
  assert.match(productApp, /event_type: "rep\.configured"/);
  assert.match(productApp, /event_type: "play\.configured"/);
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
  const productTools = source("core/product/tools.ts");
  const capabilityMap = source("docs/agent-native-capability-map.md");

  assert.match(onboardingPage, /Create your first Outreach Agent/);
  assert.match(onboardingPage, /Step 1 of 4/);
  assert.match(onboardingPage, /finds qualified signals/);
  assert.match(onboardingPage, /verifies contacts/);
  assert.match(onboardingPage, /prepares email or LinkedIn outreach/);
  assert.match(onboardingForm, /Create Outreach Agent/);
  assert.match(onboardingActions, /runWorkspaceActivationSetup/);
  assert.match(onboardingActions, /runWorkspaceSignalIngestion/);
  assert.match(onboardingActions, /wait: false/);
  assert.doesNotMatch(onboardingActions, /runWorkspaceSignalAggregatorOnce/);
  assert.match(onboardingForm, /createActivationSetupFormAction/);
  assert.doesNotMatch(onboardingForm, /createProfileAndAggregatorFormAction/);
  assert.match(productTools, /name: "product\.activation\.setup\.run"/);
  assert.match(productTools, /runWorkspaceActivationSetup/);
  assert.match(productTools, /runWorkspaceSignalIngestion/);
  assert.match(productTools, /initial_signal_ingestion/);
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
  assert.match(home, /Signal-led prospecting/);
  assert.doesNotMatch(home, /function SolarSystem/);
  assert.match(design, /The Signal Operating Surface/);
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

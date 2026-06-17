import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("dashboard navigation uses active product surface routes", () => {
  const shell = source("components/dashboard/Shell.tsx");

  assert.match(shell, /href: "\/dashboard", label: "Dashboard"/);
  assert.match(shell, /href: "\/dashboard\/reps"/);
  assert.match(shell, /href: "\/dashboard\/prospects"/);
  assert.match(shell, /href: "\/dashboard\/conversations"/);
  assert.match(shell, /href="\/dashboard\/settings"/);
  assert.match(shell, /Icon name="settings"/);
  assert.match(shell, /isActivePath\(pathname, "\/dashboard\/integrations"\)/);
  assert.doesNotMatch(
    shell,
    /href: "\/dashboard\/prospecting", label: "Prospecting"/,
  );
  assert.doesNotMatch(
    shell,
    /href: "\/dashboard\/signals", label: "Signals"/,
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

test("Dashboard presents setup, operating loop, and priority moves", () => {
  const dashboard = source("app/dashboard/page.tsx");

  assert.match(dashboard, /Launch checklist/);
  assert.match(dashboard, /Operating loop/);
  assert.match(dashboard, /Prospect graph/);
  assert.match(dashboard, /Prepare Signal-led outreach/);
  assert.match(dashboard, /Scale what produced Outcomes/);
  assert.match(dashboard, /href: "\/dashboard\/prospecting"/);
  assert.match(dashboard, /href: "\/dashboard\/signals"/);
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

  assert.match(setup, /href="\/api\/auth\/outlook"/);
  assert.match(setup, /href="\/api\/auth\/linkedin"/);
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

test("Campaigns presents Play Skill optimizer from outcome learning", () => {
  const campaigns = source("app/dashboard/campaigns/page.tsx");
  const actions = source("app/dashboard/actions.ts");

  assert.match(actions, /optimizeProductPlaySkills/);
  assert.match(campaigns, /optimizePlaySkillsAction/);
  assert.match(campaigns, /Play Skill optimizer/);
  assert.match(campaigns, /play\.skill\.optimization\.recommended/);
  assert.match(campaigns, /Optimize skills/);
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

test("Settings exposes profile, Outlook, and workspace autonomy controls", () => {
  const settings = source("app/dashboard/settings/page.tsx");
  const actions = source("app/dashboard/actions.ts");
  const productApp = source("core/product/app.ts");
  const registry = source("core/substrate/events/registry.ts");

  assert.match(settings, /editCompanyProfileAction/);
  assert.match(settings, /updateWorkspaceAutonomyAction/);
  assert.match(settings, /href="\/api\/auth\/outlook"/);
  assert.match(settings, /href="\/dashboard\/integrations"/);
  assert.match(settings, /value="autonomous"/);
  assert.match(settings, /value="review_only"/);
  assert.match(settings, /row_number\(\) over/);
  assert.match(settings, /properties ->> 'mailbox_email'/);
  assert.match(actions, /configureWorkspaceAutonomyMode/);
  assert.match(productApp, /event_type: "workspace\.configured"/);
  assert.match(productApp, /event_type: "rep\.configured"/);
  assert.match(productApp, /event_type: "play\.configured"/);
  assert.match(registry, /"workspace\.configured": WorkspaceConfigured/);
});

test("Integrations exposes direct Outlook, LinkedIn, and MCP connection paths", () => {
  const integrations = source("app/dashboard/integrations/page.tsx");
  const outlook = source("app/api/auth/outlook/route.ts");
  const linkedIn = source("app/api/auth/linkedin/route.ts");

  assert.match(integrations, /Connect Outlook/);
  assert.match(integrations, /Connect LinkedIn/);
  assert.match(integrations, /href="\/api\/mcp"/);
  assert.match(integrations, /kind in \('oauth_outlook','linkedin_session','linkedin_oauth','email_domain'\)/);
  assert.match(outlook, /authCallbackOrigin/);
  assert.match(linkedIn, /authCallbackOrigin/);
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
  const productTools = source("core/product/tools.ts");
  const capabilityMap = source("docs/agent-native-capability-map.md");

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

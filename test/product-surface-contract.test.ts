import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("dashboard navigation uses active product surface routes", () => {
  const shell = source("components/dashboard/Shell.tsx");

  assert.match(shell, /href: "\/dashboard\/prospecting", label: "Prospecting"/);
  assert.match(shell, /href: "\/dashboard\/signals", label: "Signals"/);
  assert.doesNotMatch(shell, /href: "\/dashboard\/setup", label: "Prospecting"/);
  assert.doesNotMatch(shell, /href: "\/dashboard\/ingestion", label: "Signals"/);
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

test("retired product surfaces redirect to Campaigns", () => {
  assert.match(
    source("app/dashboard/content/page.tsx"),
    /redirect\("\/dashboard\/campaigns"\)/,
  );
  assert.match(
    source("app/dashboard/aeo/page.tsx"),
    /redirect\("\/dashboard\/campaigns"\)/,
  );
});

test("Brief presents the operating loop and priority moves", () => {
  const brief = source("app/dashboard/page.tsx");

  assert.match(brief, /Operating loop/);
  assert.match(brief, /Prospect graph/);
  assert.match(brief, /Prepare Signal-led outreach/);
  assert.match(brief, /Scale what produced Outcomes/);
  assert.match(brief, /href: "\/dashboard\/prospecting"/);
  assert.match(brief, /href: "\/dashboard\/signals"/);
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
  assert.match(setup, /kind in \('email_domain','oauth_outlook','linkedin_session','linkedin_oauth'\)/);
  assert.match(setup, /Ready" value=\{`\$\{readyCount\}\/5`\}/);
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

test("dashboard Signal actions start the durable LangGraph ingestion workflow", () => {
  const campaigns = source("app/dashboard/campaigns/page.tsx");
  const signals = source("app/dashboard/ingestion/page.tsx");
  const actions = source("app/dashboard/actions.ts");
  const capabilityMap = source("docs/agent-native-capability-map.md");

  assert.match(actions, /runWorkspaceSignalIngestion/);
  assert.match(actions, /runSignalIngestionAction/);
  assert.match(actions, /wait: false/);
  assert.doesNotMatch(actions, /runWorkspaceSignalAggregatorOnce/);
  assert.match(campaigns, /runSignalIngestionAction/);
  assert.match(campaigns, /Run signal ingestion/);
  assert.match(signals, /runSignalIngestionAction/);
  assert.match(signals, /Ingest signals/);
  assert.match(capabilityMap, /`\/dashboard\/campaigns`, `\/dashboard\/signals`/);
  assert.match(capabilityMap, /`product\.signal\.ingestion\.run`/);
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
  assert.match(productionWorker, /dispatchSignalMatchingWorkflowFromIngestedEvent/);
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
  assert.match(productApp, /e\.payload->>'intent' in \('meeting_intent', 'positive'\)/);
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

test("visual system uses the Monaco-inspired dark operating surface", () => {
  const globals = source("app/globals.css");
  const layout = source("app/layout.tsx");
  const home = source("app/page.tsx");
  const design = source("DESIGN.md");

  assert.match(globals, /--color-ink-1: #070806/);
  assert.match(globals, /--color-accent: #c9a35b/);
  assert.match(globals, /:root \{ color-scheme: dark; \}/);
  assert.match(layout, /colorScheme: "dark"/);
  assert.match(home, /function ProductPane/);
  assert.match(home, /GTM that keeps itself current/);
  assert.doesNotMatch(home, /function SolarSystem/);
  assert.match(design, /The Signal Operating Surface/);
});

test("Bombsell logo asset stays canonical and untinted", () => {
  const home = source("app/page.tsx");
  const shell = source("components/dashboard/Shell.tsx");
  const logo = source("public/logo.svg");

  assert.match(home, /src="\/logo\.svg"/);
  assert.match(shell, /src="\/logo\.svg"/);
  assert.doesNotMatch(home, /filter-|invert|grayscale|sepia|hue-rotate|brightness|contrast/);
  assert.doesNotMatch(shell, /filter-|invert|grayscale|sepia|hue-rotate|brightness|contrast/);
  assert.match(logo, /fill="#23555C"/);
  assert.match(logo, /fill="#FCFCFD"/);
  assert.match(logo, /fill="#26575E"/);
});

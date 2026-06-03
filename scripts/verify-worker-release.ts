import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { REQUIRED_RESTATE_SERVICES } from "../core/product/health.ts";

interface WorkerServiceContract {
  service: string;
  factory: string;
}

const RESTATE_CAPABLE_ENTRYPOINTS = [
  "scripts/production-worker.ts",
  "scripts/restate-workflows-worker.ts",
] as const;

const WORKFLOW_FACTORIES: WorkerServiceContract[] = [
  { service: "system.restate_runtime_probe.v1", factory: "createRestateRuntimeProbeWorkflow" },
  { service: "series_a_cold_open", factory: "createSeriesAColdOpenPlay" },
  { service: "play.signal_to_email.v1", factory: "createSignalToEmailPlayWorkflow" },
  { service: "play.signal_to_linkedin.v1", factory: "createSignalToLinkedInPlayWorkflow" },
  { service: "play.reply_to_email.v1", factory: "createReplyToEmailPlayWorkflow" },
  { service: "ingest_catalog_poll", factory: "createCatalogPollWorkflow" },
  { service: "ingest_workspace_poll", factory: "createWorkspacePollWorkflow" },
  { service: "ingest_expire_sweep", factory: "createExpireWorkflow" },
  { service: "channel.email_domain_provision.v1", factory: "createSendingDomainProvisioningWorkflow" },
  { service: "channel.email_domain_warmup.v1", factory: "createSendingDomainWarmupWorkflow" },
  { service: "email_domain_warmup_sweep", factory: "createWarmupSweepWorkflow" },
  { service: "email_outlook_subscription_repair", factory: "createOutlookSubscriptionRepairWorkflow" },
  { service: "profile.bootstrap.exa", factory: "createExaProfileBootstrapWorkflow" },
  { service: "rep.brief.refresh.exa", factory: "createExaBriefRefreshWorkflow" },
  { service: "rep.research.exa", factory: "createExaRepResearchWorkflow" },
  { service: "draft.grounding.exa", factory: "createExaDraftGroundingWorkflow" },
  { service: "content.opportunity.exa", factory: "createExaContentOpportunityWorkflow" },
  { service: "aeo.audit.exa", factory: "createExaAeoAuditWorkflow" },
  { service: "signal.discover.open_web.exa", factory: "createExaOpenWebSignalWorkflow" },
];

export interface WorkerReleaseCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export function checkWorkerReleaseContract(
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): WorkerReleaseCheck[] {
  const checks: WorkerReleaseCheck[] = [];
  const contractByService = new Map(WORKFLOW_FACTORIES.map((item) => [item.service, item]));

  for (const service of REQUIRED_RESTATE_SERVICES) {
    const contract = contractByService.get(service);
    checks.push({
      name: `required service ${service}`,
      ok: Boolean(contract),
      detail: contract
        ? `covered by ${contract.factory}`
        : "missing from worker release factory contract",
    });
  }

  for (const entrypoint of RESTATE_CAPABLE_ENTRYPOINTS) {
    const source = readFile(entrypoint);
    for (const contract of WORKFLOW_FACTORIES) {
      checks.push({
        name: `${entrypoint} registers ${contract.service}`,
        ok: source.includes(contract.factory),
        detail: source.includes(contract.factory)
          ? `found ${contract.factory}`
          : `missing ${contract.factory}`,
      });
    }
  }

  for (const doc of ["docs/production-workers.md", "docs/product-audit-2026-06-01.md"]) {
    const source = readFile(doc);
    for (const service of REQUIRED_RESTATE_SERVICES) {
      checks.push({
        name: `${doc} documents ${service}`,
        ok: source.includes(service),
        detail: source.includes(service) ? "documented" : "missing from release docs",
      });
    }
  }

  return checks;
}

async function main(): Promise<void> {
  console.log("Worker release checks");
  const checks = checkWorkerReleaseContract();
  for (const check of checks) {
    console.log(`  ${check.ok ? "OK  " : "FAIL"} ${check.name} - ${check.detail}`);
  }
  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} worker release check(s) failed.`);
    process.exit(1);
  }
  console.log("\nWorker release contract verified.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

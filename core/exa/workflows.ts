import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../substrate/workflows/index.ts";
import {
  configureExaOpenWebSignalSource,
  enrichWorkspaceProfileWithExa,
  researchWorkspaceWithExa,
  type BootstrapResult,
  type ProductExaProfileInput,
  type ProductExaResearchInput,
  type ProductExaResearchResult,
  type ProductExaSignalDiscoveryInput,
  type ProductWorkspaceSession,
} from "../product/app.ts";

export const EXA_PROFILE_BOOTSTRAP_WORKFLOW = "profile.bootstrap.exa";
export const EXA_REP_RESEARCH_WORKFLOW = "rep.research.exa";
export const EXA_DRAFT_GROUNDING_WORKFLOW = "draft.grounding.exa";
export const EXA_CONTENT_OPPORTUNITY_WORKFLOW = "content.opportunity.exa";
export const EXA_AEO_AUDIT_WORKFLOW = "aeo.audit.exa";
export const EXA_OPEN_WEB_SIGNAL_WORKFLOW = "signal.discover.open_web.exa";

export type ExaProfileBootstrapWorkflowInput =
  ProductWorkspaceSession & ProductExaProfileInput;
export type ExaProfileBootstrapWorkflowOutput = Awaited<
  ReturnType<typeof enrichWorkspaceProfileWithExa>
>;

export type ExaResearchWorkflowInput =
  ProductWorkspaceSession & Omit<ProductExaResearchInput, "intent">;
export type ExaResearchWorkflowOutput = ProductExaResearchResult;

export type ExaOpenWebSignalWorkflowInput =
  ProductWorkspaceSession & ProductExaSignalDiscoveryInput;
export type ExaOpenWebSignalWorkflowOutput = BootstrapResult;

export function createExaProfileBootstrapWorkflow(): WorkflowDefinition<
  ExaProfileBootstrapWorkflowInput,
  ExaProfileBootstrapWorkflowOutput
> {
  return defineWorkflow<ExaProfileBootstrapWorkflowInput, ExaProfileBootstrapWorkflowOutput>({
    name: EXA_PROFILE_BOOTSTRAP_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      const { workspace_id, user_id, ...payload } = input;
      return ctx.step("profile.bootstrap", () =>
        enrichWorkspaceProfileWithExa(payload, { workspace_id, user_id }),
      );
    },
  });
}

export function createExaRepResearchWorkflow(): WorkflowDefinition<
  ExaResearchWorkflowInput,
  ExaResearchWorkflowOutput
> {
  return createExaResearchWorkflow(EXA_REP_RESEARCH_WORKFLOW, "rep_research");
}

export function createExaDraftGroundingWorkflow(): WorkflowDefinition<
  ExaResearchWorkflowInput,
  ExaResearchWorkflowOutput
> {
  return createExaResearchWorkflow(EXA_DRAFT_GROUNDING_WORKFLOW, "draft_grounding");
}

export function createExaContentOpportunityWorkflow(): WorkflowDefinition<
  ExaResearchWorkflowInput,
  ExaResearchWorkflowOutput
> {
  return createExaResearchWorkflow(EXA_CONTENT_OPPORTUNITY_WORKFLOW, "content_research");
}

export function createExaAeoAuditWorkflow(): WorkflowDefinition<
  ExaResearchWorkflowInput,
  ExaResearchWorkflowOutput
> {
  return createExaResearchWorkflow(EXA_AEO_AUDIT_WORKFLOW, "aeo_audit");
}

export function createExaOpenWebSignalWorkflow(): WorkflowDefinition<
  ExaOpenWebSignalWorkflowInput,
  ExaOpenWebSignalWorkflowOutput
> {
  return defineWorkflow<ExaOpenWebSignalWorkflowInput, ExaOpenWebSignalWorkflowOutput>({
    name: EXA_OPEN_WEB_SIGNAL_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      const { workspace_id, user_id, ...payload } = input;
      return ctx.step("signal.source.configure", () =>
        configureExaOpenWebSignalSource(payload, { workspace_id, user_id }),
      );
    },
  });
}

function createExaResearchWorkflow(
  name: string,
  intent: NonNullable<ProductExaResearchInput["intent"]>,
): WorkflowDefinition<ExaResearchWorkflowInput, ExaResearchWorkflowOutput> {
  return defineWorkflow<ExaResearchWorkflowInput, ExaResearchWorkflowOutput>({
    name,
    version: "1",
    async run(input, ctx) {
      const { workspace_id, user_id, ...payload } = input;
      return ctx.step("exa.research", () =>
        researchWorkspaceWithExa({ ...payload, intent }, { workspace_id, user_id }),
      );
    },
  });
}

import { BOMBSELL_MCP_OAUTH_SCOPES } from "./oauth-metadata.ts";

export type BombsellMcpScope = typeof BOMBSELL_MCP_OAUTH_SCOPES[number];

export const BOMBSELL_MCP_TOOL_NAMES = {
  briefGet: "bombsell_brief_get",
  launchCheck: "bombsell_launch_check",
  profileProposeFromContext: "bombsell_profile_propose_from_context",
  signalsListQualified: "bombsell_signals_list_qualified",
  contactLanesGet: "bombsell_contact_lanes_get",
  crmHandoffQueue: "bombsell_crm_handoff_queue",
  integrationsList: "bombsell_integrations_list",
  outreachPrepare: "bombsell_outreach_prepare",
  outreachListSent: "bombsell_outreach_list_sent",
  draftGet: "bombsell_draft_get",
  approvalsList: "bombsell_approvals_list",
  approvalsDecide: "bombsell_approvals_decide",
  learningGet: "bombsell_learning_get",
} as const;

export interface BombsellMcpSurfaceTool {
  internalName: string;
  name: string;
  scopes: readonly BombsellMcpScope[];
}

const MCP_SAFE_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

const BOMBSELL_MCP_SURFACE_TOOLS: readonly BombsellMcpSurfaceTool[] = [
  {
    name: BOMBSELL_MCP_TOOL_NAMES.briefGet,
    internalName: "bombsell.brief.get",
    scopes: ["brief:read"],
  },
  {
    name: BOMBSELL_MCP_TOOL_NAMES.launchCheck,
    internalName: "bombsell.launch.check",
    scopes: ["profile:read"],
  },
  {
    name: BOMBSELL_MCP_TOOL_NAMES.profileProposeFromContext,
    internalName: "bombsell.profile.propose_from_context",
    scopes: ["profile:read"],
  },
  {
    name: BOMBSELL_MCP_TOOL_NAMES.signalsListQualified,
    internalName: "bombsell.signals.list_qualified",
    scopes: ["signals:read"],
  },
  {
    name: BOMBSELL_MCP_TOOL_NAMES.contactLanesGet,
    internalName: "bombsell.contact_lanes.get",
    scopes: ["signals:read"],
  },
  {
    name: BOMBSELL_MCP_TOOL_NAMES.crmHandoffQueue,
    internalName: "bombsell.crm_handoff.queue",
    scopes: ["crm:write"],
  },
  {
    name: BOMBSELL_MCP_TOOL_NAMES.integrationsList,
    internalName: "bombsell.integrations.list",
    scopes: ["profile:read"],
  },
  {
    name: BOMBSELL_MCP_TOOL_NAMES.outreachPrepare,
    internalName: "bombsell.outreach.prepare",
    scopes: ["outreach:prepare"],
  },
  {
    name: BOMBSELL_MCP_TOOL_NAMES.outreachListSent,
    internalName: "bombsell.outreach.list_sent",
    scopes: ["outreach:read"],
  },
  {
    name: BOMBSELL_MCP_TOOL_NAMES.draftGet,
    internalName: "bombsell.draft.get",
    scopes: ["outreach:read"],
  },
  {
    name: BOMBSELL_MCP_TOOL_NAMES.approvalsList,
    internalName: "bombsell.approvals.list",
    scopes: ["approvals:read"],
  },
  {
    name: BOMBSELL_MCP_TOOL_NAMES.approvalsDecide,
    internalName: "bombsell.approvals.decide",
    scopes: ["approvals:write"],
  },
  {
    name: BOMBSELL_MCP_TOOL_NAMES.learningGet,
    internalName: "bombsell.learning.get",
    scopes: ["learning:read"],
  },
] as const;

{
  const seenExposedNames = new Set<string>();
  const seenInternalNames = new Set<string>();
  for (const tool of BOMBSELL_MCP_SURFACE_TOOLS) {
    if (!isSafeMcpToolName(tool.name)) {
      throw new Error(`Unsafe MCP surface tool name: ${tool.name}`);
    }
    if (seenExposedNames.has(tool.name)) {
      throw new Error(`Duplicate MCP surface tool name: ${tool.name}`);
    }
    if (seenInternalNames.has(tool.internalName)) {
      throw new Error(`Duplicate MCP internal tool mapping: ${tool.internalName}`);
    }
    seenExposedNames.add(tool.name);
    seenInternalNames.add(tool.internalName);
  }
}

export function isSafeMcpToolName(name: string): boolean {
  return MCP_SAFE_TOOL_NAME_PATTERN.test(name);
}

export function getBombsellMcpSurfaceTools(
  scopes?: Iterable<string> | null,
): readonly BombsellMcpSurfaceTool[] {
  if (scopes == null) return BOMBSELL_MCP_SURFACE_TOOLS;
  const granted = new Set(Array.from(scopes, (scope) => scope.trim()).filter(Boolean));
  if (granted.size === 0) return [];
  return BOMBSELL_MCP_SURFACE_TOOLS.filter((tool) =>
    tool.scopes.some((scope) => granted.has(scope))
  );
}

export function getBombsellMcpToolByName(
  name: string,
  scopes?: Iterable<string> | null,
): BombsellMcpSurfaceTool | null {
  return getBombsellMcpSurfaceTools(scopes).find((tool) => tool.name === name) ?? null;
}

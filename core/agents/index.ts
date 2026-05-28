/**
 * Agent Fabric — Layer 3.
 *
 *   Reps   : user-facing personas (core/agents/reps/)
 *   Tools  : MCP-shaped integrations (core/agents/tools/)
 *   Memory : three-tier — episodic / semantic / procedural (core/agents/memory/)
 *   Eval   : hot-path judges + gates (core/agents/eval/)
 *
 * See ARCHITECTURE.md "Agent Fabric" and core/agents/README.md.
 */

export * as Tools from "./tools/index.ts";
export * as Memory from "./memory/index.ts";
export * as Eval from "./eval/index.ts";
export * as Reps from "./reps/index.ts";

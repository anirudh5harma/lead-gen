/**
 * Rep composition. The Rep is the USER-FACING persona (see
 * core/primitives/rep.ts and ARCHITECTURE.md "Five Primitives"). Underneath,
 * a Rep is composed of role agents — researcher / writer / sender / replier
 * etc. The user never names or configures a role agent directly; they only
 * configure the Rep, and the role agents inherit voice / autonomy /
 * channels from it.
 *
 * Hard rule (AGENTS.md): never expose a raw role agent to the user. Compose
 * the Rep.
 */

import type { Rep } from "../../primitives/index.ts";
import type { ToolContext } from "../tools/types.ts";
import type { Judge } from "../eval/types.ts";
import type { RepMemory } from "../memory/types.ts";

export type RoleAgentKind =
  | "researcher"
  | "writer"
  | "sender"
  | "replier"
  | "scheduler"
  | "summariser";

/**
 * A role agent is a small, focused function: given a typed brief and a
 * context, produce a typed result. It is invoked by a workflow step or by
 * another role agent within the same Rep composition.
 */
export interface RoleAgent<TBrief = unknown, TResult = unknown> {
  kind: RoleAgentKind;
  /** Stable name for telemetry, e.g. `writer.email.cold_open`. */
  name: string;
  invoke(brief: TBrief, ctx: RoleAgentContext): Promise<TResult>;
}

export interface RoleAgentContext {
  rep: Rep;
  tool_context: ToolContext;
  memory: RepMemory;
  /** The judge available to this role agent for hot-path eval. */
  judge: Judge;
}

/**
 * A fully composed Rep — the persona plus the role agents that act on its
 * behalf. Created by `composeRep()`.
 */
export interface ComposedRep {
  rep: Rep;
  roles: Partial<Record<RoleAgentKind, RoleAgent>>;
  /** Look up a role agent by kind, throwing if missing. */
  role<K extends RoleAgentKind>(kind: K): RoleAgent;
}

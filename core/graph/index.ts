/**
 * Knowledge Graph — Layer 2.
 *
 * Nodes  (`graph/nodes/*`)   : Persons, Companies, Sources.
 * Edges  (`graph/edges/*`)   : Typed edges with a registry of legal kinds.
 * Tools  (`graph/tools.ts`)  : Graph operations as MCP-shaped Tools, so
 *                              internal Reps and external agents call them
 *                              the same way.
 *
 * See ARCHITECTURE.md "Knowledge Graph" and db/migrations/004 + 005.
 */

export * from "./types.ts";
export * as Nodes from "./nodes/index.ts";
export * as Edges from "./edges/index.ts";
export { registerGraphTools, _resetGraphToolsRegistration } from "./tools.ts";

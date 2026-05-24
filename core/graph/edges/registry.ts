import type { NodeType } from "../types.ts";

/**
 * Typed edge registry. Declares every legal `edge_type` in the graph
 * along with the node types it can connect.
 *
 *   * Schema-level uniqueness (db/migrations/005_graph_edges.sql) already
 *     guarantees a single edge per (workspace, from, edge_type, to).
 *   * Registry-level `cardinality` controls richer rules:
 *       - `multi`     : a from-node may have many outgoing edges of this
 *                       type. (e.g. `mentioned_in` — a person may be
 *                       mentioned in many signals.)
 *       - `singleton` : at most one outgoing edge of this type per
 *                       from-node. Subsequent `connect` calls overwrite
 *                       (used for e.g. `current_works_at`).
 *
 *   * `from` / `to` may be a single NodeType or an array (the edge accepts
 *     any listed source/target type).
 *
 * New edge kinds land here as a strictly-additive change. Removing a kind
 * is a breaking schema change and needs a migration to clean stale rows.
 */

export type EdgeCardinality = "multi" | "singleton";

export interface EdgeDefinition {
  from: NodeType | NodeType[];
  to: NodeType | NodeType[];
  cardinality: EdgeCardinality;
  description: string;
}

export const edgeRegistry = {
  /** A person works at a company. Singleton (people switch jobs). */
  works_at: {
    from: "person",
    to: "company",
    cardinality: "singleton",
    description: "Current employer relationship.",
  },

  /** A person was reached via a channel account (email inbox, LinkedIn). */
  contacted_via: {
    from: "person",
    to: "account",
    cardinality: "multi",
    description: "Channel account used to reach this person.",
  },

  /** A person or company is referenced inside a signal. */
  mentioned_in: {
    from: ["person", "company"],
    to: "signal",
    cardinality: "multi",
    description: "Subject of a signal we ingested.",
  },

  /** An inbound message is a reply to one of our outbound messages. */
  replied_to: {
    from: "message",
    to: "message",
    cardinality: "multi",
    description: "Reply linkage between two messages in a conversation.",
  },

  /** A post was authored by a Rep. */
  authored_by: {
    from: "post",
    to: "rep",
    cardinality: "singleton",
    description: "Authoring Rep of a published post.",
  },

  /** A message belongs to a conversation. */
  part_of: {
    from: "message",
    to: "conversation",
    cardinality: "singleton",
    description: "Conversation membership for a message.",
  },

  /** A person matched our ICP via a particular signal. */
  matched_by: {
    from: "person",
    to: "signal",
    cardinality: "multi",
    description: "ICP match attribution.",
  },

  /** An outcome was influenced by a signal, message, or play. */
  influenced: {
    from: "outcome",
    to: ["signal", "message", "post"],
    cardinality: "multi",
    description: "Attribution edge for outcomes.",
  },
} as const satisfies Record<string, EdgeDefinition>;

export type EdgeKind = keyof typeof edgeRegistry;

export function isKnownEdgeKind(s: string): s is EdgeKind {
  return Object.prototype.hasOwnProperty.call(edgeRegistry, s);
}

export function validateEdge(
  kind: EdgeKind,
  from_node_type: NodeType,
  to_node_type: NodeType,
): void {
  const def = edgeRegistry[kind] as EdgeDefinition;
  const allowedFrom = (Array.isArray(def.from) ? def.from : [def.from]) as NodeType[];
  const allowedTo = (Array.isArray(def.to) ? def.to : [def.to]) as NodeType[];
  if (!allowedFrom.includes(from_node_type)) {
    throw new Error(
      `Edge '${kind}' cannot originate from '${from_node_type}'. Allowed: ${allowedFrom.join(", ")}.`,
    );
  }
  if (!allowedTo.includes(to_node_type)) {
    throw new Error(
      `Edge '${kind}' cannot target '${to_node_type}'. Allowed: ${allowedTo.join(", ")}.`,
    );
  }
}

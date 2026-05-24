import type { Pool } from "pg";
import type { GraphEdge, NodeRef, NodeType } from "../types.ts";
import { edgeRegistry, isKnownEdgeKind, validateEdge, type EdgeKind } from "./registry.ts";

interface EdgeRow {
  id: string;
  workspace_id: string;
  from_node_type: NodeType;
  from_node_id: string;
  to_node_type: NodeType;
  to_node_id: string;
  edge_type: string;
  properties: Record<string, unknown>;
  provenance: Record<string, unknown>;
  created_at: Date;
}

function rowToEdge(row: EdgeRow): GraphEdge {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    from_node_type: row.from_node_type,
    from_node_id: row.from_node_id,
    to_node_type: row.to_node_type,
    to_node_id: row.to_node_id,
    edge_type: row.edge_type,
    properties: row.properties ?? {},
    provenance: row.provenance ?? {},
    created_at: row.created_at.toISOString(),
  };
}

export interface ConnectInput {
  workspace_id: string;
  from: NodeRef;
  to: NodeRef;
  kind: EdgeKind;
  properties?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
}

/**
 * Add (or, for singleton edges, replace) an edge between two nodes.
 *
 * Validates from/to types against the registry, then either:
 *   - multi      : inserts (no-op if the unique-triple already exists)
 *   - singleton  : deletes any existing outgoing edge of this kind from
 *                  the `from` node, then inserts the new one. Old edge
 *                  rows are gone, not soft-deleted — consume the
 *                  `graph.edges.disconnected` event upstream if you need
 *                  to react.
 */
export async function connect(
  pool: Pool,
  input: ConnectInput,
): Promise<GraphEdge> {
  validateEdge(input.kind, input.from.node_type, input.to.node_type);
  const def = edgeRegistry[input.kind];

  if (def.cardinality === "singleton") {
    await pool.query(
      `delete from graph_edges
        where workspace_id = $1
          and from_node_type = $2
          and from_node_id = $3
          and edge_type = $4`,
      [input.workspace_id, input.from.node_type, input.from.node_id, input.kind],
    );
  }

  const { rows } = await pool.query<EdgeRow>(
    `insert into graph_edges (
       workspace_id,
       from_node_type, from_node_id,
       to_node_type, to_node_id,
       edge_type, properties, provenance
     ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
     on conflict (workspace_id, from_node_type, from_node_id, edge_type, to_node_type, to_node_id)
     do update set
       properties = graph_edges.properties || excluded.properties,
       provenance = excluded.provenance
     returning *`,
    [
      input.workspace_id,
      input.from.node_type,
      input.from.node_id,
      input.to.node_type,
      input.to.node_id,
      input.kind,
      JSON.stringify(input.properties ?? {}),
      JSON.stringify(input.provenance ?? {}),
    ],
  );
  return rowToEdge(rows[0]!);
}

export async function disconnect(
  pool: Pool,
  workspace_id: string,
  from: NodeRef,
  kind: EdgeKind,
  to?: NodeRef,
): Promise<number> {
  if (!isKnownEdgeKind(kind)) {
    throw new Error(`Unknown edge kind: ${kind}`);
  }
  if (to) {
    const { rowCount } = await pool.query(
      `delete from graph_edges
        where workspace_id = $1
          and from_node_type = $2 and from_node_id = $3
          and to_node_type = $4   and to_node_id = $5
          and edge_type = $6`,
      [
        workspace_id,
        from.node_type,
        from.node_id,
        to.node_type,
        to.node_id,
        kind,
      ],
    );
    return rowCount ?? 0;
  }
  const { rowCount } = await pool.query(
    `delete from graph_edges
      where workspace_id = $1
        and from_node_type = $2 and from_node_id = $3
        and edge_type = $4`,
    [workspace_id, from.node_type, from.node_id, kind],
  );
  return rowCount ?? 0;
}

export interface TraversalQuery {
  workspace_id: string;
  node: NodeRef;
  /** If empty, returns every edge regardless of kind. */
  kinds?: EdgeKind[];
  limit?: number;
}

export async function outgoing(
  pool: Pool,
  query: TraversalQuery,
): Promise<GraphEdge[]> {
  const limit = query.limit ?? 100;
  const { rows } = query.kinds && query.kinds.length > 0
    ? await pool.query<EdgeRow>(
        `select * from graph_edges
          where workspace_id = $1
            and from_node_type = $2 and from_node_id = $3
            and edge_type = any($4::text[])
          order by created_at desc
          limit $5`,
        [
          query.workspace_id,
          query.node.node_type,
          query.node.node_id,
          query.kinds,
          limit,
        ],
      )
    : await pool.query<EdgeRow>(
        `select * from graph_edges
          where workspace_id = $1
            and from_node_type = $2 and from_node_id = $3
          order by created_at desc
          limit $4`,
        [query.workspace_id, query.node.node_type, query.node.node_id, limit],
      );
  return rows.map(rowToEdge);
}

export async function incoming(
  pool: Pool,
  query: TraversalQuery,
): Promise<GraphEdge[]> {
  const limit = query.limit ?? 100;
  const { rows } = query.kinds && query.kinds.length > 0
    ? await pool.query<EdgeRow>(
        `select * from graph_edges
          where workspace_id = $1
            and to_node_type = $2 and to_node_id = $3
            and edge_type = any($4::text[])
          order by created_at desc
          limit $5`,
        [
          query.workspace_id,
          query.node.node_type,
          query.node.node_id,
          query.kinds,
          limit,
        ],
      )
    : await pool.query<EdgeRow>(
        `select * from graph_edges
          where workspace_id = $1
            and to_node_type = $2 and to_node_id = $3
          order by created_at desc
          limit $4`,
        [query.workspace_id, query.node.node_type, query.node.node_id, limit],
      );
  return rows.map(rowToEdge);
}

/**
 * Knowledge graph — shared types. See ARCHITECTURE.md "Knowledge Graph" and
 * db/migrations/004_graph_nodes.sql + 005_graph_edges.sql.
 *
 * The graph is a logical layer over Postgres + pgvector. Nodes are typed
 * rows (`graph_persons`, `graph_companies`, `graph_sources`, ...); edges
 * are typed rows in `graph_edges` connecting any pair of node types.
 *
 * Every read here is workspace-scoped. Server-side callers pass
 * workspace_id explicitly; request-time callers wrap in
 * `withWorkspace()` so RLS evaluates the user too.
 */

export type NodeType =
  | "person"
  | "company"
  | "signal"
  | "conversation"
  | "message"
  | "post"
  | "outcome"
  | "rep"
  | "source"
  | "account";

export interface NodeRef {
  node_type: NodeType;
  node_id: string;
}

// ─── Companies ─────────────────────────────────────────────────────────────

export interface GraphCompany {
  id: string;
  workspace_id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size_bucket: string | null;
  description: string | null;
  properties: Record<string, unknown>;
  provenance: Record<string, unknown>;
  embedded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyUpsert {
  name: string;
  domain?: string;
  industry?: string;
  size_bucket?: string;
  description?: string;
  properties?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
  /** 1536-dim vector. Stored as pgvector; null if not yet embedded. */
  embedding?: number[];
}

// ─── Persons ───────────────────────────────────────────────────────────────

export interface GraphPerson {
  id: string;
  workspace_id: string;
  full_name: string;
  given_name: string | null;
  family_name: string | null;
  title: string | null;
  company_id: string | null;
  emails: string[];
  phones: string[];
  linkedin_url: string | null;
  x_handle: string | null;
  properties: Record<string, unknown>;
  provenance: Record<string, unknown>;
  embedded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PersonUpsert {
  full_name: string;
  given_name?: string;
  family_name?: string;
  title?: string;
  company_id?: string;
  emails?: string[];
  phones?: string[];
  linkedin_url?: string;
  x_handle?: string;
  properties?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
  embedding?: number[];
}

// ─── Sources ───────────────────────────────────────────────────────────────

export type SourceKind =
  | "gdelt"
  | "hn"
  | "product_hunt"
  | "rss"
  | "job_board"
  | "web_monitor"
  | "podcast"
  | "newsletter"
  | "manual"
  | "other";

export interface GraphSource {
  id: string;
  workspace_id: string;
  kind: SourceKind;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  last_polled_at: string | null;
  properties: Record<string, unknown>;
  created_at: string;
}

export interface SourceUpsert {
  kind: SourceKind;
  name: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
  properties?: Record<string, unknown>;
}

// ─── Edges ─────────────────────────────────────────────────────────────────

export interface GraphEdge {
  id: string;
  workspace_id: string;
  from_node_type: NodeType;
  from_node_id: string;
  to_node_type: NodeType;
  to_node_id: string;
  edge_type: string;
  properties: Record<string, unknown>;
  provenance: Record<string, unknown>;
  created_at: string;
}

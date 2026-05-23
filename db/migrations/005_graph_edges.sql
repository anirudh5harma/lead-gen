-- 005_graph_edges.sql
-- Typed edges between graph nodes. Polymorphic from/to so the same table
-- handles every relationship the agent fabric needs to traverse:
--
--   WorksAt      Person  -> Company
--   ContactedVia Person  -> Account / Channel
--   MentionedIn  Person  -> Signal
--   MentionedIn  Company -> Signal
--   RepliedTo    Person  -> Message
--   Influenced   Outcome -> Signal | Message | Play
--   MatchedBy    Person  -> Signal       (ICP match)
--   AuthoredBy   Post    -> Rep
--   PartOf       Message -> Conversation
--
-- The set of edge_type values is intentionally open (text, not enum) so new
-- edge kinds can land without a migration. A registry of legal types lives
-- in core/graph/edges/registry.ts and is enforced at write time.

create table graph_edges (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,

  from_node_type    text not null,            -- 'person' | 'company' | 'signal' | 'conversation' | 'message' | 'post' | 'outcome' | 'rep' | 'source' | 'account'
  from_node_id      uuid not null,
  to_node_type      text not null,
  to_node_id        uuid not null,

  edge_type         text not null,            -- registry-enforced; see core/graph/edges/registry.ts

  properties        jsonb not null default '{}'::jsonb,
  provenance        jsonb not null default '{}'::jsonb,

  created_at        timestamptz not null default now()
);

-- Outbound traversal: 'what does this node connect to?'
create index graph_edges_from_idx
  on graph_edges (workspace_id, from_node_type, from_node_id, edge_type);

-- Inbound traversal: 'what points at this node?'
create index graph_edges_to_idx
  on graph_edges (workspace_id, to_node_type, to_node_id, edge_type);

-- Dedup an exact (from, edge_type, to) triple per workspace. Allows multi-edges
-- only when callers pass distinct properties via the registry's `multi: true`
-- declaration (enforced in code, not DB).
create unique index graph_edges_unique_triple_idx
  on graph_edges (workspace_id, from_node_type, from_node_id, edge_type, to_node_type, to_node_id);

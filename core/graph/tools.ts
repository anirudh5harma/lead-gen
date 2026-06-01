import { z } from "zod";
import { getPool } from "../substrate/storage/index.ts";
import { registerTool } from "../agents/tools/registry.ts";
import {
  deleteCompany,
  findCompanyByDomain,
  getCompany,
  listCompaniesByName,
  upsertCompany,
} from "./nodes/companies.ts";
import {
  deletePerson,
  findPersonByEmail,
  findPersonByLinkedIn,
  getPerson,
  listPersonsForCompany,
  upsertPerson,
} from "./nodes/persons.ts";
import {
  deleteSource,
  getSource,
  listSources,
  upsertSource,
} from "./nodes/sources.ts";
import {
  connect,
  disconnect,
  incoming,
  outgoing,
} from "./edges/queries.ts";
import { edgeRegistry, type EdgeKind } from "./edges/registry.ts";

/**
 * Register the knowledge-graph operations as Tools. After this is called,
 * the Tool registry has real entries and the MCP server (core/mcp/) can
 * expose them to external agents on instantiation.
 *
 * Idempotent: registering twice throws on duplicate name, so we skip
 * registration if `graph.companies.upsert` is already present. This makes
 * the function safe to call from app bootstrap and from tests.
 */

const SourceKindEnum = z.enum([
  "gdelt",
  "hn",
  "product_hunt",
  "rss",
  "job_board",
  "web_monitor",
  "podcast",
  "newsletter",
  "manual",
  "other",
]);

const EdgeKindEnum = z.enum(
  Object.keys(edgeRegistry) as [EdgeKind, ...EdgeKind[]],
);

const NodeTypeEnum = z.enum([
  "person",
  "company",
  "signal",
  "conversation",
  "message",
  "post",
  "outcome",
  "rep",
  "source",
  "account",
]);

const NodeRefSchema = z.object({
  node_type: NodeTypeEnum,
  node_id: z.string().uuid(),
});

const PropertiesSchema = z.record(z.string(), z.unknown()).optional();
const ProvenanceSchema = z.record(z.string(), z.unknown()).optional();

// Output schemas mirror core/graph/types.ts. Strict (no passthrough): Zod
// strips unknown keys on parse, which keeps MCP responses tightly scoped
// to the documented shape.

const CompanySchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  name: z.string(),
  domain: z.string().nullable(),
  industry: z.string().nullable(),
  size_bucket: z.string().nullable(),
  description: z.string().nullable(),
  properties: z.record(z.string(), z.unknown()),
  provenance: z.record(z.string(), z.unknown()),
  embedded_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const PersonSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  full_name: z.string(),
  given_name: z.string().nullable(),
  family_name: z.string().nullable(),
  title: z.string().nullable(),
  company_id: z.string().uuid().nullable(),
  emails: z.array(z.string()),
  phones: z.array(z.string()),
  linkedin_url: z.string().nullable(),
  x_handle: z.string().nullable(),
  properties: z.record(z.string(), z.unknown()),
  provenance: z.record(z.string(), z.unknown()),
  embedded_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const SourceSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  kind: SourceKindEnum,
  name: z.string(),
  config: z.record(z.string(), z.unknown()),
  enabled: z.boolean(),
  last_polled_at: z.string().nullable(),
  properties: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});

const EdgeSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  from_node_type: NodeTypeEnum,
  from_node_id: z.string().uuid(),
  to_node_type: NodeTypeEnum,
  to_node_id: z.string().uuid(),
  edge_type: z.string(),
  properties: z.record(z.string(), z.unknown()),
  provenance: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});

let registered = false;

export function registerGraphTools(): void {
  if (registered) return;
  registered = true;

  // ─── Companies ───────────────────────────────────────────────────────

  registerTool({
    name: "graph.companies.upsert",
    description:
      "Create or update a company node. Keyed by domain when present; falls back to (workspace, name).",
    kind: "write",
    input: z.object({
      name: z.string().min(1),
      domain: z.string().min(1).optional(),
      industry: z.string().optional(),
      size_bucket: z.string().optional(),
      description: z.string().optional(),
      properties: PropertiesSchema,
      provenance: ProvenanceSchema,
    }),
    output: CompanySchema,
    async handler(input, ctx) {
      return upsertCompany(getPool(), ctx.workspace_id, input);
    },
  });

  registerTool({
    name: "graph.companies.get",
    description: "Fetch a company node by id.",
    kind: "read",
    input: z.object({ id: z.string().uuid() }),
    output: CompanySchema.nullable(),
    async handler({ id }, ctx) {
      return getCompany(getPool(), ctx.workspace_id, id);
    },
  });

  registerTool({
    name: "graph.companies.find",
    description:
      "Find a company by domain (exact) or by case-insensitive name substring.",
    kind: "read",
    input: z.object({
      domain: z.string().optional(),
      name: z.string().optional(),
      limit: z.number().int().positive().max(100).optional(),
    }),
    output: z.array(CompanySchema),
    async handler(input, ctx) {
      const pool = getPool();
      if (input.domain) {
        const c = await findCompanyByDomain(pool, ctx.workspace_id, input.domain);
        return c ? [c] : [];
      }
      if (input.name) {
        return listCompaniesByName(
          pool,
          ctx.workspace_id,
          input.name,
          input.limit ?? 25,
        );
      }
      return [];
    },
  });

  registerTool({
    name: "graph.companies.delete",
    description:
      "Delete a company node from the workspace graph and remove its graph edges.",
    kind: "write",
    input: z.object({ id: z.string().uuid() }),
    output: z.object({ deleted: z.boolean() }),
    async handler({ id }, ctx) {
      return {
        deleted: await deleteCompany(getPool(), ctx.workspace_id, id),
      };
    },
  });

  // ─── Persons ─────────────────────────────────────────────────────────

  registerTool({
    name: "graph.persons.upsert",
    description:
      "Create or update a person node. Matches existing rows by linkedin_url, then email overlap, then (company_id, full_name).",
    kind: "write",
    input: z.object({
      full_name: z.string().min(1),
      given_name: z.string().optional(),
      family_name: z.string().optional(),
      title: z.string().optional(),
      company_id: z.string().uuid().optional(),
      emails: z.array(z.string().email()).optional(),
      phones: z.array(z.string()).optional(),
      linkedin_url: z.string().url().optional(),
      x_handle: z.string().optional(),
      properties: PropertiesSchema,
      provenance: ProvenanceSchema,
    }),
    output: PersonSchema,
    async handler(input, ctx) {
      return upsertPerson(getPool(), ctx.workspace_id, input);
    },
  });

  registerTool({
    name: "graph.persons.get",
    description: "Fetch a person node by id.",
    kind: "read",
    input: z.object({ id: z.string().uuid() }),
    output: PersonSchema.nullable(),
    async handler({ id }, ctx) {
      return getPerson(getPool(), ctx.workspace_id, id);
    },
  });

  registerTool({
    name: "graph.persons.find",
    description:
      "Find persons by email, LinkedIn URL, or by company. At least one filter must be provided.",
    kind: "read",
    input: z
      .object({
        email: z.string().email().optional(),
        linkedin_url: z.string().url().optional(),
        company_id: z.string().uuid().optional(),
        limit: z.number().int().positive().max(200).optional(),
      })
      .refine(
        (v) => Boolean(v.email || v.linkedin_url || v.company_id),
        "at least one of email / linkedin_url / company_id is required",
      ),
    output: z.array(PersonSchema),
    async handler(input, ctx) {
      const pool = getPool();
      if (input.email) {
        const p = await findPersonByEmail(pool, ctx.workspace_id, input.email);
        return p ? [p] : [];
      }
      if (input.linkedin_url) {
        const p = await findPersonByLinkedIn(pool, ctx.workspace_id, input.linkedin_url);
        return p ? [p] : [];
      }
      if (input.company_id) {
        return listPersonsForCompany(
          pool,
          ctx.workspace_id,
          input.company_id,
          input.limit ?? 50,
        );
      }
      return [];
    },
  });

  registerTool({
    name: "graph.persons.delete",
    description:
      "Delete a person node from the workspace graph and remove its graph edges.",
    kind: "write",
    input: z.object({ id: z.string().uuid() }),
    output: z.object({ deleted: z.boolean() }),
    async handler({ id }, ctx) {
      return {
        deleted: await deletePerson(getPool(), ctx.workspace_id, id),
      };
    },
  });

  // ─── Sources ─────────────────────────────────────────────────────────

  registerTool({
    name: "graph.sources.upsert",
    description: "Create or update a signal/content source (RSS, GDELT, HN, ...).",
    kind: "write",
    input: z.object({
      kind: SourceKindEnum,
      name: z.string().min(1),
      config: PropertiesSchema,
      enabled: z.boolean().optional(),
      properties: PropertiesSchema,
    }),
    output: SourceSchema,
    async handler(input, ctx) {
      return upsertSource(getPool(), ctx.workspace_id, input);
    },
  });

  registerTool({
    name: "graph.sources.list",
    description: "List sources for the workspace, optionally filtered by kind.",
    kind: "read",
    input: z.object({ kind: SourceKindEnum.optional() }),
    output: z.array(SourceSchema),
    async handler({ kind }, ctx) {
      return listSources(getPool(), ctx.workspace_id, kind);
    },
  });

  registerTool({
    name: "graph.sources.get",
    description: "Fetch a source by id.",
    kind: "read",
    input: z.object({ id: z.string().uuid() }),
    output: SourceSchema.nullable(),
    async handler({ id }, ctx) {
      return getSource(getPool(), ctx.workspace_id, id);
    },
  });

  registerTool({
    name: "graph.sources.delete",
    description:
      "Delete a source node from the workspace graph and remove its graph edges.",
    kind: "write",
    input: z.object({ id: z.string().uuid() }),
    output: z.object({ deleted: z.boolean() }),
    async handler({ id }, ctx) {
      return {
        deleted: await deleteSource(getPool(), ctx.workspace_id, id),
      };
    },
  });

  // ─── Edges ───────────────────────────────────────────────────────────

  registerTool({
    name: "graph.edges.connect",
    description:
      "Create (or, for singleton kinds, replace) an edge between two graph nodes. " +
      "Validates from/to node types against the edge registry.",
    kind: "write",
    input: z.object({
      from: NodeRefSchema,
      to: NodeRefSchema,
      kind: EdgeKindEnum,
      properties: PropertiesSchema,
      provenance: ProvenanceSchema,
    }),
    output: EdgeSchema,
    async handler(input, ctx) {
      return connect(getPool(), {
        workspace_id: ctx.workspace_id,
        from: input.from,
        to: input.to,
        kind: input.kind,
        properties: input.properties,
        provenance: input.provenance,
      });
    },
  });

  registerTool({
    name: "graph.edges.disconnect",
    description:
      "Delete an edge. If `to` is provided, deletes the single matching edge; otherwise deletes all outgoing edges of this kind from the `from` node.",
    kind: "write",
    input: z.object({
      from: NodeRefSchema,
      kind: EdgeKindEnum,
      to: NodeRefSchema.optional(),
    }),
    output: z.object({ deleted: z.number().int().nonnegative() }),
    async handler(input, ctx) {
      const deleted = await disconnect(
        getPool(),
        ctx.workspace_id,
        input.from,
        input.kind,
        input.to,
      );
      return { deleted };
    },
  });

  registerTool({
    name: "graph.edges.outgoing",
    description: "List edges originating from a node, optionally filtered by edge kinds.",
    kind: "read",
    input: z.object({
      node: NodeRefSchema,
      kinds: z.array(EdgeKindEnum).optional(),
      limit: z.number().int().positive().max(500).optional(),
    }),
    output: z.array(EdgeSchema),
    async handler(input, ctx) {
      return outgoing(getPool(), {
        workspace_id: ctx.workspace_id,
        node: input.node,
        kinds: input.kinds,
        limit: input.limit,
      });
    },
  });

  registerTool({
    name: "graph.edges.incoming",
    description: "List edges pointing into a node, optionally filtered by edge kinds.",
    kind: "read",
    input: z.object({
      node: NodeRefSchema,
      kinds: z.array(EdgeKindEnum).optional(),
      limit: z.number().int().positive().max(500).optional(),
    }),
    output: z.array(EdgeSchema),
    async handler(input, ctx) {
      return incoming(getPool(), {
        workspace_id: ctx.workspace_id,
        node: input.node,
        kinds: input.kinds,
        limit: input.limit,
      });
    },
  });
}

/** Test helper: allow re-registration after `_resetToolRegistry()`. */
export function _resetGraphToolsRegistration(): void {
  registered = false;
}

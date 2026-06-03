import { z } from "zod";
import { registerTool } from "../agents/tools/registry.ts";
import { getPool } from "../substrate/storage/index.ts";
import {
  getExaContentsWithWorkspaceBudget,
  getWorkspaceExaCostSummary,
  searchExaWithWorkspaceCache,
} from "./cache.ts";
import { createExaClientFromEnv } from "./client.ts";

const SearchTypeSchema = z.enum(["auto", "neural", "keyword", "fast"]);
const ExaIntentSchema = z.enum([
  "profile_bootstrap",
  "rep_research",
  "brief_refresh",
  "draft_grounding",
  "content_research",
  "aeo_audit",
  "signal_discovery",
]);

const ExaResultSchema = z.object({
  id: z.string().nullable(),
  url: z.string(),
  title: z.string().nullable(),
  score: z.number().nullable(),
  publishedDate: z.string().nullable(),
  author: z.string().nullable(),
  text: z.string().nullable(),
  highlights: z.array(z.string()),
  summary: z.string().nullable(),
  image: z.string().nullable(),
  favicon: z.string().nullable(),
  raw: z.record(z.string(), z.unknown()),
});

const SearchInputSchema = z.object({
  query: z.string().min(1),
  type: SearchTypeSchema.optional(),
  category: z.string().optional(),
  num_results: z.number().int().positive().max(100).optional(),
  include_domains: z.array(z.string().min(1)).optional(),
  exclude_domains: z.array(z.string().min(1)).optional(),
  start_published_date: z.string().datetime().optional(),
  start_crawl_date: z.string().datetime().optional(),
  include_text: z.boolean().optional(),
  text_max_characters: z.number().int().positive().optional(),
  highlights: z.boolean().optional(),
  summary: z.boolean().optional(),
  intent: ExaIntentSchema.optional(),
  play_id: z.string().min(1).optional(),
});

const SearchOutputSchema = z.object({
  request_id: z.string().nullable(),
  autoprompt_string: z.string().nullable(),
  results: z.array(ExaResultSchema),
  cache_hit: z.boolean(),
  query_hash: z.string(),
  usage_id: z.string().nullable(),
});

let registered = false;

export function registerExaTools(): void {
  if (registered) return;
  registered = true;

  registerTool({
    name: "exa.search",
    description:
      "Search the public web semantically with Exa. Returns normalized results with URLs, snippets, optional text, and provenance-ready raw data.",
    kind: "external",
    input: SearchInputSchema,
    output: SearchOutputSchema,
    async handler(input, ctx) {
      const result = await searchExaWithWorkspaceCache({
        pool: getPool(),
        workspace_id: ctx.workspace_id,
        intent: input.intent ?? "rep_research",
        client: createExaClientFromEnv(),
        play_id: input.play_id ?? null,
        search: {
          query: input.query,
          type: input.type,
          category: input.category,
          numResults: input.num_results,
          includeDomains: input.include_domains,
          excludeDomains: input.exclude_domains,
          startPublishedDate: input.start_published_date,
          startCrawlDate: input.start_crawl_date,
          includeText: input.include_text,
          textMaxCharacters: input.text_max_characters,
          highlights: input.highlights,
          summary: input.summary,
        },
      });
      const response = result.response;
      return {
        request_id: response.requestId,
        autoprompt_string: response.autopromptString,
        results: response.results,
        cache_hit: result.cache_hit,
        query_hash: result.query_hash,
        usage_id: result.usage_id,
      };
    },
  });

  registerTool({
    name: "exa.get_contents",
    description:
      "Fetch clean page contents for Exa result ids or URLs. Use this after search to ground Rep writing and judge checks.",
    kind: "external",
    input: z.object({
      ids: z.array(z.string().min(1)).optional(),
      urls: z.array(z.string().url()).optional(),
      include_text: z.boolean().optional(),
      text_max_characters: z.number().int().positive().optional(),
      highlights: z.boolean().optional(),
      summary: z.boolean().optional(),
      intent: ExaIntentSchema.optional(),
      play_id: z.string().min(1).optional(),
    }),
    output: z.object({
      request_id: z.string().nullable(),
      results: z.array(ExaResultSchema),
      content_hash: z.string(),
      usage_id: z.string().nullable(),
    }),
    async handler(input, ctx) {
      const result = await getExaContentsWithWorkspaceBudget({
        pool: getPool(),
        workspace_id: ctx.workspace_id,
        intent: input.intent ?? "rep_research",
        client: createExaClientFromEnv(),
        play_id: input.play_id ?? null,
        contents: {
          ids: input.ids,
          urls: input.urls,
          includeText: input.include_text ?? true,
          textMaxCharacters: input.text_max_characters,
          highlights: input.highlights,
          summary: input.summary,
        },
      });
      return {
        request_id: result.response.requestId,
        results: result.response.results,
        content_hash: result.content_hash,
        usage_id: result.usage_id,
      };
    },
  });

  registerTool({
    name: "exa.find_people",
    description:
      "Find public people/profile pages with Exa People Search semantics. Use for research and enrichment, not contact verification.",
    kind: "external",
    input: SearchInputSchema.extend({
      num_results: z.number().int().positive().max(50).optional(),
    }),
    output: SearchOutputSchema,
    async handler(input, ctx) {
      const result = await searchExaWithWorkspaceCache({
        pool: getPool(),
        workspace_id: ctx.workspace_id,
        intent: input.intent ?? "rep_research",
        client: createExaClientFromEnv(),
        play_id: input.play_id ?? null,
        search: {
          query: input.query,
          type: input.type ?? "auto",
          category: input.category ?? "people",
          numResults: input.num_results ?? 10,
          includeText: input.include_text,
          textMaxCharacters: input.text_max_characters,
          highlights: input.highlights,
          summary: input.summary,
        },
      });
      const response = result.response;
      return {
        request_id: response.requestId,
        autoprompt_string: response.autopromptString,
        results: response.results,
        cache_hit: result.cache_hit,
        query_hash: result.query_hash,
        usage_id: result.usage_id,
      };
    },
  });

  registerTool({
    name: "exa.find_companies",
    description:
      "Find public company pages from ICP, market, or account criteria. Use for graph enrichment and campaign target discovery.",
    kind: "external",
    input: SearchInputSchema.extend({
      num_results: z.number().int().positive().max(50).optional(),
    }),
    output: SearchOutputSchema,
    async handler(input, ctx) {
      const result = await searchExaWithWorkspaceCache({
        pool: getPool(),
        workspace_id: ctx.workspace_id,
        intent: input.intent ?? "rep_research",
        client: createExaClientFromEnv(),
        play_id: input.play_id ?? null,
        search: {
          query: input.query,
          type: input.type ?? "auto",
          category: input.category ?? "company",
          numResults: input.num_results ?? 10,
          includeDomains: input.include_domains,
          excludeDomains: input.exclude_domains,
          includeText: input.include_text,
          textMaxCharacters: input.text_max_characters,
          highlights: input.highlights,
          summary: input.summary,
        },
      });
      const response = result.response;
      return {
        request_id: response.requestId,
        autoprompt_string: response.autopromptString,
        results: response.results,
        cache_hit: result.cache_hit,
        query_hash: result.query_hash,
        usage_id: result.usage_id,
      };
    },
  });

  registerTool({
    name: "exa.webset.create",
    description:
      "Create a constrained Exa Webset for durable public-web research. Prefer narrow workspace/Play-scoped searches.",
    kind: "external",
    input: z.object({
      query: z.string().min(1),
      count: z.number().int().positive().max(1000).optional(),
      enrichments: z.array(z.record(z.string(), z.unknown())).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
    output: z.object({
      id: z.string().nullable(),
      status: z.string().nullable(),
      raw: z.record(z.string(), z.unknown()),
    }),
    async handler(input) {
      return createExaClientFromEnv().createWebset({
        search: { query: input.query, count: input.count },
        enrichments: input.enrichments,
        metadata: input.metadata,
      });
    },
  });

  registerTool({
    name: "exa.webset.results.list",
    description: "List items from an Exa Webset by id.",
    kind: "external",
    input: z.object({ webset_id: z.string().min(1) }),
    output: z.record(z.string(), z.unknown()),
    async handler(input) {
      return createExaClientFromEnv().listWebsetItems(input.webset_id);
    },
  });

  registerTool({
    name: "exa.costs.get",
    description:
      "Report workspace Exa usage, cache activity, direct-call caps, and remaining budget.",
    kind: "read",
    input: z.object({
      play_id: z.string().min(1).optional(),
    }),
    output: z.object({
      configured: z.boolean(),
      caps: z.object({
        daily_query_cap: z.number(),
        daily_contents_cap: z.number(),
        monthly_unit_cap: z.number(),
        per_play_research_cap: z.number(),
      }),
      used: z.object({
        queries_24h: z.number(),
        contents_24h: z.number(),
        units_month: z.number(),
        play_research_24h: z.number(),
        deferred_24h: z.number(),
      }),
      remaining: z.object({
        daily_queries: z.number(),
        daily_contents: z.number(),
        monthly_units: z.number(),
        play_research: z.number(),
      }),
      cache: z.object({
        active_query_entries: z.number(),
        active_content_entries: z.number(),
        cache_hits_24h: z.number(),
      }),
    }),
    async handler(input, ctx) {
      return getWorkspaceExaCostSummary(getPool(), ctx.workspace_id, process.env, input.play_id ?? null);
    },
  });
}

export function _resetExaToolsRegistration(): void {
  registered = false;
}

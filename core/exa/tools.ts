import { z } from "zod";
import { registerTool } from "../agents/tools/registry.ts";
import { createExaClientFromEnv } from "./client.ts";

const SearchTypeSchema = z.enum(["auto", "neural", "keyword", "fast"]);

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
});

const SearchOutputSchema = z.object({
  request_id: z.string().nullable(),
  autoprompt_string: z.string().nullable(),
  results: z.array(ExaResultSchema),
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
    async handler(input) {
      const response = await createExaClientFromEnv().search({
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
      });
      return {
        request_id: response.requestId,
        autoprompt_string: response.autopromptString,
        results: response.results,
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
    }),
    output: z.object({
      request_id: z.string().nullable(),
      results: z.array(ExaResultSchema),
    }),
    async handler(input) {
      const response = await createExaClientFromEnv().getContents({
        ids: input.ids,
        urls: input.urls,
        includeText: input.include_text ?? true,
        textMaxCharacters: input.text_max_characters,
        highlights: input.highlights,
        summary: input.summary,
      });
      return {
        request_id: response.requestId,
        results: response.results,
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
    async handler(input) {
      const response = await createExaClientFromEnv().search({
        query: input.query,
        type: input.type ?? "auto",
        category: input.category ?? "people",
        numResults: input.num_results ?? 10,
        includeText: input.include_text,
        textMaxCharacters: input.text_max_characters,
        highlights: input.highlights,
        summary: input.summary,
      });
      return {
        request_id: response.requestId,
        autoprompt_string: response.autopromptString,
        results: response.results,
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
    async handler(input) {
      const response = await createExaClientFromEnv().search({
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
      });
      return {
        request_id: response.requestId,
        autoprompt_string: response.autopromptString,
        results: response.results,
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
      "Report whether Exa is configured. Workspace-level budget accounting is enforced by product source quotas.",
    kind: "read",
    input: z.object({}),
    output: z.object({
      configured: z.boolean(),
      env_key: z.literal("EXA_API_KEY"),
      budget_note: z.string(),
    }),
    async handler() {
      return {
        configured: Boolean(process.env.EXA_API_KEY?.trim()),
        env_key: "EXA_API_KEY" as const,
        budget_note:
          "Use product.source.configure quotas for daily calls/items and monthly spend caps.",
      };
    },
  });
}

export function _resetExaToolsRegistration(): void {
  registered = false;
}

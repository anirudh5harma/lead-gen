import type {
  WorkspaceAdapter,
  WorkspacePollInput,
  WorkspacePollResult,
} from "./_workspace-types.ts";
import type { RawCandidate } from "../types.ts";

/**
 * ProductHunt GraphQL adapter. Workspace-driven (each workspace decides
 * whether it cares about product launches). Requires a ProductHunt API
 * token in env (PRODUCT_HUNT_TOKEN); without it the adapter no-ops so
 * tests + offline dev pass.
 *
 *   config: { limit?: number — default 50 }
 *
 * kindHint: 'product_launch'.
 */

const ENDPOINT = "https://api.producthunt.com/v2/api/graphql";

interface PhPost {
  id: string;
  name: string;
  tagline?: string;
  description?: string;
  website?: string;
  url?: string;
  votesCount?: number;
  createdAt?: string;
  topics?: { edges?: Array<{ node?: { name?: string } }> };
  makers?: Array<{ name?: string; username?: string }>;
}

interface PhResponse {
  data?: {
    posts?: {
      edges?: Array<{ node?: PhPost }>;
    };
  };
  errors?: Array<{ message: string }>;
}

const QUERY = `
  query NewestPosts($limit: Int!) {
    posts(order: NEWEST, first: $limit) {
      edges {
        node {
          id
          name
          tagline
          description
          website
          url
          votesCount
          createdAt
          topics(first: 10) { edges { node { name } } }
        }
      }
    }
  }
`;

export class ProductHuntError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(`ProductHunt: ${message} (status ${status})`);
    this.name = "ProductHuntError";
    this.status = status;
  }
}

export const productHuntAdapter: WorkspaceAdapter = {
  id: "product_hunt",
  kindHint: "product_launch",

  async poll(input: WorkspacePollInput): Promise<WorkspacePollResult> {
    const token =
      (input.source.config as { token?: string }).token ??
      process.env.PRODUCT_HUNT_TOKEN;
    if (!token) {
      // No token configured — degrade gracefully so the workspace poll
      // workflow doesn't crash. Cursor untouched.
      return { items: [], cursor: input.cursor };
    }
    const limit = (input.source.config as { limit?: number }).limit ?? 50;
    const fetchImpl = input.fetchImpl ?? globalThis.fetch;
    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query: QUERY, variables: { limit } }),
    });
    if (!response.ok) {
      throw new ProductHuntError("query failed", response.status);
    }
    const json = (await response.json()) as PhResponse;
    if (json.errors?.length) {
      throw new ProductHuntError(json.errors[0].message, 200);
    }
    const edges = json.data?.posts?.edges ?? [];
    const items: RawCandidate[] = [];
    for (const edge of edges) {
      const post = edge?.node;
      if (!post?.id || !post.name) continue;
      const topics = (post.topics?.edges ?? [])
        .map((e) => e?.node?.name)
        .filter((n): n is string => Boolean(n));
      items.push({
        external_id: post.id,
        title: post.tagline ? `${post.name} — ${post.tagline}` : post.name,
        content: post.description ?? post.tagline ?? undefined,
        url: post.url,
        structured: {
          name: post.name,
          tagline: post.tagline ?? null,
          website: post.website ?? null,
          votes: post.votesCount ?? null,
          topics,
        },
        freshness_at: post.createdAt ?? new Date().toISOString(),
        provenance: { adapter: "product_hunt", raw_id: post.id },
      });
    }
    return {
      items,
      cursor: { last_polled_at: new Date().toISOString(), count: items.length },
    };
  },
};

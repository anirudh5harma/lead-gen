import type {
  WorkspaceAdapter,
  WorkspacePollInput,
  WorkspacePollResult,
} from "./_workspace-types.ts";
import type { RawCandidate } from "../types.ts";
import { withinFreshnessWindow, maxAgeDaysFromConfig } from "./_freshness-window.ts";

/**
 * Hacker News front page adapter. Workspace-driven.
 *
 *   1. GET https://hacker-news.firebaseio.com/v0/topstories.json  → array of ids
 *   2. For each top-N id: GET https://hacker-news.firebaseio.com/v0/item/<id>.json
 *
 *   config: { limit?: number — default 30 }
 *
 * Cursor: { seen_ids: number[] } — items already returned in a prior poll.
 * On each poll we send only the new top-N ids; we trim the cursor to the
 * most recent ~200 to keep size bounded.
 */

const BASE = "https://hacker-news.firebaseio.com/v0";

interface HnItem {
  id: number;
  type?: string;
  title?: string;
  url?: string;
  text?: string;
  by?: string;
  time?: number;
  descendants?: number;
  score?: number;
}

export class HnError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(`HN API: ${message} (status ${status})`);
    this.name = "HnError";
    this.status = status;
  }
}

export const hnFrontAdapter: WorkspaceAdapter = {
  id: "hn_front",
  kindHint: null,

  async poll(input: WorkspacePollInput): Promise<WorkspacePollResult> {
    const fetchImpl = input.fetchImpl ?? globalThis.fetch;
    const limit = (input.source.config as { limit?: number }).limit ?? 30;
    const maxAgeDays = maxAgeDaysFromConfig(input.source.config, 14);
    const seen = new Set<number>(
      Array.isArray((input.cursor as { seen_ids?: number[] }).seen_ids)
        ? (input.cursor as { seen_ids: number[] }).seen_ids
        : [],
    );

    const topResp = await fetchImpl(`${BASE}/topstories.json`, {
      headers: { Accept: "application/json" },
    });
    if (!topResp.ok) {
      throw new HnError("failed to fetch topstories", topResp.status);
    }
    const top = (await topResp.json()) as number[];
    const subset = top.slice(0, limit);
    const items: RawCandidate[] = [];
    const newSeen: number[] = [];
    for (const id of subset) {
      newSeen.push(id);
      if (seen.has(id)) continue;
      const itemResp = await fetchImpl(`${BASE}/item/${id}.json`, {
        headers: { Accept: "application/json" },
      });
      if (!itemResp.ok) continue;
      const item = (await itemResp.json()) as HnItem | null;
      if (!item || item.type !== "story" || !item.title) continue;
      const freshness_at =
        typeof item.time === "number"
          ? new Date(item.time * 1000).toISOString()
          : new Date().toISOString();
      if (!withinFreshnessWindow(freshness_at, maxAgeDays)) continue;
      items.push({
        external_id: String(item.id),
        title: item.title,
        content: item.text,
        url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
        structured: {
          score: item.score ?? null,
          comments: item.descendants ?? null,
          by: item.by ?? null,
        },
        freshness_at,
        provenance: { adapter: "hn_front", hn_id: item.id },
      });
    }

    // Cap the cursor at 500 ids — far more than the front-page window.
    const merged = [...newSeen, ...seen];
    const deduped = Array.from(new Set(merged)).slice(0, 500);

    return {
      items,
      cursor: {
        last_polled_at: new Date().toISOString(),
        seen_ids: deduped,
      },
    };
  },
};

import type {
  WorkspaceAdapter,
  WorkspacePollInput,
  WorkspacePollResult,
} from "./_workspace-types.ts";
import { stripHtml } from "./_hiring-heuristics.ts";
import type { RawCandidate } from "../types.ts";

/**
 * Hacker News "Ask HN: Who is hiring?" monthly thread. One of the highest-
 * signal hiring sources for tech startups — each top-level comment is a
 * job posting.
 *
 * Strategy:
 *   1. Algolia search for the most recent "Who is hiring?" thread by
 *      `whoishiring` user.
 *   2. Fetch the thread to get the kids[] array of comment ids.
 *   3. Fetch each new comment (paged by cursor.seen_ids).
 *
 *   config: { /* no required config; the monthly thread auto-rotates *\/ }
 *
 * kindHint: 'hiring' — every comment IS a job posting; LLM doesn't need
 * to classify, only to extract role / function / seniority.
 */

const ALGOLIA = "https://hn.algolia.com/api/v1";
const FIREBASE = "https://hacker-news.firebaseio.com/v0";

interface AlgoliaHit {
  objectID: string;
  title?: string;
  created_at?: string;
  author?: string;
}

interface AlgoliaSearchResponse {
  hits: AlgoliaHit[];
}

interface HnComment {
  id: number;
  type?: string;
  text?: string;
  by?: string;
  time?: number;
  parent?: number;
  deleted?: boolean;
  dead?: boolean;
}

interface HnStory {
  id: number;
  title?: string;
  kids?: number[];
  by?: string;
  time?: number;
}

export class HnHiringError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(`HN whoishiring: ${message} (status ${status})`);
    this.name = "HnHiringError";
    this.status = status;
  }
}

export const hnWhosHiringAdapter: WorkspaceAdapter = {
  id: "hn_whos_hiring",
  kindHint: "hiring",

  async poll(input: WorkspacePollInput): Promise<WorkspacePollResult> {
    const fetchImpl = input.fetchImpl ?? globalThis.fetch;
    const cursor = input.cursor as {
      thread_id?: number;
      seen_ids?: number[];
    };
    const seen = new Set<number>(Array.isArray(cursor.seen_ids) ? cursor.seen_ids : []);

    // 1. Find the active thread. Search by whoishiring with story type.
    const searchUrl = `${ALGOLIA}/search_by_date?tags=story,author_whoishiring&hitsPerPage=5`;
    const searchResp = await fetchImpl(searchUrl, { headers: { Accept: "application/json" } });
    if (!searchResp.ok) {
      throw new HnHiringError("Algolia search failed", searchResp.status);
    }
    const search = (await searchResp.json()) as AlgoliaSearchResponse;
    const thread = (search.hits ?? []).find((h) =>
      (h.title ?? "").toLowerCase().includes("who is hiring"),
    );
    if (!thread) {
      return {
        items: [],
        cursor: { ...cursor, last_polled_at: new Date().toISOString() },
      };
    }
    const threadId = Number(thread.objectID);

    // If the active month rolled over, reset the seen_ids set so we
    // capture every comment in the new thread.
    const carriedSeen = cursor.thread_id === threadId ? seen : new Set<number>();

    // 2. Fetch the thread for kids[].
    const storyResp = await fetchImpl(`${FIREBASE}/item/${threadId}.json`);
    if (!storyResp.ok) {
      throw new HnHiringError(`fetch thread ${threadId} failed`, storyResp.status);
    }
    const story = (await storyResp.json()) as HnStory | null;
    const kids = Array.isArray(story?.kids) ? story!.kids : [];

    const items: RawCandidate[] = [];
    for (const id of kids) {
      if (carriedSeen.has(id)) continue;
      const commentResp = await fetchImpl(`${FIREBASE}/item/${id}.json`);
      if (!commentResp.ok) continue;
      const comment = (await commentResp.json()) as HnComment | null;
      if (!comment || comment.type !== "comment" || !comment.text) continue;
      if (comment.deleted || comment.dead) continue;
      const text = stripHtml(comment.text);
      // The first line of a Who-is-hiring comment is conventionally the
      // company + role + location; use it as the title.
      const firstLine = text.split(/\n\s*\n/)[0]?.trim() ?? text.slice(0, 200);
      const title = firstLine.length > 240 ? firstLine.slice(0, 240) + "…" : firstLine;
      items.push({
        external_id: String(comment.id),
        external_thread_id: String(threadId),
        title,
        content: text,
        url: `https://news.ycombinator.com/item?id=${comment.id}`,
        structured: {
          author: comment.by ?? null,
          thread_id: threadId,
        },
        freshness_at:
          typeof comment.time === "number"
            ? new Date(comment.time * 1000).toISOString()
            : new Date().toISOString(),
        provenance: { adapter: "hn_whos_hiring", hn_id: comment.id, thread_id: threadId },
      });
    }

    // Refresh seen_ids — include every kid we know about for this thread
    // (so they don't reappear next poll), capped at 5000.
    const updatedSeen = Array.from(new Set([...carriedSeen, ...kids])).slice(0, 5000);

    return {
      items,
      cursor: {
        last_polled_at: new Date().toISOString(),
        thread_id: threadId,
        seen_ids: updatedSeen,
      },
    };
  },
};

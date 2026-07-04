"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSessionForDashboard } from "@/lib/workspace";

const REDDIT_ADAPTER = "reddit_search";
const POLL_CADENCE_SEC = 60 * 60; // 1 hour per source

function parseList(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(/[,\n]/g)
    .map((entry) => entry.trim().replace(/^\/?r\//i, ""))
    .filter(Boolean)
    .slice(0, 20);
}

export async function saveRedditWatchlistAction(formData: FormData) {
  const session = await getActiveWorkspaceSessionForDashboard("reddit/save");
  if (!session) redirect("/dashboard/reddit");

  const subreddits = parseList(formData.get("subreddits"));
  const keywords = parseList(formData.get("keywords"));

  const pool = getPool();
  const existing = await pool.query<{ id: string }>(
    `select id from graph_sources
      where workspace_id = $1
        and (config->>'adapter' = 'reddit_search'
             or config->>'adapter' = 'reddit')
      order by created_at asc
      limit 1`,
    [session.workspace.id],
  );

  const sourceId = existing.rows[0]?.id ?? randomUUID();
  const enabled = subreddits.length > 0;
  const config = {
    adapter: REDDIT_ADAPTER,
    subreddits,
    keywords,
    max_items_per_poll: 8,
    max_daily_calls: Math.max(24, subreddits.length * 24),
  };

  await pool.query(
    `insert into graph_sources (
       id, workspace_id, kind, name, config, enabled, properties
     ) values ($1, $2, 'social'::source_kind, $3, $4::jsonb, $5, $6::jsonb)
     on conflict (id) do update set
       config = excluded.config,
       enabled = excluded.enabled,
       properties = graph_sources.properties || excluded.properties`,
    [
      sourceId,
      session.workspace.id,
      "Reddit thread watchlist",
      JSON.stringify(config),
      enabled,
      JSON.stringify({
        managed_by: "reddit-marketing",
        acquisition_mode: "workspace_adapter",
      }),
    ],
  );

  await pool.query(
    `insert into workspace_source_configs (
       workspace_id, source_id, enabled, poll_cadence_sec
     ) values ($1, $2, $3, $4)
     on conflict (workspace_id, source_id) do update set
       enabled = excluded.enabled,
       poll_cadence_sec = excluded.poll_cadence_sec`,
    [session.workspace.id, sourceId, enabled, POLL_CADENCE_SEC],
  );

  revalidatePath("/dashboard/reddit");
  redirect("/dashboard/reddit");
}

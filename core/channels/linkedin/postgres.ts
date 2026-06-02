import type { Pool } from "pg";
import { createNativeLinkedInChannel } from "./dry-run.ts";
import type {
  LinkedInChannel,
  LinkedInChannelName,
  LinkedInSessionAccount,
  LinkedInTransport,
} from "./types.ts";

export interface PostgresLinkedInChannelOptions {
  pool: Pool;
  transport: LinkedInTransport;
  defaultAction?: LinkedInChannelName;
  now?: () => Date;
}

export function createPostgresLinkedInChannel(
  opts: PostgresLinkedInChannelOptions,
): LinkedInChannel {
  const defaultAction = opts.defaultAction ?? "linkedin_dm";
  return {
    name: defaultAction,

    async send(conversation, draft, ctx) {
      const action = linkedInActionFromDraft(draft.channel) ?? defaultAction;
      const accounts = await loadLinkedInAccounts(opts.pool, ctx.workspace_id);
      return createNativeLinkedInChannel({
        action,
        accounts,
        transport: opts.transport,
        now: opts.now,
      }).send(conversation, draft, ctx);
    },
  };
}

async function loadLinkedInAccounts(
  pool: Pool,
  workspaceId: string,
): Promise<LinkedInSessionAccount[]> {
  const { rows } = await pool.query<{
    id: string;
    display_name: string;
    kind: "linkedin_session" | "linkedin_oauth";
    status: LinkedInSessionAccount["status"];
    daily_cap: number | null;
    daily_used: number | null;
  }>(
    `select id, display_name, kind::text as kind, status::text as status,
            daily_cap, daily_used
       from channel_accounts
      where workspace_id = $1
        and kind in ('linkedin_session','linkedin_oauth')
      order by last_used_at nulls first, created_at asc`,
    [workspaceId],
  );
  return rows.map((row) => ({
    id: row.id,
    display_name: row.display_name,
    kind: row.kind,
    status: row.status,
    daily_cap: Math.max(0, Math.trunc(row.daily_cap ?? 0)),
    daily_used: Math.max(0, Math.trunc(row.daily_used ?? 0)),
  }));
}

function linkedInActionFromDraft(value: string): LinkedInChannelName | null {
  if (
    value === "linkedin_connection" ||
    value === "linkedin_dm" ||
    value === "linkedin_comment"
  ) {
    return value;
  }
  return null;
}

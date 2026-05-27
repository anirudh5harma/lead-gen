import type { Pool } from "pg";
import type {
  EventBus,
  PublishedEvent,
  Subscription,
} from "../../events/index.ts";
import { RestateClientError } from "./restate.ts";

export interface RestateEventWaitRegistration {
  id: string;
  workspace_id: string;
  workflow_name: string;
  workflow_key: string;
  run_id: string;
  event_type: string;
  promise_name: string;
}

export interface RestateEventSignal {
  wait_id: string;
  promise_name: string;
  event: PublishedEvent;
}

export interface RestateEventSignalStore {
  registerWait(wait: RestateEventWaitRegistration): Promise<void>;
  consumeWait(waitId: string): Promise<void>;
}

export interface PostgresRestateEventSignalStore extends RestateEventSignalStore {
  recoverStaleDeliveries(olderThanMs?: number): Promise<number>;
}

export interface RestateEventSignalBridgeOptions {
  pool: Pool;
  bus: EventBus;
  ingressUrl: string;
  bearer?: string;
  fetchImpl?: typeof fetch;
  maxDeliveriesPerEvent?: number;
}

interface WaitingRow {
  id: string;
  workflow_name: string;
  workflow_key: string;
  promise_name: string;
}

export function createPostgresRestateEventSignalStore(
  pool: Pool,
): PostgresRestateEventSignalStore {
  return {
    async registerWait(wait) {
      await pool.query(
        `insert into workflow_event_waits (
           id, workspace_id, workflow_name, workflow_key, run_id,
           event_type, promise_name, status, created_at
         ) values ($1, $2, $3, $4, $5, $6, $7, 'waiting', now())
         on conflict (id) do update set
           status = case
             when workflow_event_waits.status in ('waiting', 'delivering')
               then 'waiting'::workflow_event_wait_status
             else workflow_event_waits.status
           end,
           last_error = null`,
        [
          wait.id,
          wait.workspace_id,
          wait.workflow_name,
          wait.workflow_key,
          wait.run_id,
          wait.event_type,
          wait.promise_name,
        ],
      );
    },

    async consumeWait(waitId) {
      await pool.query(
        `update workflow_event_waits
            set status = 'consumed',
                consumed_at = coalesce(consumed_at, now())
          where id = $1
            and status in ('waiting', 'delivering', 'delivered', 'consumed')`,
        [waitId],
      );
    },

    async recoverStaleDeliveries(olderThanMs = 60_000) {
      const { rowCount } = await pool.query(
        `update workflow_event_waits
            set status = 'waiting',
                last_error = coalesce(last_error, 'delivery retry after stale in-flight state')
          where status = 'delivering'
            and delivered_at < now() - ($1::text || ' milliseconds')::interval`,
        [olderThanMs],
      );
      return rowCount ?? 0;
    },
  };
}

export async function startRestateEventSignalBridge(
  opts: RestateEventSignalBridgeOptions,
): Promise<Subscription> {
  await createPostgresRestateEventSignalStore(opts.pool).recoverStaleDeliveries();
  return opts.bus.subscribe("*", async (event) => {
    await deliverEventToRestateWaits(opts, event);
  });
}

export async function deliverEventToRestateWaits(
  opts: RestateEventSignalBridgeOptions,
  event: PublishedEvent,
): Promise<number> {
  const limit = opts.maxDeliveriesPerEvent ?? 100;
  const { rows } = await opts.pool.query<WaitingRow>(
    `select id, workflow_name, workflow_key, promise_name
       from workflow_event_waits
      where workspace_id = $1
        and event_type = $2
        and status = 'waiting'
      order by created_at asc
      limit $3`,
    [event.workspace_id, event.event_type, limit],
  );

  let delivered = 0;
  for (const row of rows) {
    if (await deliverOneWait(opts, row, event)) {
      delivered += 1;
    }
  }
  return delivered;
}

async function deliverOneWait(
  opts: RestateEventSignalBridgeOptions,
  row: WaitingRow,
  event: PublishedEvent,
): Promise<boolean> {
  const claimed = await opts.pool.query(
    `update workflow_event_waits
        set status = 'delivering',
            matched_event_id = $2,
            delivered_payload = $3::jsonb,
            delivered_at = now(),
            last_error = null
      where id = $1
        and status = 'waiting'`,
    [row.id, event.id, JSON.stringify(event.payload ?? null)],
  );
  if ((claimed.rowCount ?? 0) === 0) return false;

  try {
    await postRestateEventSignal(opts, row, {
      wait_id: row.id,
      promise_name: row.promise_name,
      event,
    });
    await opts.pool.query(
      `update workflow_event_waits
          set status = 'delivered',
              delivered_at = coalesce(delivered_at, now())
        where id = $1
          and status = 'delivering'`,
      [row.id],
    );
    return true;
  } catch (err) {
    await opts.pool.query(
      `update workflow_event_waits
          set status = 'waiting',
              last_error = $2
        where id = $1
          and status = 'delivering'`,
      [row.id, err instanceof Error ? err.message : String(err)],
    );
    throw err;
  }
}

async function postRestateEventSignal(
  opts: RestateEventSignalBridgeOptions,
  row: WaitingRow,
  signal: RestateEventSignal,
): Promise<void> {
  const ingressUrl = opts.ingressUrl.replace(/\/$/, "");
  const path = `/${encodeURIComponent(row.workflow_name)}/${encodeURIComponent(
    row.workflow_key,
  )}/resolveEventWait/send`;
  const response = await (opts.fetchImpl ?? globalThis.fetch)(`${ingressUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "idempotency-key": `workflow-event-wait:${row.id}:${signal.event.id}`,
      ...(opts.bearer ? { Authorization: `Bearer ${opts.bearer}` } : {}),
    },
    body: JSON.stringify(signal),
  });
  if (!response.ok) {
    throw new RestateClientError(
      `Restate POST ${path} failed`,
      response.status,
      await response.text(),
    );
  }
}

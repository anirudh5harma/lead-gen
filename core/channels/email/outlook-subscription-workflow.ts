import type { Pool } from "pg";
import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../../substrate/workflows/index.ts";
import type { OutlookAccessTokenProvider } from "./adapters/outlook.ts";
import {
  createOutlookSubscription,
  deleteOutlookSubscription,
  loadSubscription,
  persistOutlookSubscription,
  renewOutlookSubscription,
  type OutlookSubscription,
} from "./outlook-subscription.ts";

export interface OutlookSubscriptionRepairDeps {
  pool: Pool;
  accessTokens: OutlookAccessTokenProvider;
  notificationUrl: string;
  /**
   * Defaults to `notificationUrl`. Set explicitly when the lifecycle
   * webhook lives at a different route (e.g. dedicated path with
   * different authentication).
   */
  lifecycleNotificationUrl?: string;
  renewBeforeMs?: number;
  fetchImpl?: typeof fetch;
}

export interface OutlookSubscriptionRepairInput {
  workspace_id: string;
  channel_account_id?: string;
  limit?: number;
}

export interface OutlookSubscriptionRepairSummary {
  accounts_checked: number;
  subscriptions_created: number;
  subscriptions_renewed: number;
  subscriptions_migrated: number;
  failed: number;
}

interface OutlookAccountTarget {
  id: string;
  workspace_id: string;
}

/**
 * Creates missing Microsoft Graph subscriptions and renews subscriptions close
 * to expiration. Every invocation is workspace-scoped; an operator scheduler
 * starts one keyed workflow per workspace.
 */
export function createOutlookSubscriptionRepairWorkflow(
  deps: OutlookSubscriptionRepairDeps,
): WorkflowDefinition<OutlookSubscriptionRepairInput, OutlookSubscriptionRepairSummary> {
  const renewBeforeMs = deps.renewBeforeMs ?? 12 * 60 * 60 * 1000;

  return defineWorkflow<
    OutlookSubscriptionRepairInput,
    OutlookSubscriptionRepairSummary
  >({
    name: "email_outlook_subscription_repair",
    version: "1",
    async run(input, ctx): Promise<OutlookSubscriptionRepairSummary> {
      if (input.workspace_id !== ctx.workspace_id) {
        throw new Error(
          "Outlook subscription repair input workspace does not match workflow workspace",
        );
      }

      const targets = await ctx.step("list_subscription_targets", () =>
        listSubscriptionTargets(deps.pool, input, renewBeforeMs),
      );
      const summary: OutlookSubscriptionRepairSummary = {
        accounts_checked: 0,
        subscriptions_created: 0,
        subscriptions_renewed: 0,
        subscriptions_migrated: 0,
        failed: 0,
      };
      const lifecycleNotificationUrl =
        deps.lifecycleNotificationUrl ?? deps.notificationUrl;

      for (const target of targets) {
        summary.accounts_checked += 1;
        const existing = await ctx.step(`load_subscription:${target.id}`, () =>
          loadSubscription(deps.pool, target.workspace_id, target.id),
        );
        // Legacy migration: a subscription persisted before lifecycle URL
        // was wired in lives without it. PATCH-renew can't add it (Graph
        // ignores the field on PATCH for /me/messages), so we delete +
        // recreate — the new subscription has lifecycleNotificationUrl set.
        const needsMigration = Boolean(existing) && !existing!.lifecycleNotificationUrl;
        const operation = needsMigration
          ? "created" as const
          : existing
            ? "renewed" as const
            : "created" as const;
        let subscription: OutlookSubscription;
        try {
          const accessToken = await ctx.step(`load_access_token:${target.id}`, () =>
            deps.accessTokens.getAccessToken(target.id),
          );
          if (needsMigration) {
            await ctx.step(`delete_legacy_subscription:${target.id}`, () =>
              deleteOutlookSubscription({
                pool: deps.pool,
                workspaceId: target.workspace_id,
                channelAccountId: target.id,
                accessToken,
                fetchImpl: deps.fetchImpl,
              }),
            );
          }
          subscription = await ctx.step(
            `graph_subscription:${target.id}`,
            () =>
              existing && !needsMigration
                ? renewOutlookSubscription({
                    pool: deps.pool,
                    workspaceId: target.workspace_id,
                    channelAccountId: target.id,
                    accessToken,
                    fetchImpl: deps.fetchImpl,
                    persist: false,
                  })
                : createOutlookSubscription({
                    pool: deps.pool,
                    workspaceId: target.workspace_id,
                    channelAccountId: target.id,
                    accessToken,
                    notificationUrl: deps.notificationUrl,
                    lifecycleNotificationUrl,
                    fetchImpl: deps.fetchImpl,
                    persist: false,
                  }),
            {
              retry: { max_attempts: 3, backoff: "exponential", base_ms: 500 },
            },
          );
        } catch (err) {
          summary.failed += 1;
          const message = err instanceof Error ? err.message : String(err);
          await ctx.publish("channel.account.errored", {
            channel_account_id: target.id,
            kind: "oauth_outlook",
            error: message,
          });
          await ctx.step(`project_subscription_error:${target.id}`, () =>
            recordSubscriptionError(deps.pool, target, message),
          );
          continue;
        }

        await ctx.publish("email.outlook.subscription.updated", {
          channel_account_id: target.id,
          subscription_id: subscription.id,
          operation,
          expires_at: subscription.expirationDateTime,
        });
        await ctx.step(`project_subscription:${target.id}`, () =>
          persistOutlookSubscription(
            deps.pool,
            target.workspace_id,
            target.id,
            subscription,
          ),
        );
        if (needsMigration) summary.subscriptions_migrated += 1;
        else if (operation === "created") summary.subscriptions_created += 1;
        else summary.subscriptions_renewed += 1;
      }

      return summary;
    },
  });
}

async function listSubscriptionTargets(
  pool: Pool,
  input: OutlookSubscriptionRepairInput,
  renewBeforeMs: number,
): Promise<OutlookAccountTarget[]> {
  const limit = Math.max(1, Math.min(1_000, Math.trunc(input.limit ?? 500)));
  const { rows } = await pool.query<OutlookAccountTarget>(
    `select id, workspace_id
       from channel_accounts
      where workspace_id = $1
        and kind = 'oauth_outlook'
        and status = 'connected'
        and ($2::uuid is null or id = $2)
        and (
          $2::uuid is not null
          or properties -> 'outlook_subscription' is null
          or (properties -> 'outlook_subscription' ->> 'expirationDateTime')::timestamptz
               <= now() + ($3::text || ' milliseconds')::interval
        )
      order by created_at asc
      limit $4`,
    [input.workspace_id, input.channel_account_id ?? null, renewBeforeMs, limit],
  );
  return rows;
}

async function recordSubscriptionError(
  pool: Pool,
  target: OutlookAccountTarget,
  message: string,
): Promise<void> {
  await pool.query(
    `update channel_accounts
        set last_error = $3::jsonb
      where workspace_id = $1 and id = $2`,
    [target.workspace_id, target.id, JSON.stringify({ message })],
  );
}

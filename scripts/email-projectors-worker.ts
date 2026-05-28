import { createDeepSeekClientFromEnv } from "../core/agents/llm/index.ts";
import {
  createDeepSeekIntentClassifier,
  registerEmailIngressProjectors,
} from "../core/channels/email/index.ts";
import { createJournaledNatsEventBus } from "../core/substrate/events/index.ts";
import { getPool } from "../core/substrate/storage/index.ts";
import {
  createRestateWorkflowRuntime,
  restateBearerFromEnv,
} from "../core/substrate/workflows/index.ts";

const natsUrl = process.env.NATS_URL?.trim();
if (!natsUrl) {
  throw new Error("NATS_URL is required to run email ingress projectors");
}

const natsCreds = process.env.NATS_CREDS?.trim();
const pool = getPool();
const bus = await createJournaledNatsEventBus({
  pool,
  servers: natsUrl,
  ...(natsCreds ? { credentials: natsCreds } : {}),
});
const restateIngressUrl = process.env.RESTATE_INGRESS_URL?.trim();
if (!restateIngressUrl) {
  throw new Error("RESTATE_INGRESS_URL is required to run email ingress projectors");
}
const workflows = createRestateWorkflowRuntime({
  ingressUrl: restateIngressUrl,
  bearer: restateBearerFromEnv(),
});
const classifier = createDeepSeekIntentClassifier({
  llm: createDeepSeekClientFromEnv(),
});

const subscriptions = await registerEmailIngressProjectors(
  {
    pool,
    bus,
    classifier,
    outlookSubscriptionRepair: {
      async start({ workspace_id, channel_account_id }) {
        await workflows.start({
          workspace_id,
          workflow_name: "email_outlook_subscription_repair",
          idempotency_key: `outlook-subscription-bootstrap:${channel_account_id}`,
          input: { workspace_id, channel_account_id },
        });
      },
    },
  },
  {
    subscribe(eventType, handler, durableName) {
      return bus.subscribeScoped("*", eventType, handler, { durableName });
    },
  },
);

async function redrivePendingDispatches(): Promise<void> {
  const result = await bus.redrivePending();
  if (result.attempted > 0) {
    console.log(
      `[email-projectors] NATS dispatch redrive: ${result.delivered} delivered, ${result.failed} failed`,
    );
  }
}

await redrivePendingDispatches();
const relayTimer = setInterval(() => {
  void redrivePendingDispatches().catch((err) => {
    console.error("[email-projectors] NATS dispatch redrive failed:", err);
  });
}, 5_000);
relayTimer.unref();

console.log("[email-projectors] consuming provider ingress and relaying pending NATS dispatches");

async function shutdown(): Promise<void> {
  clearInterval(relayTimer);
  await Promise.all(subscriptions.map((subscription) => subscription.unsubscribe()));
  await bus.close();
  await pool.end();
}

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

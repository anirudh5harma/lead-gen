import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createResendDomainTransport } from "../core/channels/email/index.ts";
import {
  createSendingDomainProvisioningWorkflow,
  createSendingDomainWarmupWorkflow,
  normalizeResendDomainWebhook,
  observeDmarcRecord,
  publishResendDomainWebhook,
  SENDING_DOMAIN_PROVISIONING_WORKFLOW,
  SENDING_DOMAIN_WARMUP_WORKFLOW,
  warmupCapacityForDay,
} from "../core/product/domain-provisioning.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";
import { createInProcessWorkflowRuntime } from "../core/substrate/workflows/index.ts";

async function until<T>(
  predicate: () => T | Promise<T> | undefined | null | false,
): Promise<T> {
  const deadline = Date.now() + 2000;
  while (true) {
    const value = await predicate();
    if (value) return value as T;
    if (Date.now() > deadline) throw new Error("until: timeout");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("sending domain: Resend adapter provisions with sending-only TLS enforcement", async () => {
  const requests: Array<{ path: string; method: string; body: unknown }> = [];
  const transport = createResendDomainTransport({
    apiKey: "test-key",
    baseUrl: "https://resend.test",
    fetchImpl: (async (url, init) => {
      const path = new URL(String(url)).pathname;
      const method = init?.method ?? "GET";
      requests.push({
        path,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (path === "/domains" && method === "GET") {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        id: "domain_123",
        name: "go.example.com",
        status: "not_started",
        region: "us-east-1",
        records: [],
      }), { status: 200 });
    }) as typeof fetch,
  });

  const result = await transport.provision("go.example.com");

  assert.equal(result.provider_domain_id, "domain_123");
  assert.deepEqual(requests, [
    { path: "/domains", method: "GET", body: null },
    {
      path: "/domains",
      method: "POST",
      body: {
        name: "go.example.com",
        tls: "enforced",
        capabilities: { sending: "enabled", receiving: "disabled" },
      },
    },
  ]);
});

test("sending domain: Resend verification requests status then retrieves DNS evidence", async () => {
  const requests: string[] = [];
  const transport = createResendDomainTransport({
    apiKey: "test-key",
    baseUrl: "https://resend.test",
    fetchImpl: (async (url, init) => {
      requests.push(`${init?.method ?? "GET"} ${new URL(String(url)).pathname}`);
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ id: "domain_123" }), { status: 200 });
      }
      return new Response(JSON.stringify({
        id: "domain_123",
        name: "go.example.com",
        status: "pending",
        records: [
          {
            record: "SPF",
            name: "send.go.example.com",
            type: "MX",
            value: "feedback-smtp.us-east-1.amazonses.com",
            status: "pending",
          },
        ],
      }), { status: 200 });
    }) as typeof fetch,
  });

  const result = await transport.verify("domain_123");

  assert.equal(result.status, "pending");
  assert.deepEqual(requests, [
    "POST /domains/domain_123/verify",
    "GET /domains/domain_123",
  ]);
});

test("sending domain: domain.updated webhooks publish typed, idempotent status events", async () => {
  const workspace_id = randomUUID();
  const sending_domain_id = randomUUID();
  const channel_account_id = randomUUID();
  const bus = createInMemoryEventBus();
  const pool = {
    query: async () => ({
      rows: [{
        id: sending_domain_id,
        channel_account_id,
        workspace_id,
        domain: "go.example.com",
      }],
    }),
  };
  const payload = {
    type: "domain.updated",
    created_at: "2026-05-26T09:30:00.000Z",
    data: {
      id: "domain_123",
      name: "go.example.com",
      status: "verified",
      records: [{
        record: "DKIM",
        name: "resend._domainkey.go.example.com",
        type: "TXT",
        value: "p=abc",
        status: "verified",
      }],
    },
  };

  assert.equal(normalizeResendDomainWebhook(payload)?.status, "verified");
  const first = await publishResendDomainWebhook(pool as never, bus, payload, {
    providerEventId: "evt_domain_1",
  });
  const duplicate = await publishResendDomainWebhook(pool as never, bus, payload, {
    providerEventId: "evt_domain_1",
  });

  assert.equal(first.event_id, duplicate.event_id);
  assert.equal(bus.published.length, 1);
  assert.equal(bus.published[0].event_type, "channel.domain.status.received");
  assert.equal(bus.published[0].idempotency_key, "webhook:resend:evt_domain_1");
});

test("sending domain: DMARC evidence requires a valid policy TXT record", async () => {
  const observed = await observeDmarcRecord("go.example.com", async (hostname) => {
    assert.equal(hostname, "_dmarc.go.example.com");
    return [["v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com"]];
  });
  assert.deepEqual(observed, {
    dns_name: "_dmarc.go.example.com",
    verified: true,
    policy: "quarantine",
    record: "v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com",
  });

  const absent = await observeDmarcRecord("go.example.com", async () => {
    const err = new Error("no dmarc") as Error & { code?: string };
    err.code = "ENODATA";
    throw err;
  });
  assert.equal(absent.verified, false);
});

test("sending domain: warmup capacity advances on bounded daily steps", () => {
  assert.equal(warmupCapacityForDay(1, 25), 5);
  assert.equal(warmupCapacityForDay(4, 25), 25);
  assert.equal(warmupCapacityForDay(7, 80), 80);
});

test("sending domain: provisioning workflow journals provider and DMARC events", async () => {
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  const workspace_id = randomUUID();
  const sending_domain_id = randomUUID();
  const channel_account_id = randomUUID();
  runtime.register(createSendingDomainProvisioningWorkflow({
    bus,
    transport: {
      provision: async () => ({
        provider_domain_id: "domain_123",
        domain: "go.example.com",
        status: "pending",
        records: [],
      }),
      verify: async () => {
        throw new Error("not used");
      },
      retrieve: async () => {
        throw new Error("not used");
      },
    },
    resolveTxt: async () => [["v=DMARC1; p=none"]],
  }));

  const run = await runtime.start({
    workspace_id,
    workflow_name: SENDING_DOMAIN_PROVISIONING_WORKFLOW,
    input: {
      workspace_id,
      sending_domain_id,
      channel_account_id,
      domain: "go.example.com",
      operation: "provision",
    },
  });
  await until(async () => (await runtime.get(run.id))?.status === "completed");

  const domainEvents = bus.published.filter((event) =>
    event.event_type.startsWith("channel.domain."),
  );
  assert.deepEqual(
    domainEvents.map((event) => event.event_type),
    ["channel.domain.provisioned", "channel.domain.dmarc.observed"],
  );
  assert.equal((domainEvents[1].payload as { verified: boolean }).verified, true);
});

test("sending domain: warmup workflow emits one auditable capacity step", async () => {
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  const workspace_id = randomUUID();
  runtime.register(createSendingDomainWarmupWorkflow({ bus }));
  const run = await runtime.start({
    workspace_id,
    workflow_name: SENDING_DOMAIN_WARMUP_WORKFLOW,
    input: {
      workspace_id,
      sending_domain_id: randomUUID(),
      channel_account_id: randomUUID(),
      domain: "go.example.com",
      next_day: 1,
      target_daily_cap: 25,
    },
  });
  await until(async () => (await runtime.get(run.id))?.status === "completed");
  const advanced = bus.published.find(
    (event) => event.event_type === "channel.domain.warmup.advanced",
  );
  assert.ok(advanced);
  assert.deepEqual(advanced.payload, {
    sending_domain_id: (run.input as { sending_domain_id: string }).sending_domain_id,
    channel_account_id: (run.input as { channel_account_id: string }).channel_account_id,
    domain: "go.example.com",
    warmup_day: 1,
    current_daily_cap: 5,
    target_daily_cap: 25,
    completed: false,
  });
});

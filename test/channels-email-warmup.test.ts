import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg } from "./_pg.ts";
import {
  canSendVia,
  createWarmupSweepWorkflow,
  curveDailyCap,
  DEFAULT_WARMUP_THRESHOLDS,
  getSendingDomain,
  tickWarmup,
} from "../core/channels/email/warmup.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";
import type { RunContext } from "../core/substrate/workflows/index.ts";

async function seedWorkspaceWithDomain(
  pool: Pool,
  initial: Partial<{
    spf: boolean;
    dkim: boolean;
    dmarc: boolean;
    state: string;
    day: number;
    target: number;
    current: number;
    bounce: number;
    complaint: number;
  }> = {},
): Promise<{ workspace_id: string; channel_account_id: string; domain_id: string }> {
  const workspace_id = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [workspace_id, `ws-${workspace_id.slice(0, 8)}`, "ws"],
  );
  const channel_account_id = randomUUID();
  await pool.query(
    `insert into channel_accounts (id, workspace_id, kind, display_name, status)
     values ($1, $2, 'email_domain', 'hello', 'connected')`,
    [channel_account_id, workspace_id],
  );
  const domain_id = randomUUID();
  await pool.query(
    `insert into sending_domains (
        id, workspace_id, channel_account_id, domain,
        spf_verified, dkim_verified, dmarc_verified,
        warmup_state, warmup_day,
        current_daily_cap, target_daily_cap,
        bounce_rate_24h, complaint_rate_24h
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      domain_id,
      workspace_id,
      channel_account_id,
      `send-${domain_id.slice(0, 6)}.example.com`,
      initial.spf ?? true,
      initial.dkim ?? true,
      initial.dmarc ?? true,
      initial.state ?? "warming",
      initial.day ?? 0,
      initial.current ?? 0,
      initial.target ?? 50000,
      initial.bounce ?? 0,
      initial.complaint ?? 0,
    ],
  );
  return { workspace_id, channel_account_id, domain_id };
}

test("warmup: curveDailyCap doubles per day capped at target", () => {
  assert.equal(curveDailyCap(1, 50000), 50);
  assert.equal(curveDailyCap(2, 50000), 100);
  assert.equal(curveDailyCap(5, 50000), 800);
  assert.equal(curveDailyCap(14, 50000), 50000); // doubles past target → clamped
  assert.equal(curveDailyCap(0, 50000), 0);
});

test("warmup: canSendVia blocks unverified, frozen, and over-cap domains", () => {
  const base = {
    id: "x",
    workspace_id: "w",
    domain: "x.com",
    spf_verified: true,
    dkim_verified: true,
    dmarc_verified: true,
    warmup_state: "warming" as const,
    warmup_day: 3,
    current_daily_cap: 200,
    target_daily_cap: 50000,
    bounce_rate_24h: 0,
    complaint_rate_24h: 0,
  };
  assert.equal(canSendVia(base, 10).allowed, true);
  assert.equal(canSendVia(base, 200).reason, "domain_warmup_too_early");
  assert.equal(canSendVia({ ...base, warmup_state: "frozen" }, 0).reason, "domain_frozen");
  assert.equal(canSendVia({ ...base, dkim_verified: false }, 0).reason, "domain_not_ready");
  assert.equal(canSendVia({ ...base, warmup_state: "unverified" }, 0).reason, "domain_not_ready");
});

test("warmup tick: verifying → warming when all DNS verified", async (t) => {
  const fx = await setupPg("wu_verify");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const { workspace_id, domain_id } = await seedWorkspaceWithDomain(fx.pool, {
      state: "verifying",
      day: 0,
      current: 0,
    });
    const after = await tickWarmup(fx.pool, workspace_id, domain_id);
    assert.equal(after?.warmup_state, "warming");
    assert.equal(after?.warmup_day, 1);
    assert.equal(after?.current_daily_cap, 50);
  } finally {
    await fx.close();
  }
});

test("warmup tick: warming day advances + cap doubles", async (t) => {
  const fx = await setupPg("wu_warm");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const { workspace_id, domain_id } = await seedWorkspaceWithDomain(fx.pool, {
      state: "warming",
      day: 3,
      current: 200,
    });
    const after = await tickWarmup(fx.pool, workspace_id, domain_id);
    assert.equal(after?.warmup_state, "warming");
    assert.equal(after?.warmup_day, 4);
    assert.equal(after?.current_daily_cap, 400);
  } finally {
    await fx.close();
  }
});

test("warmup tick: warming → warmed at warmedDay", async (t) => {
  const fx = await setupPg("wu_warmed");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const { workspace_id, domain_id } = await seedWorkspaceWithDomain(fx.pool, {
      state: "warming",
      day: DEFAULT_WARMUP_THRESHOLDS.warmedDay - 1,
      current: 16000,
    });
    const after = await tickWarmup(fx.pool, workspace_id, domain_id);
    assert.equal(after?.warmup_state, "warmed");
    assert.equal(after?.current_daily_cap, 50000);
  } finally {
    await fx.close();
  }
});

test("warmup tick: high bounce rate degrades; very high rate freezes", async (t) => {
  const fx = await setupPg("wu_degrade");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const { workspace_id, domain_id } = await seedWorkspaceWithDomain(fx.pool, {
      state: "warmed",
      day: 30,
      current: 50000,
      bounce: 0.06,
    });
    const degraded = await tickWarmup(fx.pool, workspace_id, domain_id);
    assert.equal(degraded?.warmup_state, "degraded");

    await fx.pool.query(
      `update sending_domains set bounce_rate_24h = 0.15 where id = $1`,
      [domain_id],
    );
    const frozen = await tickWarmup(fx.pool, workspace_id, domain_id);
    assert.equal(frozen?.warmup_state, "frozen");

    // frozen stays frozen even when rates drop.
    await fx.pool.query(
      `update sending_domains set bounce_rate_24h = 0 where id = $1`,
      [domain_id],
    );
    const still = await tickWarmup(fx.pool, workspace_id, domain_id);
    assert.equal(still?.warmup_state, "frozen");

    void getSendingDomain;
  } finally {
    await fx.close();
  }
});

test("warmup tick: degraded recovers to warmed when rates fall", async (t) => {
  const fx = await setupPg("wu_recover");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const { workspace_id, domain_id } = await seedWorkspaceWithDomain(fx.pool, {
      state: "degraded",
      day: 30,
      current: 50000,
      bounce: 0.01,
      complaint: 0,
    });
    const after = await tickWarmup(fx.pool, workspace_id, domain_id);
    assert.equal(after?.warmup_state, "warmed");
  } finally {
    await fx.close();
  }
});

test("warmup workflow: ticks domains inside durable steps and emits a typed update", async (t) => {
  const fx = await setupPg("wu_workflow");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const { workspace_id, domain_id } = await seedWorkspaceWithDomain(fx.pool, {
      state: "warming",
      day: 2,
      current: 100,
    });
    const bus = createInMemoryEventBus();
    const workflow = createWarmupSweepWorkflow({ pool: fx.pool });

  const summary = await workflow.run(
    { workspace_id, domain_id },
    fakeRunContext(workspace_id, bus),
  );

    assert.deepEqual(summary, {
      domains_checked: 1,
      domains_changed: 1,
      warmed: 0,
      degraded: 0,
      frozen: 0,
    });
    const after = await getSendingDomain(fx.pool, workspace_id, domain_id);
    assert.equal(after?.warmup_day, 3);
    assert.equal(after?.current_daily_cap, 200);
    assert.equal(bus.published.length, 1);
    assert.equal(bus.published[0].event_type, "email.domain.warmup.updated");
    assert.deepEqual(bus.published[0].payload, {
      sending_domain_id: domain_id,
      domain: after?.domain,
      previous_state: "warming",
      current_state: "warming",
      previous_daily_cap: 100,
      current_daily_cap: 200,
    });
  } finally {
    await fx.close();
  }
});

function fakeRunContext(
  workspace_id: string,
  bus: ReturnType<typeof createInMemoryEventBus>,
): RunContext {
  return {
    run_id: randomUUID(),
    workspace_id,
    correlation_id: randomUUID(),
    step: async (_name, fn) => fn(),
    sleep: async () => undefined,
    awaitEvent: async () => {
      throw new Error("not used");
    },
    requestApproval: async () => {
      throw new Error("not used");
    },
    publish: async (event_type, payload) => {
      await bus.publish({
        workspace_id,
        event_type,
        source: "system",
        payload,
      });
    },
  };
}

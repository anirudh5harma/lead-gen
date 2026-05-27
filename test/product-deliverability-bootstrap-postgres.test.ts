import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  configureEmailAccount,
  dispatchSendingDomainWarmupsOnce,
  resetProductEngineForTests,
} from "../core/product/app.ts";
import { resetPool, setPool } from "../core/substrate/storage/index.ts";
import { wireSendingDomainProjection } from "../core/product/domain-provisioning.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";
import { setupPg, until } from "./_pg.ts";

test("product deliverability: production setup never seeds a trusted dry-run domain", async (t) => {
  const fx = await setupPg("product_prod_email_bootstrap");
  if (!fx) return t.skip("DATABASE_URL not set");

  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  setPool(fx.pool);
  try {
    const boot = await configureEmailAccount({
      display_name: "maya@go.example.com",
      daily_cap: 25,
    });

    const account = await fx.pool.query<{
      status: string;
      properties: { transport?: string };
    }>(
      `select status, properties from channel_accounts where id = $1`,
      [boot.channel_account_id],
    );
    assert.equal(account.rows[0].status, "disconnected");
    assert.equal(account.rows[0].properties.transport, "unconfigured");

    const domain = await fx.pool.query<{
      id: string;
      spf_verified: boolean;
      dkim_verified: boolean;
      dmarc_verified: boolean;
      warmup_state: string;
      current_daily_cap: number;
    }>(
      `select id, spf_verified, dkim_verified, dmarc_verified, warmup_state, current_daily_cap
         from sending_domains
        where channel_account_id = $1`,
      [boot.channel_account_id],
    );
    assert.equal(domain.rows[0].spf_verified, false);
    assert.equal(domain.rows[0].dkim_verified, false);
    assert.equal(domain.rows[0].dmarc_verified, false);
    assert.equal(domain.rows[0].warmup_state, "unverified");
    assert.equal(domain.rows[0].current_daily_cap, 0);

    const bus = createInMemoryEventBus();
    await wireSendingDomainProjection({ pool: fx.pool, bus });
    await bus.publish({
      workspace_id: boot.workspace_id,
      event_type: "channel.domain.status.received",
      source: "webhook",
      idempotency_key: `webhook:resend:${randomUUID()}`,
      payload: {
        sending_domain_id: domain.rows[0].id,
        channel_account_id: boot.channel_account_id,
        domain: "go.example.com",
        provider: "resend",
        provider_domain_id: "domain_123",
        provider_status: "verified",
        records: [
          {
            record: "SPF",
            name: "send.go.example.com",
            type: "MX",
            value: "feedback-smtp.us-east-1.amazonses.com",
            status: "verified",
          },
          {
            record: "DKIM",
            name: "resend._domainkey.go.example.com",
            type: "TXT",
            value: "p=abc",
            status: "verified",
          },
        ],
        region: "us-east-1",
      },
    });
    const verified = await until(async () => {
      const result = await fx.pool.query<{
        spf_verified: boolean;
        dkim_verified: boolean;
        dmarc_verified: boolean;
        warmup_state: string;
        current_daily_cap: number;
      }>(
        `select spf_verified, dkim_verified, dmarc_verified, warmup_state, current_daily_cap
           from sending_domains
          where id = $1`,
        [domain.rows[0].id],
      );
      return result.rows[0].spf_verified ? result.rows[0] : null;
    });
    assert.equal(verified.spf_verified, true);
    assert.equal(verified.dkim_verified, true);
    assert.equal(verified.dmarc_verified, false);
    assert.equal(verified.warmup_state, "unverified");
    assert.equal(verified.current_daily_cap, 0);

    await bus.publish({
      workspace_id: boot.workspace_id,
      event_type: "channel.domain.dmarc.observed",
      source: "system",
      payload: {
        sending_domain_id: domain.rows[0].id,
        channel_account_id: boot.channel_account_id,
        domain: "go.example.com",
        dns_name: "_dmarc.go.example.com",
        verified: true,
        policy: "quarantine",
        record: "v=DMARC1; p=quarantine",
      },
    });
    const warming = await until(async () => {
      const result = await fx.pool.query<{
        dmarc_verified: boolean;
        warmup_state: string;
      }>(
        `select dmarc_verified, warmup_state
           from sending_domains
          where id = $1`,
        [domain.rows[0].id],
      );
      return result.rows[0].warmup_state === "warming" ? result.rows[0] : null;
    });
    assert.equal(warming.dmarc_verified, true);

    assert.equal(await dispatchSendingDomainWarmupsOnce(), 1);
    const advanced = await until(async () => {
      const result = await fx.pool.query<{
        warmup_day: number;
        current_daily_cap: number;
        warmup_state: string;
      }>(
        `select warmup_day, current_daily_cap, warmup_state
           from sending_domains
          where id = $1`,
        [domain.rows[0].id],
      );
      return result.rows[0].current_daily_cap === 5 ? result.rows[0] : null;
    });
    assert.equal(advanced.warmup_day, 1);
    assert.equal(advanced.warmup_state, "warming");
  } finally {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});

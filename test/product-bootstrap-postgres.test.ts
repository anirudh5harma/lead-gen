import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  bootstrapWorkspace,
  configureRep,
  configureWorkspaceCompanyProfile,
  configureWorkspaceEmailAccount,
  getProductCompanyProfile,
  getOrCreateProductWorkspaceForUser,
  getWorkspaceActivationState,
  resetProductEngineForTests,
} from "../core/product/app.ts";
import { resetPool, setPool } from "../core/substrate/storage/index.ts";
import { findCompletedOnboardingForUser } from "../lib/auth/onboarding.ts";
import { setupPg } from "./_pg.ts";

test("product bootstrap emits typed events for seeded primitives", async (t) => {
  const fx = await setupPg("product_bootstrap_events");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const userId = randomUUID();
    const boot = await bootstrapWorkspace(fx.pool, userId, {
      workspace_slug: "evented-bootstrap",
      workspace_name: "Evented Bootstrap",
    });

    const events = await fx.pool.query<{ event_type: string; count: string }>(
      `select event_type, count(*)::text as count
         from events
        where workspace_id = $1
          and event_type in (
            'workspace.created',
            'rep.configured',
            'play.configured',
            'channel.account.configured',
            'rep.memory.procedural.seeded'
          )
        group by event_type`,
      [boot.workspace_id],
    );
    const counts = new Map(events.rows.map((row) => [row.event_type, row.count]));
    assert.equal(counts.get("workspace.created"), "1");
    assert.equal(counts.get("rep.configured"), "1");
    assert.equal(counts.get("play.configured"), "1");
    assert.equal(counts.get("channel.account.configured"), "1");
    assert.equal(counts.get("rep.memory.procedural.seeded"), "1");

    const membership = await fx.pool.query<{ role: string; accepted: boolean }>(
      `select role::text as role, accepted_at is not null as accepted
         from workspace_members
        where workspace_id = $1 and user_id = $2`,
      [boot.workspace_id, userId],
    );
    assert.deepEqual(membership.rows[0], { role: "owner", accepted: true });

    const account = await fx.pool.query<{ id: string; status: string }>(
      `select id, status::text as status
         from channel_accounts
        where workspace_id = $1 and kind = 'email_domain'`,
      [boot.workspace_id],
    );
    assert.equal(account.rows[0].id, boot.channel_account_id);
    assert.equal(account.rows[0].status, "connected");

    const reps = await fx.pool.query<{ name: string; role: string }>(
      `select name, role::text as role
         from reps
        where workspace_id = $1
        order by name asc`,
      [boot.workspace_id],
    );
    assert.deepEqual(reps.rows, [
      { name: "Outbound agent", role: "sdr" },
    ]);

    const memory = await fx.pool.query<{ pattern_key: string; score: string }>(
      `select pattern_key, score::text as score
         from rep_memory_procedural
        where workspace_id = $1 and rep_id = $2`,
      [boot.workspace_id, boot.rep_id],
    );
    assert.deepEqual(memory.rows[0], {
      pattern_key: "icp:fintech-founder|signal:funding|stage:cold_open",
      score: "0.5500",
    });

    await bootstrapWorkspace(fx.pool, userId, {
      workspace_slug: "evented-bootstrap",
      workspace_name: "Evented Bootstrap",
    });
    const afterRepeat = await fx.pool.query<{ event_type: string; count: string }>(
      `select event_type, count(*)::text as count
         from events
        where workspace_id = $1
          and event_type in (
            'workspace.created',
            'rep.configured',
            'play.configured',
            'channel.account.configured',
            'rep.memory.procedural.seeded'
          )
        group by event_type`,
      [boot.workspace_id],
    );
    const repeatCounts = new Map(
      afterRepeat.rows.map((row) => [row.event_type, row.count]),
    );
    assert.equal(repeatCounts.get("workspace.created"), "1");
    assert.equal(repeatCounts.get("rep.configured"), "1");
    assert.equal(repeatCounts.get("play.configured"), "1");
    assert.equal(repeatCounts.get("channel.account.configured"), "1");
    assert.equal(repeatCounts.get("rep.memory.procedural.seeded"), "1");

    const repairedUserId = randomUUID();
    await bootstrapWorkspace(fx.pool, repairedUserId, {
      workspace_id: boot.workspace_id,
      ensureMembership: true,
    });
    await bootstrapWorkspace(fx.pool, repairedUserId, {
      workspace_id: boot.workspace_id,
      ensureMembership: true,
    });
    const repairedMembership = await fx.pool.query<{
      role: string;
      accepted: boolean;
      accepted_events: string;
    }>(
      `select role::text as role,
              accepted_at is not null as accepted,
              (select count(*)::text
                 from events
                where workspace_id = $1
                  and event_type = 'workspace.member.accepted'
                  and payload->>'user_id' = $2) as accepted_events
         from workspace_members
        where workspace_id = $1 and user_id = $2`,
      [boot.workspace_id, repairedUserId],
    );
    assert.deepEqual(repairedMembership.rows[0], {
      role: "owner",
      accepted: true,
      accepted_events: "1",
    });

    await fx.pool.query(`delete from sending_domains where channel_account_id = $1`, [
      boot.channel_account_id,
    ]);
    await bootstrapWorkspace(fx.pool, userId, {
      workspace_slug: "evented-bootstrap",
      workspace_name: "Evented Bootstrap",
    });
    const catchup = await fx.pool.query<{
      domain_count: string;
      account_configured_events: string;
    }>(
      `select (select count(*)::text
                 from sending_domains
                where workspace_id = $1
                  and channel_account_id = $2) as domain_count,
              (select count(*)::text
                 from events
                where workspace_id = $1
                  and event_type = 'channel.account.configured'
                  and source = 'system') as account_configured_events`,
      [boot.workspace_id, boot.channel_account_id],
    );
    assert.equal(catchup.rows[0].domain_count, "1");
    assert.equal(catchup.rows[0].account_configured_events, "2");
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});

test("product configuration events append changed user state but dedupe exact retries", async (t) => {
  const fx = await setupPg("product_configuration_event_updates");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const userId = randomUUID();
    const boot = await bootstrapWorkspace(fx.pool, userId, {
      workspace_slug: "configuration-events",
      workspace_name: "Configuration Events",
    });
    const session = { workspace_id: boot.workspace_id, user_id: userId };

    await configureRep(
      {
        name: "Outbound agent",
        voice: "Crisp founder-to-founder.",
        daily_cap: 12,
        approval: "approve_first",
      },
      session,
    );
    await configureRep(
      {
        name: "Outbound agent",
        voice: "Warmer but still concise.",
        daily_cap: 12,
        approval: "approve_first",
      },
      session,
    );
    await configureRep(
      {
        name: "Outbound agent",
        voice: "Warmer but still concise.",
        daily_cap: 12,
        approval: "approve_first",
      },
      session,
    );

    const rep = await fx.pool.query<{ voice: string; user_events: string }>(
      `select persona->>'voice' as voice,
              (select count(*)::text
                 from events
                where workspace_id = $1
                  and event_type = 'rep.configured'
                  and source = 'user') as user_events
         from reps
        where workspace_id = $1 and id = $2`,
      [boot.workspace_id, boot.rep_id],
    );
    assert.equal(rep.rows[0].voice, "Warmer but still concise.");
    assert.equal(rep.rows[0].user_events, "2");

    await configureWorkspaceEmailAccount(
      { display_name: "outbound@go.bombsell.example", daily_cap: 10 },
      session,
    );
    await configureWorkspaceEmailAccount(
      { display_name: "outbound@try.bombsell.example", daily_cap: 10 },
      session,
    );
    await configureWorkspaceEmailAccount(
      { display_name: "outbound@try.bombsell.example", daily_cap: 10 },
      session,
    );

    const account = await fx.pool.query<{
      display_name: string;
      user_events: string;
    }>(
      `select display_name,
              (select count(*)::text
                 from events
                where workspace_id = $1
                  and event_type = 'channel.account.configured'
                  and source = 'user') as user_events
         from channel_accounts
        where workspace_id = $1 and id = $2`,
      [boot.workspace_id, boot.channel_account_id],
    );
    assert.equal(account.rows[0].display_name, "outbound@try.bombsell.example");
    assert.equal(account.rows[0].user_events, "2");
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});

test("workspace company profile edits replace scraped defaults", async (t) => {
  const fx = await setupPg("product_profile_edit");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const userId = randomUUID();
    const boot = await bootstrapWorkspace(fx.pool, userId, {
      workspace_slug: "profile-edit",
      workspace_name: "Profile Edit",
    });
    const session = { workspace_id: boot.workspace_id, user_id: userId };

    const created = await configureWorkspaceCompanyProfile(
      {
        company_name: "Acme AI",
        website_url: "https://acme.ai",
        industry: "AI",
        description: "Scraped profile from the public website.",
        profile_source: "firecrawl",
      },
      session,
    );
    await configureWorkspaceCompanyProfile(
      {
        company_name: "Acme Revenue",
        website_url: "https://acme.ai",
        industry: null,
        description: "User-written profile for founder-led GTM.",
        profile_source: "manual",
      },
      session,
    );

    const profile = await getProductCompanyProfile(fx.pool, session);
    assert.equal(profile?.company_id, created.company_id);
    assert.equal(profile?.company_name, "Acme Revenue");
    assert.equal(profile?.industry, null);
    assert.equal(profile?.description, "User-written profile for founder-led GTM.");
    assert.deepEqual(
      await getWorkspaceActivationState(fx.pool, boot.workspace_id),
      {
        website_set: true,
        description_set: true,
        product_ready: true,
      },
    );

    const row = await fx.pool.query<{
      properties: Record<string, unknown>;
      provenance: Record<string, unknown>;
    }>(
      `select properties, provenance
         from graph_companies
        where workspace_id = $1
          and id = $2`,
      [boot.workspace_id, created.company_id],
    );
    assert.equal(row.rows[0]?.properties.profile_source, "manual");
    assert.equal(row.rows[0]?.provenance.source, "manual");

    await fx.pool.query(
      `update graph_companies
          set properties = properties || $3::jsonb
        where workspace_id = $1
          and id = $2`,
      [
        boot.workspace_id,
        created.company_id,
        JSON.stringify({
          exa_profile: {
            summary: "Legacy Exa-generated positioning that should not survive a manual save.",
            enriched_at: "2026-01-01T00:00:00.000Z",
            result_count: 4,
          },
        }),
      ],
    );

    await configureWorkspaceCompanyProfile(
      {
        company_name: "Acme Revenue",
        website_url: "https://acme.ai",
        industry: null,
        description: "Clean manual profile.",
        profile_source: "manual",
      },
      session,
    );

    const cleaned = await fx.pool.query<{ properties: Record<string, unknown> }>(
      `select properties
         from graph_companies
        where workspace_id = $1
          and id = $2`,
      [boot.workspace_id, created.company_id],
    );
    assert.equal(cleaned.rows[0]?.properties.exa_profile, undefined);

    await configureWorkspaceCompanyProfile(
      {
        company_name: "Acme Revenue",
        website_url: "https://acme.ai",
        industry: null,
        description: null,
        profile_source: "manual",
      },
      session,
    );
    const cleared = await getProductCompanyProfile(fx.pool, session);
    assert.equal(cleared?.description, null);
    assert.deepEqual(
      await getWorkspaceActivationState(fx.pool, boot.workspace_id),
      {
        website_set: true,
        description_set: false,
        product_ready: false,
      },
    );
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});

test("website-pending onboarding completes without creating a company profile", async (t) => {
  const fx = await setupPg("product_onboarding_pending");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const userId = randomUUID();
    const workspace = await getOrCreateProductWorkspaceForUser(
      { name: "Website Pending GTM" },
      userId,
      fx.pool,
    );

    const completed = await findCompletedOnboardingForUser(userId, fx.pool);
    assert.deepEqual(completed, {
      workspace_id: workspace.id,
      completion_source: "accepted_workspace",
    });
    assert.deepEqual(
      await getWorkspaceActivationState(fx.pool, workspace.id),
      {
        website_set: false,
        description_set: false,
        product_ready: false,
      },
    );

    const profiles = await fx.pool.query<{ count: string }>(
      `select count(*)::text as count
         from graph_companies
        where workspace_id = $1
          and properties->>'profile_role' = 'workspace_company'`,
      [workspace.id],
    );
    assert.equal(profiles.rows[0]?.count, "0");
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});

test("website-pending onboarding deduplicates concurrent workspace creation for one user", async (t) => {
  const fx = await setupPg("product_onboarding_dedup");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const userId = randomUUID();
    const [first, second] = await Promise.all([
      getOrCreateProductWorkspaceForUser(
        { name: "Concurrent GTM" },
        userId,
        fx.pool,
      ),
      getOrCreateProductWorkspaceForUser(
        { name: "Concurrent GTM" },
        userId,
        fx.pool,
      ),
    ]);
    assert.equal(first.id, second.id);

    const memberships = await fx.pool.query<{ count: string }>(
      `select count(*)::text as count
         from workspace_members
        where user_id = $1
          and accepted_at is not null`,
      [userId],
    );
    assert.equal(memberships.rows[0]?.count, "1");

    const events = await fx.pool.query<{ count: string }>(
      `select count(*)::text as count
         from events
        where workspace_id = $1
          and event_type = 'workspace.created'`,
      [first.id],
    );
    assert.equal(events.rows[0]?.count, "1");
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});

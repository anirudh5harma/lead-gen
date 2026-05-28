import { z } from "zod";
import { resolveTxt as resolveDnsTxt } from "node:dns/promises";
import type { Pool } from "pg";
import {
  createResendDomainTransport,
  type EmailDomainDnsRecord,
  type EmailDomainSnapshot,
  type EmailDomainTransport,
} from "../channels/email/index.ts";
import type {
  DurableEventProjection,
  EventBus,
  PublishedEvent,
} from "../substrate/events/index.ts";
import { defineWorkflow } from "../substrate/workflows/index.ts";

export const SENDING_DOMAIN_PROVISIONING_WORKFLOW = "channel.email_domain_provision.v1";
export const SENDING_DOMAIN_WARMUP_WORKFLOW = "channel.email_domain_warmup.v1";
export const SENDING_DOMAIN_PROJECTION = "channel.sending_domain.v1";

const ResendDomainWebhook = z.object({
  type: z.enum(["domain.created", "domain.updated"]),
  created_at: z.string().datetime().optional(),
  data: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    status: z.string(),
    records: z
      .array(
        z.object({
          record: z.string(),
          name: z.string(),
          type: z.string(),
          value: z.string(),
          status: z.string().nullable().optional(),
          priority: z.number().int().nullable().optional(),
          ttl: z.string().nullable().optional(),
        }),
      )
      .default([]),
    region: z.string().nullable().optional(),
  }),
});

const DomainSnapshotPayload = z.object({
  sending_domain_id: z.string().uuid(),
  channel_account_id: z.string().uuid(),
  domain: z.string(),
  provider: z.literal("resend"),
  provider_domain_id: z.string(),
  provider_status: z.string(),
  records: z.array(z.object({
    record: z.string(),
    name: z.string(),
    type: z.string(),
    value: z.string(),
    status: z.string().nullable().optional(),
    priority: z.number().int().nullable().optional(),
    ttl: z.string().nullable().optional(),
  })),
  region: z.string().nullable().optional(),
});

const DomainVerificationRequestedPayload = z.object({
  sending_domain_id: z.string().uuid(),
  channel_account_id: z.string().uuid(),
  domain: z.string(),
  provider: z.literal("resend"),
  provider_domain_id: z.string(),
});

const DomainDmarcObservedPayload = z.object({
  sending_domain_id: z.string().uuid(),
  channel_account_id: z.string().uuid(),
  domain: z.string(),
  dns_name: z.string(),
  verified: z.boolean(),
  policy: z.enum(["none", "quarantine", "reject"]).nullable(),
  record: z.string().nullable(),
});

const DomainTrustVerifiedPayload = z.object({
  sending_domain_id: z.string().uuid(),
  channel_account_id: z.string().uuid(),
  domain: z.string(),
});

const DomainWarmupAdvancedPayload = z.object({
  sending_domain_id: z.string().uuid(),
  channel_account_id: z.string().uuid(),
  domain: z.string(),
  warmup_day: z.number().int().positive(),
  current_daily_cap: z.number().int().nonnegative(),
  target_daily_cap: z.number().int().nonnegative(),
  completed: z.boolean(),
});

export type SendingDomainOperation = "provision" | "verify" | "refresh";

export interface SendingDomainWorkflowInput {
  workspace_id: string;
  sending_domain_id: string;
  channel_account_id: string;
  domain: string;
  operation: SendingDomainOperation;
  provider_domain_id?: string | null;
}

export interface SendingDomainWorkflowOutput {
  sending_domain_id: string;
  provider_domain_id: string;
  provider_status: string;
}

export interface SendingDomainWarmupInput {
  workspace_id: string;
  sending_domain_id: string;
  channel_account_id: string;
  domain: string;
  next_day: number;
  target_daily_cap: number;
}

export interface SendingDomainWarmupOutput {
  sending_domain_id: string;
  warmup_day: number;
  current_daily_cap: number;
  completed: boolean;
}

export interface DmarcObservation {
  dns_name: string;
  verified: boolean;
  policy: "none" | "quarantine" | "reject" | null;
  record: string | null;
}

export type DnsTxtResolver = (hostname: string) => Promise<string[][]>;

export interface SendingDomainProjection {
  unsubscribe(): Promise<void>;
}

export interface PublishResendDomainWebhookResult {
  status: "published" | "ignored";
  sending_domain_id?: string;
  event_id?: string;
  reason?: string;
}

export async function observeDmarcRecord(
  domain: string,
  resolveTxt: DnsTxtResolver = resolveDnsTxt,
): Promise<DmarcObservation> {
  const dns_name = `_dmarc.${domain}`;
  let records: string[][];
  try {
    records = await resolveTxt(dns_name);
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === "ENODATA" || code === "ENOTFOUND") {
      return { dns_name, verified: false, policy: null, record: null };
    }
    throw err;
  }
  const record = records.map((parts) => parts.join("")).find((candidate) =>
    /^v=DMARC1(?:;|$)/i.test(candidate.trim()),
  ) ?? null;
  const policy = record?.match(/(?:^|;)\s*p=(none|quarantine|reject)(?:;|$)/i)?.[1]
    ?.toLowerCase() as DmarcObservation["policy"] | undefined;
  return {
    dns_name,
    verified: Boolean(record && policy),
    policy: policy ?? null,
    record,
  };
}

function snapshotPayload(
  input: SendingDomainWorkflowInput,
  snapshot: EmailDomainSnapshot,
) {
  return {
    sending_domain_id: input.sending_domain_id,
    channel_account_id: input.channel_account_id,
    domain: input.domain,
    provider: "resend" as const,
    provider_domain_id: snapshot.provider_domain_id,
    provider_status: snapshot.status,
    records: snapshot.records,
    region: snapshot.region ?? null,
  };
}

function domainCredentialsTransport(): EmailDomainTransport {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is required to provision or verify an owned sending domain.");
  }
  return createResendDomainTransport({ apiKey });
}

export function createSendingDomainProvisioningWorkflow(
  opts: {
    bus: EventBus;
    transport?: EmailDomainTransport;
    resolveTxt?: DnsTxtResolver;
  },
) {
  const transport = opts.transport ?? domainCredentialsTransport();
  return defineWorkflow<SendingDomainWorkflowInput, SendingDomainWorkflowOutput>({
    name: SENDING_DOMAIN_PROVISIONING_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      let snapshot: EmailDomainSnapshot;
      if (input.operation === "provision") {
        snapshot = await ctx.step("provider.domain.provision", () =>
          transport.provision(input.domain),
        );
        await ctx.step("event.domain.provisioned", async () =>
          opts.bus.publish({
            workspace_id: input.workspace_id,
            event_type: "channel.domain.provisioned",
            source: "system",
            producer_ref: `workflow:${SENDING_DOMAIN_PROVISIONING_WORKFLOW}:${ctx.run_id}`,
            correlation_id: ctx.correlation_id,
            idempotency_key: `workflow:${ctx.run_id}:provisioned`,
            payload: snapshotPayload(input, snapshot),
          }),
        );
      } else {
        if (!input.provider_domain_id) {
          throw new Error(`Domain ${input.domain} has not been provisioned with Resend.`);
        }
        const providerDomainId = input.provider_domain_id;
        if (input.operation === "verify") {
          await ctx.step("event.domain.verification_requested", async () =>
            opts.bus.publish({
              workspace_id: input.workspace_id,
              event_type: "channel.domain.verification.requested",
              source: "user",
              producer_ref: `workflow:${SENDING_DOMAIN_PROVISIONING_WORKFLOW}:${ctx.run_id}`,
              correlation_id: ctx.correlation_id,
              idempotency_key: `workflow:${ctx.run_id}:verification-requested`,
              payload: {
                sending_domain_id: input.sending_domain_id,
                channel_account_id: input.channel_account_id,
                domain: input.domain,
                provider: "resend",
                provider_domain_id: providerDomainId,
              },
            }),
          );
          snapshot = await ctx.step("provider.domain.verify", () =>
            transport.verify(providerDomainId),
          );
        } else {
          snapshot = await ctx.step("provider.domain.retrieve", () =>
            transport.retrieve(providerDomainId),
          );
        }
        await ctx.step("event.domain.status_received", async () =>
          opts.bus.publish({
            workspace_id: input.workspace_id,
            event_type: "channel.domain.status.received",
            source: "system",
            producer_ref: `workflow:${SENDING_DOMAIN_PROVISIONING_WORKFLOW}:${ctx.run_id}`,
            correlation_id: ctx.correlation_id,
            idempotency_key: `workflow:${ctx.run_id}:status-received`,
            payload: snapshotPayload(input, snapshot),
          }),
        );
      }
      const dmarc = await ctx.step("dns.dmarc.observe", () =>
        observeDmarcRecord(input.domain, opts.resolveTxt),
      );
      await ctx.step("event.domain.dmarc_observed", async () =>
        opts.bus.publish({
          workspace_id: input.workspace_id,
          event_type: "channel.domain.dmarc.observed",
          source: "system",
          producer_ref: `workflow:${SENDING_DOMAIN_PROVISIONING_WORKFLOW}:${ctx.run_id}`,
          correlation_id: ctx.correlation_id,
          idempotency_key: `workflow:${ctx.run_id}:dmarc-observed`,
          payload: {
            sending_domain_id: input.sending_domain_id,
            channel_account_id: input.channel_account_id,
            domain: input.domain,
            ...dmarc,
          },
        }),
      );
      return {
        sending_domain_id: input.sending_domain_id,
        provider_domain_id: snapshot.provider_domain_id,
        provider_status: snapshot.status,
      };
    },
  });
}

const WARMUP_CAPACITY_CURVE = [5, 10, 15, 25, 40, 60, 100] as const;

export function warmupCapacityForDay(day: number, target: number): number {
  const index = Math.max(0, Math.min(Math.trunc(day) - 1, WARMUP_CAPACITY_CURVE.length - 1));
  return Math.min(Math.max(0, Math.trunc(target)), WARMUP_CAPACITY_CURVE[index]);
}

export function createSendingDomainWarmupWorkflow(opts: { bus: EventBus }) {
  return defineWorkflow<SendingDomainWarmupInput, SendingDomainWarmupOutput>({
    name: SENDING_DOMAIN_WARMUP_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      const current_daily_cap = warmupCapacityForDay(input.next_day, input.target_daily_cap);
      const completed = current_daily_cap >= input.target_daily_cap;
      await ctx.step("event.domain.warmup_advanced", async () =>
        opts.bus.publish({
          workspace_id: input.workspace_id,
          event_type: "channel.domain.warmup.advanced",
          source: "system",
          producer_ref: `workflow:${SENDING_DOMAIN_WARMUP_WORKFLOW}:${ctx.run_id}`,
          correlation_id: ctx.correlation_id,
          idempotency_key: `workflow:${ctx.run_id}:warmup-advanced`,
          payload: {
            sending_domain_id: input.sending_domain_id,
            channel_account_id: input.channel_account_id,
            domain: input.domain,
            warmup_day: input.next_day,
            current_daily_cap,
            target_daily_cap: input.target_daily_cap,
            completed,
          },
        }),
      );
      return {
        sending_domain_id: input.sending_domain_id,
        warmup_day: input.next_day,
        current_daily_cap,
        completed,
      };
    },
  });
}

export function normalizeResendDomainWebhook(payload: unknown): EmailDomainSnapshot | null {
  const parsed = ResendDomainWebhook.safeParse(payload);
  if (!parsed.success) return null;
  return {
    provider_domain_id: parsed.data.data.id,
    domain: parsed.data.data.name,
    status: parsed.data.data.status,
    records: parsed.data.data.records,
    region: parsed.data.data.region ?? null,
  };
}

export async function publishResendDomainWebhook(
  pool: Pool,
  bus: EventBus,
  payload: unknown,
  opts: { providerEventId?: string | null } = {},
): Promise<PublishResendDomainWebhookResult> {
  const snapshot = normalizeResendDomainWebhook(payload);
  if (!snapshot) return { status: "ignored", reason: "unsupported_event_type" };

  const { rows } = await pool.query<{
    id: string;
    channel_account_id: string;
    workspace_id: string;
    domain: string;
  }>(
    `select id, channel_account_id, workspace_id, domain::text as domain
       from sending_domains
      where properties->>'provider' = 'resend'
        and properties->>'provider_domain_id' = $1
      limit 1`,
    [snapshot.provider_domain_id],
  );
  const domain = rows[0];
  if (!domain) return { status: "ignored", reason: "sending_domain_not_found" };
  const event = await bus.publish({
    workspace_id: domain.workspace_id,
    event_type: "channel.domain.status.received",
    source: "webhook",
    producer_ref: "webhook:resend",
    idempotency_key: opts.providerEventId
      ? `webhook:resend:${opts.providerEventId}`
      : undefined,
    payload: {
      sending_domain_id: domain.id,
      channel_account_id: domain.channel_account_id,
      domain: domain.domain,
      provider: "resend",
      provider_domain_id: snapshot.provider_domain_id,
      provider_status: snapshot.status,
      records: snapshot.records,
      region: snapshot.region ?? null,
    },
  });
  return { status: "published", sending_domain_id: domain.id, event_id: event.id };
}

function recordVerified(
  records: EmailDomainDnsRecord[],
  type: string,
): boolean {
  const relevant = records.filter((record) => record.record.toUpperCase() === type);
  return relevant.length > 0 && relevant.every(
    (record) => record.status?.toLowerCase() === "verified",
  );
}

async function applyDomainSnapshot(pool: Pool, event: PublishedEvent): Promise<void> {
  const payload = DomainSnapshotPayload.parse(event.payload);
  const spfVerified = recordVerified(payload.records, "SPF");
  const dkimVerified = recordVerified(payload.records, "DKIM");
  await pool.query(
    `update sending_domains
        set spf_verified = $3,
            dkim_verified = $4,
            warmup_state = case
              when warmup_state in ('degraded', 'frozen') then warmup_state
              when not $3 or not $4 then case
                when $5 = 'pending' then 'verifying'::domain_warmup_state
                else 'unverified'::domain_warmup_state
              end
              else warmup_state
            end,
            current_daily_cap = case
              when not $3 or not $4 then 0
              else current_daily_cap
            end,
            properties = properties || $6::jsonb,
            updated_at = now()
      where id = $1
        and workspace_id = $2
        and channel_account_id = $7`,
    [
      payload.sending_domain_id,
      event.workspace_id,
      spfVerified,
      dkimVerified,
      payload.provider_status,
      JSON.stringify({
        provider: payload.provider,
        provider_domain_id: payload.provider_domain_id,
        provider_status: payload.provider_status,
        provider_region: payload.region ?? null,
        dns_records: payload.records,
        provider_event_id: event.id,
      }),
      payload.channel_account_id,
    ],
  );
}

async function applyVerificationRequested(pool: Pool, event: PublishedEvent): Promise<void> {
  const payload = DomainVerificationRequestedPayload.parse(event.payload);
  await pool.query(
    `update sending_domains
        set warmup_state = case
              when warmup_state in ('degraded', 'frozen') then warmup_state
              else 'verifying'::domain_warmup_state
            end,
            current_daily_cap = 0,
            properties = properties || $3::jsonb,
            updated_at = now()
      where id = $1
        and workspace_id = $2`,
    [
      payload.sending_domain_id,
      event.workspace_id,
      JSON.stringify({
        provider: payload.provider,
        provider_domain_id: payload.provider_domain_id,
        verification_event_id: event.id,
      }),
    ],
  );
}

async function publishTrustVerifiedIfEligible(
  pool: Pool,
  bus: EventBus,
  event: PublishedEvent,
  sending_domain_id: string,
): Promise<void> {
  const { rows } = await pool.query<{
    id: string;
    channel_account_id: string;
    domain: string;
  }>(
    `select id, channel_account_id, domain::text as domain
       from sending_domains
      where id = $1
        and workspace_id = $2
        and spf_verified
        and dkim_verified
        and dmarc_verified
        and warmup_state not in ('degraded', 'frozen')`,
    [sending_domain_id, event.workspace_id],
  );
  const domain = rows[0];
  if (!domain) return;
  await bus.publish({
    workspace_id: event.workspace_id,
    event_type: "channel.domain.trust.verified",
    source: "system",
    producer_ref: "projector:sending-domain",
    correlation_id: event.correlation_id,
    causation_id: event.id,
    idempotency_key: `sending-domain:${domain.id}:trust-verified`,
    payload: {
      sending_domain_id: domain.id,
      channel_account_id: domain.channel_account_id,
      domain: domain.domain,
    },
  });
}

async function applyDmarcObserved(
  pool: Pool,
  bus: EventBus,
  event: PublishedEvent,
): Promise<void> {
  const payload = DomainDmarcObservedPayload.parse(event.payload);
  await pool.query(
    `update sending_domains
        set dmarc_verified = $3,
            current_daily_cap = case when $3 then current_daily_cap else 0 end,
            warmup_state = case
              when warmup_state in ('degraded', 'frozen') then warmup_state
              when $3 then warmup_state
              else 'unverified'::domain_warmup_state
            end,
            properties = properties || $4::jsonb,
            updated_at = now()
      where id = $1
        and workspace_id = $2
        and channel_account_id = $5`,
    [
      payload.sending_domain_id,
      event.workspace_id,
      payload.verified,
      JSON.stringify({
        dmarc_dns_name: payload.dns_name,
        dmarc_record: payload.record,
        dmarc_policy: payload.policy,
        dmarc_event_id: event.id,
      }),
      payload.channel_account_id,
    ],
  );
  if (payload.verified) {
    await publishTrustVerifiedIfEligible(pool, bus, event, payload.sending_domain_id);
  }
}

async function applyTrustVerified(pool: Pool, event: PublishedEvent): Promise<void> {
  const payload = DomainTrustVerifiedPayload.parse(event.payload);
  await pool.query(
    `update sending_domains
        set warmup_state = case
              when warmup_state in ('degraded', 'frozen', 'warmed') then warmup_state
              else 'warming'::domain_warmup_state
            end,
            properties = properties || $3::jsonb,
            updated_at = now()
      where id = $1
        and workspace_id = $2
        and channel_account_id = $4
        and spf_verified and dkim_verified and dmarc_verified`,
    [
      payload.sending_domain_id,
      event.workspace_id,
      JSON.stringify({ trust_verified_event_id: event.id }),
      payload.channel_account_id,
    ],
  );
}

async function applyWarmupAdvanced(pool: Pool, event: PublishedEvent): Promise<void> {
  const payload = DomainWarmupAdvancedPayload.parse(event.payload);
  await pool.query(
    `update sending_domains
        set warmup_day = $3,
            current_daily_cap = $4,
            target_daily_cap = $5,
            warmup_state = case
              when warmup_state in ('degraded', 'frozen') then warmup_state
              when $6 then 'warmed'::domain_warmup_state
              else 'warming'::domain_warmup_state
            end,
            properties = properties || $7::jsonb,
            updated_at = now()
      where id = $1
        and workspace_id = $2
        and channel_account_id = $8
        and spf_verified and dkim_verified and dmarc_verified`,
    [
      payload.sending_domain_id,
      event.workspace_id,
      payload.warmup_day,
      payload.current_daily_cap,
      payload.target_daily_cap,
      payload.completed,
      JSON.stringify({ warmup_event_id: event.id }),
      payload.channel_account_id,
    ],
  );
}

export async function wireSendingDomainProjection(
  opts: { pool: Pool; bus: EventBus },
): Promise<SendingDomainProjection> {
  const projection = createSendingDomainProjection(opts);
  const provisioned = await opts.bus.subscribe("channel.domain.provisioned", projection.apply);
  const requested = await opts.bus.subscribe(
    "channel.domain.verification.requested",
    projection.apply,
  );
  const status = await opts.bus.subscribe("channel.domain.status.received", projection.apply);
  const dmarc = await opts.bus.subscribe("channel.domain.dmarc.observed", projection.apply);
  const trust = await opts.bus.subscribe("channel.domain.trust.verified", projection.apply);
  const warmup = await opts.bus.subscribe("channel.domain.warmup.advanced", projection.apply);
  return {
    async unsubscribe() {
      await provisioned.unsubscribe();
      await requested.unsubscribe();
      await status.unsubscribe();
      await dmarc.unsubscribe();
      await trust.unsubscribe();
      await warmup.unsubscribe();
    },
  };
}

export function createSendingDomainProjection(
  opts: { pool: Pool; bus: EventBus },
): DurableEventProjection {
  return {
    name: SENDING_DOMAIN_PROJECTION,
    eventTypes: [
      "channel.domain.provisioned",
      "channel.domain.verification.requested",
      "channel.domain.status.received",
      "channel.domain.dmarc.observed",
      "channel.domain.trust.verified",
      "channel.domain.warmup.advanced",
    ],
    async apply(event) {
      if (
        event.event_type === "channel.domain.provisioned" ||
        event.event_type === "channel.domain.status.received"
      ) {
        const payload = DomainSnapshotPayload.parse(event.payload);
        await applyDomainSnapshot(opts.pool, event);
        await publishTrustVerifiedIfEligible(
          opts.pool,
          opts.bus,
          event,
          payload.sending_domain_id,
        );
      } else if (event.event_type === "channel.domain.verification.requested") {
        await applyVerificationRequested(opts.pool, event);
      } else if (event.event_type === "channel.domain.dmarc.observed") {
        await applyDmarcObserved(opts.pool, opts.bus, event);
      } else if (event.event_type === "channel.domain.trust.verified") {
        await applyTrustVerified(opts.pool, event);
      } else if (event.event_type === "channel.domain.warmup.advanced") {
        await applyWarmupAdvanced(opts.pool, event);
      }
    },
  };
}

import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { defineWorkflow, type RunContext } from "../substrate/workflows/index.ts";

export const CONTACT_RESOLUTION_WORKFLOW = "contact.resolve_for_signal.v1";

export type ContactChannel = "email" | "linkedin";

export interface ContactResolutionInput {
  workspace_id: string;
  signal_id: string;
  company_id: string;
  play_id: string;
  rep_id: string;
  channel: ContactChannel;
  trigger_event_id?: string | null;
  limit?: number;
  repair_key?: string | null;
}

export interface ContactCandidate {
  person_id: string;
  full_name: string;
  title: string | null;
  company_id: string | null;
  emails: string[];
  linkedin_url: string | null;
  score: number;
  reasons: string[];
  verification: {
    email_status?: string | null;
    email_verified?: boolean;
    linkedin_ready?: boolean;
  };
  provenance: Record<string, unknown>;
}

export interface ContactResolutionOutput {
  decision: "resolved" | "deferred";
  contact_resolution_id: string;
  candidates: ContactCandidate[];
  selected_person_id: string | null;
  defer_reason?: string;
}

export interface ContactResolutionProviderPerson {
  full_name: string;
  title?: string | null;
  emails?: string[];
  linkedin_url?: string | null;
  confidence?: number;
  source: "exa" | "hunter" | "zerobounce" | "manual" | string;
  evidence?: Record<string, unknown>;
}

export interface ContactDiscoveryProvider {
  name: string;
  discover(input: ContactResolutionInput): Promise<ContactResolutionProviderPerson[]>;
}

export interface EmailVerificationProvider {
  name: string;
  verify(email: string, input: ContactResolutionInput): Promise<{
    status: string;
    verified: boolean;
    confidence?: number;
    raw?: Record<string, unknown>;
  }>;
}

export class ContactProviderDeferredError extends Error {
  readonly provider: string;
  readonly reason: string;

  constructor(provider: string, reason: string, message?: string) {
    super(message ?? reason);
    this.name = "ContactProviderDeferredError";
    this.provider = provider;
    this.reason = reason;
  }
}

export interface ContactResolutionDeps {
  pool: Pool;
  discoveryProviders?: ContactDiscoveryProvider[];
  emailVerifier?: EmailVerificationProvider;
}

const MAX_EMAILS_TO_VERIFY_PER_PERSON = 3;

interface ContactRow {
  id: string;
  full_name: string;
  title: string | null;
  company_id: string | null;
  emails: string[];
  linkedin_url: string | null;
  properties: Record<string, unknown>;
  provenance: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

interface ContactResolutionPolicy {
  auto_enrich_email_addresses: boolean;
  prevent_team_contact_duplication: boolean;
}

interface ProviderDefer {
  defer_reason: string;
  provider_name: string;
  provider_error: string;
}

export function createContactResolutionWorkflow(deps: ContactResolutionDeps) {
  return defineWorkflow<ContactResolutionInput, ContactResolutionOutput>({
    name: CONTACT_RESOLUTION_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      const contact_resolution_id = contactResolutionId(input);
      const limit = Math.max(1, Math.min(3, Math.trunc(input.limit ?? 3)));
      const policy = await ctx.step("contact.profile_policy.load", async () =>
        loadWorkspaceContactPolicy(deps.pool, input.workspace_id),
      );

      const cachedCandidates = await ctx.step("contact.graph_cache.rank", async () => {
        const rows = await loadCandidateRows(deps.pool, input, policy);
        return rankContactRows(rows, input.channel).slice(0, limit);
      });
      if (graphCacheSatisfied(cachedCandidates, input.channel, limit)) {
        await publishResolved(ctx, input, contact_resolution_id, cachedCandidates, ["graph_cache"]);
        return {
          decision: "resolved",
          contact_resolution_id,
          candidates: cachedCandidates,
          selected_person_id: cachedCandidates[0]!.person_id,
        };
      }
      if (input.channel === "email" && !policy.auto_enrich_email_addresses) {
        const defer_reason = "email_auto_enrich_disabled";
        const output: ContactResolutionOutput = {
          decision: "deferred",
          contact_resolution_id,
          candidates: cachedCandidates,
          selected_person_id: null,
          defer_reason,
        };
        await publishDeferred(
          ctx,
          input,
          contact_resolution_id,
          defer_reason,
          cachedCandidates.length,
          ["graph_cache"],
        );
        return output;
      }

      await ctx.step("contact.discovery.provider_waterfall", async () => {
        const statuses: Array<{ provider: string; status: "ok" | "deferred"; count?: number; reason?: string }> = [];
        for (const provider of deps.discoveryProviders ?? []) {
          let people: ContactResolutionProviderPerson[];
          try {
            people = await provider.discover(input);
          } catch (error) {
            const defer = providerDefer(provider.name, error);
            console.warn(`[contact-resolution] deferred ${provider.name}: ${defer.defer_reason}`);
            await publishDeferred(
              ctx,
              input,
              contact_resolution_id,
              defer.defer_reason,
              0,
              providerOrderForDeferredProvider(deps, provider.name),
              defer,
            );
            statuses.push({
              provider: provider.name,
              status: "deferred",
              reason: defer.defer_reason,
            });
            continue;
          }
          await upsertProviderPeople(deps.pool, input, people, provider.name);
          statuses.push({ provider: provider.name, status: "ok", count: people.length });
        }
        return statuses;
      });

      if (input.channel === "email" && deps.emailVerifier) {
        await ctx.step("contact.email.verify", async () => {
          const rows = await loadCandidateRows(deps.pool, input, policy);
          for (const row of rows) {
            await verifyCandidateEmails(deps.pool, input, row, deps.emailVerifier!, ctx, contact_resolution_id);
          }
          return true;
        });
      }

      const candidates = await ctx.step("contact.rank_top_three", async () => {
        const rows = await loadCandidateRows(deps.pool, input, policy);
        return rankContactRows(rows, input.channel)
          .filter((candidate) => channelReady(candidate, input.channel))
          .slice(0, limit);
      });

      if (candidates.length === 0) {
        const defer_reason = `no_${input.channel}_ready_contact`;
        const output: ContactResolutionOutput = {
          decision: "deferred",
          contact_resolution_id,
          candidates,
          selected_person_id: null,
          defer_reason,
        };
        await publishDeferred(
          ctx,
          input,
          contact_resolution_id,
          defer_reason,
          candidates.length,
          providerOrder(deps),
        );
        return output;
      }

      const output: ContactResolutionOutput = {
        decision: "resolved",
        contact_resolution_id,
        candidates,
        selected_person_id: candidates[0]!.person_id,
      };
      await publishResolved(ctx, input, contact_resolution_id, candidates, providerOrder(deps));
      return output;
    },
  });
}

async function loadWorkspaceContactPolicy(
  pool: Pool,
  workspace_id: string,
): Promise<ContactResolutionPolicy> {
  const { rows } = await pool.query<{
    auto_enrich_email_addresses: boolean | null;
    prevent_team_contact_duplication: boolean | null;
  }>(
    `select coalesce((properties->>'auto_enrich_email_addresses')::boolean, true)
              as auto_enrich_email_addresses,
            coalesce((properties->>'prevent_team_contact_duplication')::boolean, true)
              as prevent_team_contact_duplication
       from graph_companies
      where workspace_id = $1
        and properties->>'profile_role' = 'workspace_company'
      order by updated_at desc
      limit 1`,
    [workspace_id],
  );
  return {
    auto_enrich_email_addresses:
      rows[0]?.auto_enrich_email_addresses ?? true,
    prevent_team_contact_duplication:
      rows[0]?.prevent_team_contact_duplication ?? true,
  };
}

async function publishResolved(
  ctx: RunContext,
  input: ContactResolutionInput,
  contact_resolution_id: string,
  candidates: ContactCandidate[],
  provider_order: string[],
): Promise<void> {
  await ctx.publish("contact.resolved", {
    contact_resolution_id,
    signal_id: input.signal_id,
    company_id: input.company_id,
    play_id: input.play_id,
    rep_id: input.rep_id,
    channel: input.channel,
    selected_person_id: candidates[0]!.person_id,
    candidates: candidates.map((candidate, index) => ({
      rank: index + 1,
      person_id: candidate.person_id,
      full_name: candidate.full_name,
      title: candidate.title,
      score: candidate.score,
      reasons: candidate.reasons,
      emails: candidate.emails,
      linkedin_url: candidate.linkedin_url,
      verification: candidate.verification,
      provenance: candidate.provenance,
    })),
    provider_order,
  });
}

async function publishDeferred(
  ctx: RunContext,
  input: ContactResolutionInput,
  contact_resolution_id: string,
  defer_reason: string,
  candidate_count: number,
  provider_order: string[],
  provider_defer?: ProviderDefer,
): Promise<void> {
  await ctx.publish("contact.resolution.deferred", {
    contact_resolution_id,
    signal_id: input.signal_id,
    company_id: input.company_id,
    play_id: input.play_id,
    rep_id: input.rep_id,
    channel: input.channel,
    defer_reason,
    provider_name: provider_defer?.provider_name ?? null,
    provider_error: provider_defer?.provider_error ?? null,
    candidate_count,
    provider_order,
  });
}

function graphCacheSatisfied(
  candidates: ContactCandidate[],
  channel: ContactChannel,
  limit: number,
): boolean {
  if (candidates.length < limit) return false;
  const top = candidates.slice(0, limit);
  return top.every((candidate) => channelReady(candidate, channel));
}

function channelReady(candidate: ContactCandidate, channel: ContactChannel): boolean {
  if (channel === "linkedin") return Boolean(candidate.verification.linkedin_ready);
  return Boolean(candidate.verification.email_verified && candidate.verification.linkedin_ready);
}

export function rankContactRows(
  rows: ContactRow[],
  channel: ContactChannel,
): ContactCandidate[] {
  return rows
    .map((row) => scoreContact(row, channel))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      a.full_name.localeCompare(b.full_name) ||
      a.person_id.localeCompare(b.person_id)
    );
}

function scoreContact(row: ContactRow, channel: ContactChannel): ContactCandidate {
  const reasons: string[] = [];
  let score = 0;
  const title = row.title?.toLowerCase() ?? "";
  if (/(founder|co-founder|ceo|chief executive|owner)/i.test(title)) {
    score += 0.35;
    reasons.push("executive_or_founder");
  } else if (/(revenue|sales|growth|marketing|gtm|partnership|business development)/i.test(title)) {
    score += 0.25;
    reasons.push("gtm_relevant_role");
  } else if (/(operations|people|talent|hiring|finance|product)/i.test(title)) {
    score += 0.15;
    reasons.push("signal_adjacent_role");
  }

  const email = preferredEmail(row.properties, row.emails);
  const emailStatus = email ? emailVerificationStatus(row.properties, email) : null;
  const emailVerified = email ? isVerifiedEmail(row.properties, email) : false;
  const linkedinReady = Boolean(row.linkedin_url);
  if (channel === "email") {
    if (emailVerified) {
      score += 0.45;
      reasons.push("verified_email");
    } else if (email && !emailStatus) {
      score += 0.25;
      reasons.push("email_present_unverified");
    } else if (email) {
      score += 0.1;
      reasons.push(`email_${emailStatus}`);
    }
  } else if (linkedinReady) {
    score += 0.45;
    reasons.push("linkedin_profile_present");
  }

  const contactFit = numberFromPath(row.properties, ["contact_fit", "score"]);
  if (contactFit != null) {
    score += Math.max(0, Math.min(0.2, contactFit * 0.2));
    reasons.push("provider_contact_fit");
  }

  const priorOutcome = String(row.properties.latest_contact_reply_intent ?? "");
  if (priorOutcome === "positive") {
    score += 0.1;
    reasons.push("prior_positive_outcome");
  }
  if (row.properties.do_not_contact === true) {
    score = 0;
    reasons.push("do_not_contact");
  }
  if (channel === "email" && !email) score = 0;
  if (channel === "linkedin" && !row.linkedin_url) score = 0;

  return {
    person_id: row.id,
    full_name: row.full_name,
    title: row.title,
    company_id: row.company_id,
    emails: email ? preferEmail(row.emails, email) : row.emails,
    linkedin_url: row.linkedin_url,
    score: Number(score.toFixed(4)),
    reasons,
    verification: {
      email_status: emailStatus,
      email_verified: emailVerified,
      linkedin_ready: linkedinReady,
    },
    provenance: row.provenance ?? {},
  };
}

async function verifyCandidateEmails(
  pool: Pool,
  input: ContactResolutionInput,
  row: ContactRow,
  verifier: EmailVerificationProvider,
  ctx: RunContext,
  contact_resolution_id: string,
): Promise<void> {
  const existing = recordValue(row.properties.email_verification) ?? {};
  const next: Record<string, unknown> = { ...existing };
  let changed = false;
  let verifiedEmail = row.emails.find((email) => isVerifiedEmail(row.properties, email)) ?? null;

  for (const email of uniqueEmails(row.emails).slice(0, MAX_EMAILS_TO_VERIFY_PER_PERSON)) {
    if (verifiedEmail) break;
    const state = emailVerificationState(row.properties, email);
    if (state.status || state.verified) continue;
    let result: Awaited<ReturnType<EmailVerificationProvider["verify"]>>;
    try {
      result = await verifier.verify(email, input);
    } catch (error) {
      const defer = providerDefer(verifier.name, error);
      console.warn(`[contact-resolution] deferred ${verifier.name}: ${defer.defer_reason}`);
      await publishDeferred(
        ctx,
        input,
        contact_resolution_id,
        defer.defer_reason,
        0,
        ["graph_cache", verifier.name],
        defer,
      );
      continue;
    }
    next[email.toLowerCase()] = {
      provider: verifier.name,
      status: result.status,
      verified: result.verified,
      confidence: result.confidence ?? null,
      raw: result.raw ?? null,
      checked_at: new Date().toISOString(),
    };
    changed = true;
    if (result.verified) {
      verifiedEmail = email;
    }
  }

  if (changed) {
    await mergePersonProperties(pool, input.workspace_id, row.id, {
      email_verification: next,
    });
  }
  if (verifiedEmail && row.emails[0]?.toLowerCase() !== verifiedEmail.toLowerCase()) {
    await preferPersonEmail(pool, input.workspace_id, row.id, verifiedEmail);
  }
}

async function loadCandidateRows(
  pool: Pool,
  input: ContactResolutionInput,
  policy: ContactResolutionPolicy,
): Promise<ContactRow[]> {
  const { rows } = await pool.query<ContactRow>(
    `select id,
            full_name,
            title,
            company_id,
            emails::text[] as emails,
            linkedin_url,
            properties,
            provenance,
            created_at,
            updated_at
       from graph_persons
      where workspace_id = $1
        and company_id = $2
        and (
          ($3::text = 'email' and cardinality(emails) > 0)
          or ($3::text = 'linkedin' and linkedin_url is not null)
        )
        and (
          not $4::boolean
          or not exists (
            select 1
              from conversations c
             where c.workspace_id = $1
               and c.counterparty_person_id = graph_persons.id
          )
        )
      order by updated_at desc, created_at asc
      limit 50`,
    [
      input.workspace_id,
      input.company_id,
      input.channel,
      policy.prevent_team_contact_duplication,
    ],
  );
  return rows;
}

async function upsertProviderPeople(
  pool: Pool,
  input: ContactResolutionInput,
  people: ContactResolutionProviderPerson[],
  providerName: string,
): Promise<void> {
  for (const person of people) {
    const fullName = person.full_name.trim();
    if (!fullName) continue;
    const existing = await pool.query<{ id: string }>(
      `select id from graph_persons
        where workspace_id = $1
          and (
            ($2::text is not null and linkedin_url = $2)
            or (cardinality($3::citext[]) > 0 and emails && $3::citext[])
            or (company_id = $4 and lower(full_name) = lower($5))
          )
        order by created_at asc
        limit 1`,
      [
        input.workspace_id,
        person.linkedin_url ?? null,
        person.emails ?? [],
        input.company_id,
        fullName,
      ],
    );
    const properties = {
      contact_fit: {
        score: person.confidence ?? null,
        source: person.source,
        evidence: person.evidence ?? {},
        discovered_at: new Date().toISOString(),
      },
    };
    const provenance = {
      source: providerName,
      provider: person.source,
      workflow: CONTACT_RESOLUTION_WORKFLOW,
    };
    if (existing.rows[0]) {
      await pool.query(
        `update graph_persons set
           full_name = $2,
           title = coalesce($3, title),
           company_id = coalesce(company_id, $4),
           emails = (
             select coalesce(array_agg(distinct e), array[]::citext[])
               from unnest(graph_persons.emails || $5::citext[]) as e
           ),
           linkedin_url = coalesce($6, linkedin_url),
           properties = properties || $7::jsonb,
           provenance = provenance || $8::jsonb,
           updated_at = now()
         where workspace_id = $1
           and id = $9`,
        [
          input.workspace_id,
          fullName,
          person.title ?? null,
          input.company_id,
          person.emails ?? [],
          person.linkedin_url ?? null,
          JSON.stringify(properties),
          JSON.stringify(provenance),
          existing.rows[0].id,
        ],
      );
      continue;
    }
    await pool.query(
      `insert into graph_persons (
         workspace_id, full_name, title, company_id, emails, linkedin_url,
         properties, provenance
       ) values (
         $1, $2, $3, $4, $5::citext[], $6, $7::jsonb, $8::jsonb
       )
       on conflict (id) do nothing`,
      [
        input.workspace_id,
        fullName,
        person.title ?? null,
        input.company_id,
        person.emails ?? [],
        person.linkedin_url ?? null,
        JSON.stringify(properties),
        JSON.stringify(provenance),
      ],
    );
  }
}

async function mergePersonProperties(
  pool: Pool,
  workspace_id: string,
  person_id: string,
  properties: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    `update graph_persons
        set properties = properties || $3::jsonb,
            updated_at = now()
      where workspace_id = $1
        and id = $2`,
    [workspace_id, person_id, JSON.stringify(properties)],
  );
}

async function preferPersonEmail(
  pool: Pool,
  workspace_id: string,
  person_id: string,
  email: string,
): Promise<void> {
  await pool.query(
    `update graph_persons
        set emails = array_prepend($3::citext, array_remove(emails, $3::citext)),
            updated_at = now()
      where workspace_id = $1
        and id = $2`,
    [workspace_id, person_id, email.toLowerCase()],
  );
}

function providerOrder(deps: ContactResolutionDeps): string[] {
  return [
    "graph_cache",
    ...(deps.discoveryProviders ?? []).map((provider) => provider.name),
    ...(deps.emailVerifier ? [deps.emailVerifier.name] : []),
  ];
}

function providerOrderForDeferredProvider(
  deps: ContactResolutionDeps,
  providerName: string,
): string[] {
  const order = providerOrder(deps);
  const index = order.indexOf(providerName);
  return index === -1 ? ["graph_cache", providerName] : order.slice(0, index + 1);
}

function providerDefer(providerName: string, error: unknown): ProviderDefer {
  const provider_error = error instanceof ContactProviderDeferredError
    ? error.reason
    : error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")
      ? "provider_timeout"
      : "provider_unavailable";
  const structuredProviderName = error instanceof ContactProviderDeferredError
    ? error.provider
    : providerName;
  return {
    defer_reason: `${structuredProviderName}.${provider_error}`,
    provider_name: structuredProviderName,
    provider_error,
  };
}

function contactResolutionId(input: ContactResolutionInput): string {
  const repairKey = typeof input.repair_key === "string" && input.repair_key.trim()
    ? input.repair_key.trim()
    : null;
  if (!repairKey) return randomUUID();
  return uuidFromHash([
    CONTACT_RESOLUTION_WORKFLOW,
    input.workspace_id,
    input.signal_id,
    input.company_id,
    input.play_id,
    input.rep_id,
    input.channel,
    repairKey,
  ].join("\u0000"));
}

function uuidFromHash(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") + hex.slice(18, 20),
    hex.slice(20, 32),
  ].join("-");
}

function isVerifiedEmail(properties: Record<string, unknown>, email: string): boolean {
  const state = emailVerificationState(properties, email);
  return state.verified === true ||
    (state.verified !== false && isVerifiedEmailStatus(state.status));
}

function emailVerificationStatus(
  properties: Record<string, unknown>,
  email: string,
): string | null {
  return emailVerificationState(properties, email).status;
}

function emailVerificationState(
  properties: Record<string, unknown>,
  email: string,
): { status: string | null; verified: boolean | null } {
  const verification = recordValue(properties.email_verification);
  const byEmail = recordValue(verification?.[email.toLowerCase()]);
  const status = byEmail?.status;
  return {
    status: typeof status === "string" && status.trim()
      ? status.trim().toLowerCase()
      : null,
    verified: typeof byEmail?.verified === "boolean" ? byEmail.verified : null,
  };
}

function isVerifiedEmailStatus(status: string | null): boolean {
  return status === "valid" || status === "verified" || status === "deliverable";
}

function preferredEmail(
  properties: Record<string, unknown>,
  emails: string[],
): string | null {
  return (
    emails.find((email) => isVerifiedEmail(properties, email)) ??
    emails.find((email) => !emailVerificationStatus(properties, email)) ??
    emails[0] ??
    null
  );
}

function preferEmail(emails: string[], preferred: string): string[] {
  const lower = preferred.toLowerCase();
  return [
    preferred,
    ...emails.filter((email) => email.toLowerCase() !== lower),
  ];
}

function uniqueEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const email of emails) {
    const normalized = email.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function numberFromPath(
  value: Record<string, unknown>,
  path: string[],
): number | null {
  let cursor: unknown = value;
  for (const part of path) {
    cursor = recordValue(cursor)?.[part];
  }
  return typeof cursor === "number" && Number.isFinite(cursor) ? cursor : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

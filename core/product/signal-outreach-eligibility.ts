import { normalizeCompanyDomain } from "../ingest/company-domain.ts";
import {
  normalizePublicHostname,
  normalizePublicHttpUrl,
} from "../../lib/network/public-url.ts";

export type SignalOutreachIneligibilityReason =
  | "missing_company_name"
  | "missing_signal_evidence"
  | "missing_company_identity"
  | "missing_reachable_contact";

export interface SignalOutreachContactEvidence {
  full_name: string | null;
  emails: string[];
  email_verified: boolean;
  linkedin_url: string | null;
}

export interface SignalOutreachEligibilityInput {
  company_name: string | null;
  company_domain: string | null;
  signal_url: string | null;
  contacts: SignalOutreachContactEvidence[];
}

export interface SignalOutreachEligibility {
  eligible: boolean;
  reasons: SignalOutreachIneligibilityReason[];
}

export interface SignalResearchEligibilityInput {
  company_name: string | null;
  company_domain: string | null;
  signal_url: string | null;
  linkedin_urls: Array<string | null>;
  has_linkedin_identity?: boolean;
}

const PLACEHOLDER_NAMES =
  /^(?:unknown|unknown company|unnamed|untitled|n\/a|na|null|none|-+)$/i;

export const SIGNAL_RESEARCH_ELIGIBILITY_SQL = String.raw`
  s.url ~* '^https?://'
  and nullif(btrim(co.name), '') is not null
  and lower(btrim(co.name)) not in (
    'unknown', 'unknown company', 'unnamed', 'untitled', 'n/a', 'na'
  )
  and (
    co.domain is not null
    or exists (
      select 1
        from graph_persons identity_person
       where identity_person.workspace_id = s.workspace_id
         and (
           identity_person.id = s.related_person_id
           or identity_person.company_id = s.related_company_id
         )
         and identity_person.linkedin_url ~* '^https?://(www\.)?linkedin\.com/(in|company)/'
    )
  )`;

export const SIGNAL_OUTREACH_ELIGIBILITY_SQL = String.raw`
  ${SIGNAL_RESEARCH_ELIGIBILITY_SQL}
  and not exists (
    select 1
      from events attainability_gate
     where attainability_gate.workspace_id = s.workspace_id
       and attainability_gate.event_type = 'signal.outreach.gated'
       and attainability_gate.payload->>'signal_id' = s.id::text
       and attainability_gate.payload->>'gate' = 'account_attainability'
       and attainability_gate.payload->>'policy_version' = 'v1'
       and (attainability_gate.payload->>'retry_after')::timestamptz > now()
  )
  and not exists (
    select 1
      from conversations prior_company_conversation
      join messages prior_company_message
        on prior_company_message.workspace_id = prior_company_conversation.workspace_id
       and prior_company_message.conversation_id = prior_company_conversation.id
     where prior_company_conversation.workspace_id = s.workspace_id
       and prior_company_conversation.counterparty_company_id = s.related_company_id
       and prior_company_message.direction = 'outbound'
       and prior_company_message.status in ('sent','delivered','replied')
       and prior_company_message.sent_at >= now() - interval '30 days'
       and not exists (
         select 1
           from conversations reply_conversation
           join messages company_reply
             on company_reply.workspace_id = reply_conversation.workspace_id
            and company_reply.conversation_id = reply_conversation.id
          where reply_conversation.workspace_id = prior_company_conversation.workspace_id
            and reply_conversation.counterparty_company_id = prior_company_conversation.counterparty_company_id
            and company_reply.direction = 'inbound'
            and company_reply.created_at >= now() - interval '90 days'
       )
  )
  and exists (
    select 1
      from graph_persons eligible_person
     where eligible_person.workspace_id = s.workspace_id
       and (
         eligible_person.id = s.related_person_id
         or eligible_person.company_id = s.related_company_id
       )
       and nullif(btrim(eligible_person.full_name), '') is not null
       and lower(btrim(eligible_person.full_name)) not in (
         'unknown', 'unknown person', 'unnamed', 'untitled', 'n/a', 'na'
       )
       and (
         eligible_person.linkedin_url ~* '^https?://(www\.)?linkedin\.com/(in|company)/'
         or exists (
           select 1
             from jsonb_each(
               coalesce(eligible_person.properties->'email_verification', '{}'::jsonb)
             ) as eligible_email(email, meta)
            where meta->>'verified' = 'true'
         )
       )
  )`;

export function assessSignalOutreachEligibility(
  input: SignalOutreachEligibilityInput,
): SignalOutreachEligibility {
  const reachableContacts = input.contacts.filter(isReachableNamedContact);
  const research = assessSignalResearchEligibility({
    company_name: input.company_name,
    company_domain: input.company_domain,
    signal_url: input.signal_url,
    linkedin_urls: reachableContacts.map((contact) => contact.linkedin_url),
  });
  const reasons = [...research.reasons];

  if (reachableContacts.length === 0) {
    reasons.push("missing_reachable_contact");
  }

  return { eligible: reasons.length === 0, reasons };
}

export function assessSignalResearchEligibility(
  input: SignalResearchEligibilityInput,
): SignalOutreachEligibility {
  const reasons: SignalOutreachIneligibilityReason[] = [];
  const companyName = input.company_name?.trim() ?? "";
  if (!companyName || PLACEHOLDER_NAMES.test(companyName)) {
    reasons.push("missing_company_name");
  }
  if (!normalizePublicHttpUrl(input.signal_url)) {
    reasons.push("missing_signal_evidence");
  }
  if (
    !normalizeCompanyDomain(input.company_domain) &&
    !input.has_linkedin_identity &&
    !input.linkedin_urls.some(isLinkedInProfileUrl)
  ) {
    reasons.push("missing_company_identity");
  }
  return { eligible: reasons.length === 0, reasons };
}

export function isReachableNamedContact(
  contact: SignalOutreachContactEvidence,
): boolean {
  const name = contact.full_name?.trim() ?? "";
  if (!name || PLACEHOLDER_NAMES.test(name)) return false;
  return (
    (contact.email_verified && contact.emails.some(isPlausibleEmail)) ||
    isLinkedInProfileUrl(contact.linkedin_url)
  );
}

export function isLinkedInProfileUrl(value: string | null | undefined): boolean {
  const normalized = normalizePublicHttpUrl(value);
  if (!normalized) return false;
  const hostname = normalizePublicHostname(normalized);
  if (hostname !== "linkedin.com") return false;
  const pathname = new URL(normalized).pathname.toLowerCase();
  return pathname.startsWith("/in/") || pathname.startsWith("/company/");
}

function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

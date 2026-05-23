import { normalizeLeadFeedSnapshot } from '../lead-sources.ts'
import { buildSignalIntelligence } from './signal-intelligence.ts'
import { accountKey, normalizeDomain, normalizeEntityName } from './identity.ts'

export interface OutreachPlan {
  version: 'outreach_plan_v1'
  lead_id: string
  target_company: string
  trigger: string
  persona: string
  angle: string
  proof: string
  channel: 'email'
  confidence: number
  safety_checks: Array<{ name: string; passed: boolean; reason: string }>
  risk_flags: string[]
  requires_review: boolean
  reasoning: string[]
}

export function buildOutreachPlan(input: {
  lead: Record<string, unknown>
  mode: 'autonomous' | 'manual'
  senderContext?: {
    companyName?: string | null
    servicesDescription?: string | null
  } | null
}): OutreachPlan {
  const targetCompany = stringValue(input.lead.target_company) || 'Target account'
  const companyDomain = stringValue(input.lead.company_domain) || null
  const snapshot = normalizeLeadFeedSnapshot(input.lead.feed_snapshot ?? null)
  const persona = inferPersona(stringValue(input.lead.contact_title), snapshot?.signal_type ?? null)
  const contactEmail = stringValue(input.lead.contact_email)
  const contactVerified = input.lead.contact_verified === true
  const unlocked = input.lead.is_unlocked !== false
  const relevanceScore = numberValue(input.lead.relevance_score)
  const relevanceReason = stringValue(input.lead.relevance_reason)
  const account = accountKey({
    name: normalizeEntityName(targetCompany),
    domain: normalizeDomain(companyDomain),
  })
  const signal = snapshot
    ? buildSignalIntelligence({
        leadId: stringValue(input.lead.id) || '',
        accountKey: account,
        targetCompany,
        companyDomain,
        relevanceScore,
        relevanceReason,
        contactEmail,
        contactVerified,
        createdAt: stringValue(input.lead.created_at) || null,
        snapshot,
      })
    : null

  const trigger = snapshot
    ? `${snapshot.signal_type}: ${snapshot.headline}`
    : relevanceReason || `High-fit account: ${targetCompany}`
  const offer = input.senderContext?.servicesDescription?.trim()
  const angle = buildAngle(targetCompany, persona, snapshot?.signal_type ?? null, offer)
  const proof = snapshot?.source_name
    ? `Grounded in ${snapshot.source_name}${snapshot.published_at ? ` on ${snapshot.published_at.slice(0, 10)}` : ''}.`
    : 'Grounded in the account relevance and available contact context.'

  const safetyChecks = [
    { name: 'lead_unlocked', passed: unlocked, reason: unlocked ? 'Lead is unlocked.' : 'Lead must be unlocked before outreach.' },
    { name: 'recipient_present', passed: Boolean(contactEmail), reason: contactEmail ? 'A recipient email is present.' : 'No recipient email found.' },
    { name: 'signal_grounded', passed: Boolean(snapshot), reason: snapshot ? 'Outreach has a structured signal.' : 'No structured signal is attached.' },
    { name: 'message_angle_grounded', passed: Boolean(snapshot || relevanceReason), reason: snapshot || relevanceReason ? 'Message angle has source context.' : 'Message angle lacks source context.' },
  ]
  const riskFlags: string[] = []
  if (!contactVerified) riskFlags.push('contact_not_verified')
  if (!snapshot) riskFlags.push('missing_structured_signal')
  if ((signal?.scores.quality ?? 55) < 60) riskFlags.push('low_signal_quality')
  if ((signal?.scores.outreachability ?? 50) < 65) riskFlags.push('low_outreachability')

  const confidence = clampScore(
    (signal?.weighted_score ?? 52) * 0.58 +
    (signal?.scores.outreachability ?? (contactEmail ? 60 : 25)) * 0.22 +
    (contactVerified ? 12 : 0) +
    (unlocked ? 8 : 0),
  )
  const hardAutonomousChecksPassed = safetyChecks
    .filter(check => check.name === 'lead_unlocked' || check.name === 'recipient_present')
    .every(check => check.passed)
  const autonomousReady = input.mode === 'autonomous'
    ? hardAutonomousChecksPassed
    : confidence >= 45 && safetyChecks.some(check => check.name === 'recipient_present' && check.passed)

  return {
    version: 'outreach_plan_v1',
    lead_id: stringValue(input.lead.id) || '',
    target_company: targetCompany,
    trigger,
    persona,
    angle,
    proof,
    channel: 'email',
    confidence,
    safety_checks: safetyChecks,
    risk_flags: riskFlags,
    requires_review: !autonomousReady,
    reasoning: [
      `Plan confidence is ${confidence}/100.`,
      signal ? `Signal weighted score is ${signal.weighted_score}/100.` : 'No normalized signal was available.',
      `Primary persona is ${persona}.`,
    ],
  }
}

export function explainPlanBlock(plan: OutreachPlan): string[] {
  const failedChecks = plan.safety_checks.filter(check => !check.passed).map(check => check.name)
  return [...failedChecks, ...plan.risk_flags, plan.confidence < 62 ? 'plan_confidence_below_autonomous_threshold' : '']
    .filter(Boolean)
}

function buildAngle(
  targetCompany: string,
  persona: string,
  signalType: string | null,
  offer?: string | null,
): string {
  const base = signalType
    ? `Connect the ${signalType} event at ${targetCompany} to a concrete GTM priority for ${persona}.`
    : `Connect ${targetCompany}'s current growth motion to a concrete GTM priority for ${persona}.`
  if (!offer) return base
  return `${base} Keep the offer tied to: ${offer.slice(0, 180)}.`
}

function inferPersona(title: string, signalType: string | null): string {
  const t = title.toLowerCase()
  if (t.includes('sales') || t.includes('revenue') || t.includes('growth')) return 'revenue leader'
  if (t.includes('marketing') || t.includes('demand')) return 'marketing leader'
  if (t.includes('founder') || t.includes('ceo') || t.includes('chief')) return 'executive sponsor'
  if (signalType === 'hiring') return 'people or revenue leader'
  if (signalType === 'regulation') return 'operations or compliance leader'
  return 'GTM owner'
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

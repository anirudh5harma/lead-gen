import { assessExplorePrompt } from './explore.ts'

const MODEL = 'deepseek-v4-flash'
const API_URL = 'https://api.deepseek.com/chat/completions'

interface PromptOptions {
  system?: string
  prompt: string
  maxTokens: number
  timeoutMs: number
  temperature?: number
  responseFormat?: {
    type: 'text' | 'json_object'
  }
}

interface DeepSeekResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
    }
  }>
}

export async function completePrompt({
  system,
  prompt,
  maxTokens,
  timeoutMs,
  temperature = 0.2,
  responseFormat,
}: PromptOptions): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is not configured')
  }

  const messages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: prompt },
  ]

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: maxTokens,
      temperature,
      ...(responseFormat ? { response_format: responseFormat } : {}),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`DeepSeek API error (${response.status}): ${errorText.slice(0, 240)}`)
  }

  const json = await response.json() as DeepSeekResponse
  return extractText(json).trim()
}

function extractText(response: DeepSeekResponse): string {
  const content = response.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((item): item is { text: string } => typeof item?.text === 'string')
      .map(item => item.text)
      .join('\n')
  }
  return ''
}

function stripCodeFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const parsed = parseJsonValue(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  return parsed as Record<string, unknown>
}

function parseJsonValue(text: string): unknown | null {
  const cleaned = stripCodeFences(text)

  try {
    return JSON.parse(cleaned)
  } catch {
    const objectStart = cleaned.indexOf('{')
    const objectEnd = cleaned.lastIndexOf('}')
    if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
      try {
        return JSON.parse(cleaned.slice(objectStart, objectEnd + 1))
      } catch {
        // Fall through to array parsing.
      }
    }

    const arrayStart = cleaned.indexOf('[')
    const arrayEnd = cleaned.lastIndexOf(']')
    if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
      try {
        return JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1))
      } catch {
        return null
      }
    }

    return null
  }
}

/**
 * Extracts structured signal data from a news headline + description.
 * Returns null if the item doesn't represent a clear company event.
 */
export async function extractSignal(
  headline: string,
  description: string,
  timeoutMs = 12_000,
): Promise<{
  company_name: string
  company_domain: string | null
  signal_type: 'funding' | 'acquisition' | 'expansion' | 'regulation' | 'hiring'
  summary: string
  funding_amount: string | null
  confidence: 1 | 2 | 3
} | null> {
  try {
    const text = await completePrompt({
      system: `You extract structured company-event signals from noisy RSS headlines and snippets.

Many descriptions are truncated, HTML-encoded, or low quality. If the headline alone clearly indicates a company event, extract it.

Be permissive for clear events like:
- funding raises, funding rounds, valuation updates tied to a named company
- acquisitions, mergers
- executive appointments, CFO, CTO, CEO hires
- market expansion, launches, new offices
- regulations affecting a specific company

Only return null for generic market commentary, roundups, sector snapshots, opinion pieces, or items without a specific named company event.

Return JSON only.`,
      prompt: `Extract structured signal data from this news item.

Headline: ${headline}
Description: ${description}

Return a JSON object with these fields:
- company_name: string (the primary company involved in the event)
- company_domain: string | null (for example "stripe.com", infer if obvious, else null)
- signal_type: one of "funding" | "acquisition" | "expansion" | "regulation" | "hiring"
- summary: string (one crisp sentence describing the event and its business implication)
- funding_amount: string | null (for example "$50M Series B", only for funding signals)
- confidence: 1 | 2 | 3
  - 3 = clear, specific company event with named company and concrete details
  - 2 = plausible company event but vague or indirect
  - 1 = generic industry news, opinion, listicle, product review, or no named company

If this is not a company business event at all, return null.
Return ONLY valid JSON, no markdown, no explanation.`,
      maxTokens: 350,
      timeoutMs,
    })

    if (text === 'null' || !text) return null

    const parsed = parseJsonObject(text)
    if (!parsed) return fallbackExtractFromHeadline(headline, description)
    const validated = normalizeExtractedSignal(parsed)
    if (!validated || validated.confidence <= 1) {
      return fallbackExtractFromHeadline(headline, description)
    }
    return validated
  } catch {
    return fallbackExtractFromHeadline(headline, description)
  }
}

function normalizeExtractedSignal(parsed: Record<string, unknown>): {
  company_name: string
  company_domain: string | null
  signal_type: 'funding' | 'acquisition' | 'expansion' | 'regulation' | 'hiring'
  summary: string
  funding_amount: string | null
  confidence: 1 | 2 | 3
} | null {
  const company_name = typeof parsed.company_name === 'string' ? parsed.company_name.trim() : ''
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
  const rawType = typeof parsed.signal_type === 'string' ? parsed.signal_type.trim().toLowerCase() : ''
  const funding_amount = typeof parsed.funding_amount === 'string' && parsed.funding_amount.trim()
    ? parsed.funding_amount.trim()
    : null
  const company_domain = typeof parsed.company_domain === 'string' && parsed.company_domain.trim()
    ? parsed.company_domain.trim().toLowerCase()
    : null
  const confidenceValue = typeof parsed.confidence === 'number' ? parsed.confidence : 2
  const confidence = confidenceValue === 3 ? 3 : confidenceValue === 1 ? 1 : 2

  const signal_type = normalizeSignalType(rawType)
  if (!company_name || !summary || !signal_type) return null

  return {
    company_name,
    company_domain,
    signal_type,
    summary,
    funding_amount,
    confidence,
  }
}

function normalizeSignalType(value: string): 'funding' | 'acquisition' | 'expansion' | 'regulation' | 'hiring' | null {
  if (['funding', 'fundraise', 'financing'].includes(value)) return 'funding'
  if (['acquisition', 'acquire', 'merger', 'm&a', 'mna'].includes(value)) return 'acquisition'
  if (['expansion', 'launch', 'market_expansion'].includes(value)) return 'expansion'
  if (['regulation', 'compliance', 'legal'].includes(value)) return 'regulation'
  if (['hiring', 'executive_hire', 'appointment'].includes(value)) return 'hiring'
  return null
}

function fallbackExtractFromHeadline(
  headline: string,
  description: string,
): {
  company_name: string
  company_domain: string | null
  signal_type: 'funding' | 'acquisition' | 'expansion' | 'regulation' | 'hiring'
  summary: string
  funding_amount: string | null
  confidence: 1 | 2 | 3
} | null {
  const normalizedHeadline = decodeEntities(headline).replace(/\s+/g, ' ').trim()
  const normalizedDescription = decodeEntities(description).replace(/\s+/g, ' ').trim()
  const text = `${normalizedHeadline} ${normalizedDescription}`.trim()

  const funding = /\b(raise|raises|raised|raising|funding|financing|series [a-z]|seed|pre-seed|valuation|valued at)\b/i
  const acquisition = /\b(acquires?|acquired|acquisition|merger|merge(?:s|d)?|buyout)\b/i
  const hiring = /\b(appoints?|appointed|hires?|hired|joins?|joined)\b.{0,80}\b(ceo|cto|cfo|cmo|cro|cpo|ciso|chief|vp|vice president|head of)\b/i
  const expansion = /\b(expands?|expanded|launch(?:es|ed)?|opens? (?:a|its)|enters? .*market|new office|new market)\b/i
  const regulation = /\b(regulation|regulatory|compliance|fined|settlement|sec|fda|finra)\b/i

  let signal_type: 'funding' | 'acquisition' | 'expansion' | 'regulation' | 'hiring' | null = null
  if (acquisition.test(text)) signal_type = 'acquisition'
  else if (funding.test(text)) signal_type = 'funding'
  else if (hiring.test(text)) signal_type = 'hiring'
  else if (expansion.test(text)) signal_type = 'expansion'
  else if (regulation.test(text)) signal_type = 'regulation'

  if (!signal_type) return null

  const company_name = extractCompanyName(normalizedHeadline)
  if (!company_name) return null

  const fundingMatch = text.match(/(\$|EUR|GBP|Rs\.?\s?|INR\s?)\s?\d[\d.,]*(?:\s?(?:million|billion|crore|lakh|m|bn|b))?/i)
  const summary = buildFallbackSummary(company_name, signal_type)

  return {
    company_name,
    company_domain: null,
    signal_type,
    summary,
    funding_amount: signal_type === 'funding' ? fundingMatch?.[0] ?? null : null,
    confidence: 2,
  }
}

function extractCompanyName(headline: string): string | null {
  const stripped = headline
    .replace(/\s+-\s+[^-]+$/, '')
    .replace(/\s+[|]\s+.+$/, '')
    .replace(/^[/"' ]+|[/"' ]+$/g, '')

  const patterns = [
    /^(.+?)\s+\b(acquires?|acquired|acquisition|merger|merge(?:s|d)?|raises?|raised|raising|appoints?|appointed|hires?|hired|launch(?:es|ed)?|expands?|expanded)\b/i,
    /^(.+?)\s+\bto\s+\b(acquire|raise|launch|expand)\b/i,
  ]

  for (const pattern of patterns) {
    const match = stripped.match(pattern)
    if (!match) continue
    const candidate = match[1]?.trim()
    if (candidate && candidate.length >= 2) return candidate
  }

  const generic = stripped.match(/\b[A-Z][A-Za-z0-9&.'-]+(?:\s+[A-Z][A-Za-z0-9&.'-]+){0,4}\b/)
  return generic?.[0] ?? null
}

function buildFallbackSummary(
  companyName: string,
  signalType: 'funding' | 'acquisition' | 'expansion' | 'regulation' | 'hiring',
): string {
  switch (signalType) {
    case 'funding':
      return `${companyName} appears to have raised capital, which usually signals active budget deployment and near-term vendor evaluation.`
    case 'acquisition':
      return `${companyName} appears to be involved in an acquisition or merger, which typically creates integration and change-management demand.`
    case 'hiring':
      return `${companyName} appears to have made a senior hire, which often signals a new mandate and openness to outside support.`
    case 'expansion':
      return `${companyName} appears to be expanding into a new market or initiative, which often creates fresh operational needs.`
    case 'regulation':
      return `${companyName} appears to be affected by a regulatory or compliance event, which can create urgency around operational changes.`
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/**
 * Scores how relevant a signal is to a user's product/service.
 * Returns a score 1-10 and a reason string.
 */
export async function scoreLeadRelevance(
  servicesDescription: string,
  signalType: string,
  companyName: string,
  signalSummary: string,
): Promise<{ score: number; reason: string }> {
  try {
    const text = await completePrompt({
      system: `You evaluate whether a company event is a good sales trigger. Score 1-10 based on how likely the company needs the seller's product right now because of the event.
- 8-10: strong fit, event directly creates a need
- 5-7: possible fit, plausible but indirect connection
- 1-4: poor fit, weak or no connection
Return ONLY valid JSON: {"score": <int>, "reason": "<one sentence>"}`,
      prompt: `Seller's product/service: ${servicesDescription}

Event: ${companyName} - ${signalType}
Summary: ${signalSummary}`,
      maxTokens: 200,
      timeoutMs: 25_000,
    })

    const parsed = parseJsonObject(text)
    if (!parsed) return { score: 5, reason: 'Could not assess relevance.' }

    const score = typeof parsed.score === 'number'
      ? Math.max(1, Math.min(10, Math.round(parsed.score)))
      : 5
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim()
      ? parsed.reason.trim()
      : 'Could not assess relevance.'

    return { score, reason }
  } catch {
    return { score: 5, reason: 'Could not assess relevance.' }
  }
}

/**
 * Extracts ICP keywords from a company's services description.
 */
export async function extractICPKeywords(servicesDescription: string): Promise<string[]> {
  try {
    const text = await completePrompt({
      prompt: `Extract 5-10 keywords that describe the ideal customer profile (ICP) for this product/service.
Focus on industries, company stages, pain points, and use cases.

Product/service: ${servicesDescription}

Return ONLY a JSON array of strings, no markdown.`,
      maxTokens: 150,
      timeoutMs: 20_000,
    })

    const parsed = JSON.parse(stripCodeFences(text)) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(Boolean)
      .slice(0, 10)
  } catch {
    return []
  }
}

export async function generateExploreQueries(params: {
  prompt: string
  servicesDescription?: string
  icpKeywords?: string[]
  useWorkspaceIcp?: boolean
}): Promise<string[]> {
  const {
    prompt,
    servicesDescription = '',
    icpKeywords = [],
    useWorkspaceIcp = false,
  } = params

  try {
    const text = await completePrompt({
      system: `You turn a sales operator's targeting brief into concise recent-company-news search queries.
Return 3 to 5 short search queries as a JSON array of strings.
Each query should be broad enough to find candidates, but specific enough to reflect the targeting brief.
When the brief is broad, generate event-biased variants likely to surface target companies in news, such as funding, launch, hiring, partnership, or expansion angles.
Only use seller context and ICP details when explicitly supplied as additional narrowing context.`,
      prompt: `${useWorkspaceIcp ? `Seller context: ${servicesDescription}
ICP keywords: ${icpKeywords.join(', ') || 'None'}
` : ''}Targeting brief: ${prompt}

Return queries suitable for Google News or broad company-event search.`,
      maxTokens: 180,
      timeoutMs: 20_000,
    })

    const parsed = JSON.parse(stripCodeFences(text)) as unknown
    if (!Array.isArray(parsed)) return [prompt]
    const queries = parsed
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(Boolean)
      .slice(0, 5)

    return queries.length > 0 ? queries : [prompt]
  } catch {
    return [prompt]
  }
}

export interface ExploreLeadSuggestion {
  company_name: string
  company_domain: string | null
  signal_type: 'funding' | 'acquisition' | 'expansion' | 'regulation' | 'hiring'
  headline: string
  summary: string
  relevance_reason: string
  relevance_score: number
}

export interface ExploreLeadGenerationResult {
  ok: boolean
  failure_kind: 'invalid_prompt' | 'generation_error' | null
  rejection_reason: string | null
  leads: ExploreLeadSuggestion[]
}

export async function generateExploreLeads(params: {
  prompt: string
  sellerProfileDescription?: string | null
  workspaceIcpContext?: string | null
  useWorkspaceIcp?: boolean
}): Promise<ExploreLeadGenerationResult> {
  const {
    prompt,
    sellerProfileDescription = '',
    workspaceIcpContext = '',
    useWorkspaceIcp = false,
  } = params
  const promptAssessment = assessExplorePrompt(prompt)

  if (!promptAssessment.allowed) {
    return {
      ok: false,
      failure_kind: 'invalid_prompt',
      rejection_reason: promptAssessment.reason ?? 'This prompt is outside the scope of lead generation.',
      leads: [],
    }
  }

  try {
    const buildPrompt = () => `Targeting prompt: ${prompt}
Seller profile description: ${sellerProfileDescription || 'None provided'}
${useWorkspaceIcp && workspaceIcpContext ? `Workspace ICP context: ${workspaceIcpContext}` : 'Workspace ICP context: none'}

Return a JSON object in exactly this shape:
{
  "leads": [
    {
      "company_name": "Example Company",
      "company_domain": "example.com",
      "signal_type": "funding",
      "headline": "Example Company is a strong target for this search",
      "summary": "One concise sentence explaining why this company belongs in the result set.",
      "relevance_reason": "One concise sentence about fit to the prompt.",
      "relevance_score": 8
    }
  ]
}

Requirements:
- Include 8 to 12 leads.
- Use only these signal types: "funding", "acquisition", "expansion", "regulation", "hiring".
- The headline and summary should read like a lead rationale, not a news citation.
- Use null for company_domain if uncertain.
- Do not include any keys other than "leads" and the lead fields shown above.`

    const requestLeadPayload = async () => completePrompt({
      system: `You handle prompted account discovery for a B2B outbound product.
Generate plausible target accounts from the user's targeting brief.

Rules:
- Prefer real companies when reasonably likely.
- Do not return placeholders or obviously fake names.
- Keep summaries and reasons concise.
- Use one of these signal types only: funding, acquisition, expansion, regulation, hiring.
- If the user asks broadly, optimize for useful targets, not strict seller-product fit.
- Always consider the seller profile description as background context for what they sell.
- Only use workspace ICP context as a narrowing filter when it is explicitly provided as narrowing guidance.
- If a company domain is uncertain, return null.

Return ONLY valid JSON, no markdown.`,
      prompt: buildPrompt(),
      maxTokens: 1400,
      timeoutMs: 35_000,
      temperature: 0.3,
      responseFormat: { type: 'json_object' },
    })

    let parsed: unknown | null = null

    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await requestLeadPayload()
      parsed = parseJsonValue(text)
      if (parsed) break
    }

    if (!parsed) {
      return {
        ok: false,
        failure_kind: 'generation_error',
        rejection_reason: 'Could not generate lead suggestions for this prompt right now.',
        leads: [],
      }
    }

    const rawLeads = Array.isArray(parsed)
      ? parsed
      : (
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        Array.isArray((parsed as Record<string, unknown>).leads)
      )
          ? (parsed as Record<string, unknown>).leads as unknown[]
          : []

    const leads = rawLeads
      .map(item => normalizeExploreLeadSuggestion(item))
      .filter((item): item is ExploreLeadSuggestion => item !== null)
      .slice(0, 12)

    return {
      ok: true,
      failure_kind: null,
      rejection_reason: null,
      leads,
    }
  } catch {
    return {
      ok: false,
      failure_kind: 'generation_error',
      rejection_reason: 'Could not generate leads for this prompt right now.',
      leads: [],
    }
  }
}

export async function scoreExploreCandidate(params: {
  prompt: string
  companyName: string
  signalType: string
  signalSummary: string
  workspaceContext?: string | null
}): Promise<{ score: number; reason: string }> {
  const {
    prompt,
    companyName,
    signalType,
    signalSummary,
    workspaceContext,
  } = params

  try {
    const text = await completePrompt({
      system: `You evaluate whether a company and event match a user's discovery brief.
Score 1-10 based on match quality to the targeting brief.
- 8-10: strong direct match to the brief
- 5-7: decent or plausible match
- 1-4: weak match or mostly irrelevant

If extra workspace context is provided, use it as a secondary narrowing filter.
If no workspace context is provided, ignore seller product fit entirely and judge only against the targeting brief.

Return ONLY valid JSON: {"score": <int>, "reason": "<one sentence>"}`,
      prompt: `Targeting brief: ${prompt}
${workspaceContext ? `Additional workspace ICP context: ${workspaceContext}` : 'Additional workspace ICP context: none'}

Candidate company: ${companyName}
Event type: ${signalType}
Event summary: ${signalSummary}`,
      maxTokens: 220,
      timeoutMs: 25_000,
    })

    const parsed = parseJsonObject(text)
    if (!parsed) return { score: 5, reason: 'Could not assess prompt match.' }

    const score = typeof parsed.score === 'number'
      ? Math.max(1, Math.min(10, Math.round(parsed.score)))
      : 5
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim()
      ? parsed.reason.trim()
      : 'Could not assess prompt match.'

    return { score, reason }
  } catch {
    return { score: 5, reason: 'Could not assess prompt match.' }
  }
}

function normalizeExploreLeadSuggestion(input: unknown): ExploreLeadSuggestion | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  const row = input as Record<string, unknown>

  const companyName = typeof row.company_name === 'string' ? row.company_name.trim() : ''
  const headline = typeof row.headline === 'string' ? row.headline.trim() : ''
  const summary = typeof row.summary === 'string' ? row.summary.trim() : ''
  const reason = typeof row.relevance_reason === 'string' ? row.relevance_reason.trim() : ''
  const rawType = typeof row.signal_type === 'string' ? row.signal_type.trim().toLowerCase() : ''
  const signalType = normalizeSignalType(rawType)

  if (!companyName || !headline || !summary || !reason || !signalType) return null

  const companyDomain = normalizeOptionalDomain(
    typeof row.company_domain === 'string' ? row.company_domain : null,
  )
  const relevanceScore = typeof row.relevance_score === 'number'
    ? Math.max(1, Math.min(10, Math.round(row.relevance_score)))
    : 6

  return {
    company_name: companyName,
    company_domain: companyDomain,
    signal_type: signalType,
    headline,
    summary,
    relevance_reason: reason,
    relevance_score: relevanceScore,
  }
}

function normalizeOptionalDomain(value: string | null): string | null {
  if (!value) return null
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')

  return normalized && normalized.includes('.') ? normalized : null
}

const SIGNAL_ANGLE: Record<string, string> = {
  funding: `Situation: they closed a round. The board expects rapid growth, the CEO must deploy capital fast, and the team will lock in tooling under pressure.

Paragraph 1: open with what actually happens in the first 90 days post-raise, not a generic congratulations.
Paragraph 2: frame the offer as the thing that prevents the most predictable post-raise breakdown relevant to what you sell.
Paragraph 3: make it feel observed, not generic.`,

  acquisition: `Situation: an acquisition just closed or was announced. Systems, teams, cultures, and data are colliding under a mandate to show synergies fast.

Paragraph 1: open with the operational reality of day 1-90 post-acquisition.
Paragraph 2: frame the offer as removing one precise integration bottleneck.
Paragraph 3: make it clear you have seen this pattern before.`,

  expansion: `Situation: they are entering a new market, launching a new product line, or expanding geographically. The old playbook creates false confidence.

Paragraph 1: open with the non-obvious challenge of this expansion.
Paragraph 2: position the offer as the specific capability that reduces unknown risk.
Paragraph 3: make the consequence concrete.`,

  regulation: `Situation: a new regulation creates a hard deadline, fear of penalties, and an overwhelmed compliance team.

Paragraph 1: name the pressure inside the company, not just the rule.
Paragraph 2: frame the offer as risk removal plus deadline certainty.
Paragraph 3: make timeline and cost of delay concrete.`,

  hiring: `Situation: a new executive joined, or the company is on a major hiring surge. New leaders have roughly 90 days to establish credibility.

Paragraph 1: open with what leaders in that role usually discover early.
Paragraph 2: frame the offer as a fast path to an early win.
Paragraph 3: show the cost of deprioritizing the issue.`,

  crm_import: `Situation: this account already lives in the CRM. Treat it like an account-based warm target, not a news-triggered lead.

Paragraph 1: open with a precise observation from the CRM context, status, owner notes, or segment fit.
Paragraph 2: frame the offer as the next logical step for a known target account.
Paragraph 3: keep the proof practical and tied to common pipeline friction.`,
}

/**
 * Drafts a short follow-up email (3-5 days after no reply).
 * Adds a new angle rather than re-pitching.
 */
export async function draftFollowUpEmail(params: {
  senderCompany: string
  servicesDescription: string
  stakeholderName: string
  targetCompany: string
  signalType: string
  signalSummary: string
  originalSubject: string
  originalBody: string
  customInstructions?: string | null
}): Promise<{ subject: string; body: string }> {
  const {
    senderCompany, servicesDescription, stakeholderName, targetCompany,
    signalType, signalSummary, originalSubject, originalBody,
    customInstructions,
  } = params

  const firstName = stakeholderName.split(' ')[0] || 'there'

  try {
    const text = await completePrompt({
      prompt: `Write a brief follow-up email for a cold outreach that got no reply after about 3 days.

Context:
- Sender: ${senderCompany}, ${servicesDescription.slice(0, 500)}
- Recipient: ${firstName} at ${targetCompany}
- Original trigger: ${targetCompany} ${signalType}, ${signalSummary}
- Original subject line: "${originalSubject}"

Original email body:
${originalBody.slice(0, 600)}

Additional template guidance:
${customInstructions || 'None'}

Follow-up rules:
- Max 3 sentences total
- Do not re-pitch, summarize, or repeat the original email
- Add one new piece of value: a different angle, a quick data point, or a short question
- Open with a tactful line like "Probably caught you at a bad time" or "Figured this might still be on your radar"
- Close with a single soft question or very low-friction ask
- Zero corporate speak
- Do not use long dash punctuation

Return ONLY this JSON:
{"subject": "Re: ${originalSubject}", "body": "..."}

Body must use \\n\\n between paragraphs.`,
      maxTokens: 400,
      timeoutMs: 30_000,
    })

    return sanitizeGeneratedEmail(JSON.parse(stripCodeFences(text)))
  } catch {
    return sanitizeGeneratedEmail({
      subject: `Re: ${originalSubject}`,
      body: `${firstName}, probably caught you in the middle of something. Figured I'd check back since the ${signalType} at ${targetCompany} is likely still in full swing.\n\nIs there a better moment this week for a quick 15-minute call?`,
    })
  }
}

/**
 * Drafts a personalized cold outreach email.
 */
export async function draftOutreachEmail(params: {
  senderCompany: string
  servicesDescription: string
  stakeholderName: string
  stakeholderTitle: string
  targetCompany: string
  signalType: string
  signalSummary: string
  headline?: string | null
  fundingAmount?: string | null
  signalAgeLabel?: string | null
  articleContext?: string | null
  calendlyUrl?: string | null
  customInstructions?: string | null
}): Promise<{ subject: string; body: string }> {
  const {
    senderCompany, servicesDescription, stakeholderName, stakeholderTitle,
    targetCompany, signalType, signalSummary,
    headline, fundingAmount, signalAgeLabel, articleContext,
    calendlyUrl, customInstructions,
  } = params

  const angle = SIGNAL_ANGLE[signalType] || SIGNAL_ANGLE.expansion
  const firstName = stakeholderName.split(' ')[0] || stakeholderName

  const ctaInstruction = calendlyUrl
    ? `Closing paragraph: a low-friction ask to book a 15-minute call. Include the Calendly link naturally: ${calendlyUrl}.`
    : `Closing paragraph: a low-friction ask for a 15-minute call. Use a soft direct question.`

  const signalBlock = [
    `Trigger event: ${targetCompany} had a ${signalType}: ${signalSummary}`,
    headline ? `Original headline: ${headline}` : '',
    fundingAmount ? `Amount: ${fundingAmount}` : '',
    signalAgeLabel ? `Timing: ${signalAgeLabel}` : '',
  ].filter(Boolean).join('\n')

  const articleBlock = articleContext
    ? `Article intelligence:\n${articleContext}`
    : ''

  try {
    const text = await completePrompt({
      prompt: `You are writing a B2B sales email. Be direct, sharp, and specific.

Context:
Sender: ${senderCompany}
What they offer: ${servicesDescription}

Recipient: ${firstName} (${stakeholderTitle}) at ${targetCompany}
${signalBlock}

${articleBlock}

Template guidance:
${customInstructions || 'None'}

Strategic angle:
${angle}

Email construction rules:
- Subject line: choose the strongest option for this situation, max 9 words
- Body: 3 paragraphs plus closing
- Paragraph 1: interrupt plus insight
- Paragraph 2: connect the offer to the situation
- Paragraph 3: add proof or specificity
- ${ctaInstruction}

Tone:
- Human, direct, slightly informal
- Zero corporate speak
- First name only for recipient
- Do not use long dash punctuation

Return ONLY this JSON:
{"subject": "...", "body": "..."}

The body must use \\n\\n between paragraphs.`,
      maxTokens: 1000,
      timeoutMs: 60_000,
    })

    return sanitizeGeneratedEmail(JSON.parse(stripCodeFences(text)))
  } catch {
    return sanitizeGeneratedEmail({
      subject: `${targetCompany}'s ${signalType}: a thought`,
      body: `${firstName}, most companies at this stage of ${signalType} hit a specific wall around this problem faster than expected. ${senderCompany} helps teams in that situation avoid the usual breakage by ${servicesDescription.split('.')[0].toLowerCase()}.\n\nWorth a 15-minute call to see if it is relevant?`,
    })
  }
}

function sanitizeGeneratedEmail(value: unknown): { subject: string; body: string } {
  const input = value as { subject?: unknown; body?: unknown }
  return {
    subject: sanitizeEmailText(typeof input.subject === 'string' ? input.subject : ''),
    body: sanitizeEmailText(typeof input.body === 'string' ? input.body : ''),
  }
}

function sanitizeEmailText(value: string): string {
  return value
    .replace(/[\u2500-\u257f]+/g, '')
    .replace(/^\s*[-_=*]{3,}\s*$/gm, '')
    .replace(/\s*[\u2013\u2014]\s*/g, ', ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}
